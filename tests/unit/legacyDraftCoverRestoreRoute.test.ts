import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { variantUrl } from '../../src/core/managedMediaUrl'
import type { Doc } from '../../src/core/types'

async function withLibrary<T>(run: (base: string, data: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-draft-cover-restore-'))
  const data = join(dir, 'data')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: dir })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback port')
    return await run('http://127.0.0.1:' + address.port, data)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  }
}

const json = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
async function loadMedia(base: string, src: string) {
  const response = await fetch(base + src)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/jpeg')
  return Buffer.from(await response.arrayBuffer())
}

it.each(['clean', 'conflict'] as const)('recovers a managed publication cover from a real library backup (%s)', async mode => {
  const { archive, file, id, cover, coverBytes, rejected } = await withLibrary(async (base, data) => {
    const { emptyDoc, useStore, saveNow } = await import('../../src/editor/store')
    const { api, assetRef } = await import('../../src/editor/api')
    const jpeg = await sharp({ create: { width: 470, height: 200, channels: 3, background: '#4485c5' } }).jpeg().toBuffer()
    const request = globalThis.fetch
    const client = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      request(typeof input === 'string' && input.startsWith('/') ? base + input : input, init))
    const starter = emptyDoc()
    const { asset, cover } = await (async () => {
      try {
        const [asset] = await api.uploadAssets([new File([new Uint8Array(jpeg)], 'generated-draft-cover.jpg', { type: 'image/jpeg' })])
        const cover = assetRef(asset)
        useStore.getState().load(starter)
        useStore.getState().setDocFields({ title: 'Draft with separately generated cover', cover })
        expect(await saveNow()).toBe(true)
        return { asset, cover }
      } finally {
        client.mockRestore()
      }
    })()
    expect(asset.file).toMatch(/\.jpg$/)
    expect(cover.src).toBe('/media/' + asset.file)
    const saved: Doc = await (await fetch(base + '/api/projects/' + starter.id)).json()
    expect(saved.cover).toEqual(cover)
    const control = { ...starter, id: 'control', blocks: [starter.blocks[1]] }
    const wrongGeneration = cover.src + '?gen=' + '0'.repeat(64)
    const rejected = [
      { ...control, id: 'missing-cover', cover: { ...cover, src: '/media/not-in-archive.jpg', assetId: 'not-in-archive' } },
      { ...control, id: 'wrong-cover-generation', cover: { ...cover, src: wrongGeneration } },
      { ...control, id: 'external-cover', cover: { ...cover, src: 'https://example.invalid/image.jpg' } },
    ]
    for (const item of [control, ...rejected]) {
      expect((await fetch(base + '/api/projects/' + item.id, { method: 'PUT', ...json(item) })).ok).toBe(true)
    }
    const response = await fetch(base + '/api/data/backup')
    expect(response.status).toBe(200)
    return {
      archive: await response.blob(), file: asset.file, id: starter.id, cover,
      coverBytes: await readFile(join(data, 'assets', asset.file)), rejected: rejected.map(item => item.id).sort(),
    }
  })

  await withLibrary(async (base, data) => {
    const route = base + '/api/data/restore'
    if (mode === 'conflict') await writeFile(join(data, 'assets', file), 'unrelated local bytes')
    let cookie = ''
    const preview = async (flags: string) => {
      const form = new FormData()
      form.append('file', archive, 'project-cover-library.zip')
      const response = await fetch(route + flags, { method: 'POST', body: form, headers: cookie ? { Cookie: cookie } : {} })
      expect(response.status).toBe(200)
      cookie = response.headers.get('set-cookie')?.split(';', 1)[0] ?? cookie
      return response.json()
    }
    const defaultPlan = (await preview('')).plan
    expect(defaultPlan.projects.add).toEqual(['control'])
    expect(defaultPlan.projects.unsupported).toContain(id)
    const selected = await preview('?indexedImages=1')
    const expected = mode === 'clean' ? ['control', id].sort() : ['control']
    expect([...selected.plan.projects.add].sort()).toEqual(expected)
    expect([...selected.plan.projects.unsupported].sort()).toEqual(rejected)
    expect(selected.plan.projects.skip).toEqual(mode === 'conflict' ? [id] : [])
    expect(selected.plan.projects.reasons ?? {}).toEqual(mode === 'conflict' ? { [id]: 'asset-conflict' } : {})
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual(mode === 'conflict' ? [file] : [])
    const response = await fetch(route + '/' + selected.token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    })
    expect(response.status).toBe(200)
    expect([...(await response.json()).projects.restored].sort()).toEqual(expected)
    expect((await preview('?indexedImages=1')).plan.projects.reasons).toEqual(
      mode === 'conflict' ? { control: 'occupied', [id]: 'asset-conflict' } : { control: 'occupied', [id]: 'occupied' },
    )
    if (mode === 'conflict') {
      expect((await fetch(base + '/api/projects/' + id)).status).toBe(404)
      expect(await readFile(join(data, 'assets', file), 'utf8')).toBe('unrelated local bytes')
    } else {
      const project = await fetch(base + '/api/projects/' + id)
      expect(project.status).toBe(200)
      const opened: Doc = await project.json()
      expect(opened.cover).toEqual({ ...cover, src: cover.src + '?gen=' + createHash('sha256').update(coverBytes).digest('hex') })
      expect(await loadMedia(base, variantUrl(opened.cover!.src, undefined, 2400))).toEqual(coverBytes)
      const thumb = variantUrl(opened.cover!.src, '235:100', 600)
      const decoded = (bytes: Buffer) => sharp(bytes).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()
      expect(await decoded(await loadMedia(base, thumb))).toEqual(await decoded(coverBytes))
    }
  })
}, 20_000)

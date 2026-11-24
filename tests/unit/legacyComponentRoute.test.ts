import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'

const archive = new URL('../fixtures/legacy-backup/upstream-component.zip', import.meta.url)
const id = 'archived-component'
const media = 'archived-component-photo'
const item = `components/${id}.json`

it.each(['clean', 'occupied', 'late-media', 'missing', 'remote', 'opt-out'] as const)('guards upstream component and indexed-image restore (%s)', async mode => {
  const temp = await mkdtemp(join(tmpdir(), 'xiumi-component-route-'))
  const data = join(temp, 'library')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: temp })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address')
    const base = `http://127.0.0.1:${address.port}`
    const endpoint = base + '/api/data/restore'
    const bytes = await readFile(archive)
    const zip = await JSZip.loadAsync(bytes)
    if (mode === 'missing' || mode === 'remote') {
      const raw = JSON.parse(await zip.file(item)!.async('string'))
      const src = mode === 'missing' ? '/media/absent.png' : 'https://example.invalid/image.png'
      raw.block.props.html = raw.block.props.html.replace(`/media/${media}.png`, src)
      zip.file(item, JSON.stringify(raw))
    }
    const patched = mode === 'missing' || mode === 'remote'
    const input = patched ? await zip.generateAsync({ type: 'nodebuffer' }) : bytes
    const upload = () => {
      const body = new FormData()
      body.append('file', new Blob([new Uint8Array(input)]), 'upstream-component.zip')
      return fetch(endpoint + (mode === 'opt-out' ? '' : '?components=1'), { method: 'POST', body })
    }
    const preview = await upload()
    expect(preview.status).toBe(200)
    const { token, plan } = await preview.json()
    if (mode === 'opt-out') {
      expect(plan.components).toBeUndefined()
      expect(plan.unsupported).toContain(item)
      return
    }
    const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
    expect(plan.components).toEqual({ add: patched ? [] : [id], alreadyPresent: [], conflicts: [], unresolved: mode === 'missing' ? [id] : [] })
    if (mode === 'remote') expect(plan.unsupported).toContain(item)
    await expect(readdir(join(data, 'components'))).resolves.toEqual([])
    await expect(readdir(join(data, 'assets'))).resolves.toEqual([])
    const local = join(data, item)
    if (mode === 'occupied') await writeFile(local, 'interrupted local bytes')
    if (mode === 'late-media') await writeFile(join(data, 'assets', media + '.png'), 'existing image bytes')
    const apply = (owner?: string) => fetch(endpoint + '/' + token + '/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(owner && { Cookie: owner }) }, body: '{"confirm":true}',
    })
    expect((await apply()).status).toBe(404)
    const response = await apply(cookie)
    expect(response.status).toBe(200)
    expect((await response.json()).components).toEqual({
      restored: mode === 'clean' ? [id] : [], alreadyPresent: [], conflicts: mode === 'occupied' ? [id] : [],
      unresolved: ['missing', 'late-media'].includes(mode) ? [id] : [], failed: [],
    })
    expect((await apply(cookie)).status).toBe(404)
    const list = await (await fetch(base + '/api/components')).json()
    if (mode !== 'clean') {
      expect(list).toEqual([])
      if (mode === 'occupied') await expect(readFile(local, 'utf8')).resolves.toBe('interrupted local bytes')
      if (mode === 'late-media') await expect(readFile(join(data, 'assets', media + '.png'), 'utf8')).resolves.toBe('existing image bytes')
      else await expect(readdir(join(data, 'assets'))).resolves.toEqual([])
      return
    }
    expect(list).toEqual([expect.objectContaining({
      id, rev: 3, name: 'Archived local component', missing: [],
      origin: expect.objectContaining({ kind: 'xiumi', title: 'Synthetic source label', account: 'Synthetic archive account', via: 'import', attested: false, attestedAt: 0, redistributable: false }),
      block: expect.objectContaining({ id: 'archived-component-block' }),
    })])
    const html = list[0].block.props.html as string
    const src = html.match(/src="([^"]+)"/)?.[1] ?? ''
    expect(src).toMatch(/^\/media\/archived-component-photo\.png\?gen=[a-f0-9]{64}$/)
    const served = await fetch(base + src)
    expect(served.status).toBe(200)
    expect(Buffer.from(await served.arrayBuffer())).toEqual(await zip.file(`assets/${media}.png`)!.async('nodebuffer'))
    const again = await upload()
    expect((await again.json()).plan.components).toMatchObject({ add: [], alreadyPresent: [id] })
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(temp, { recursive: true, force: true })
  }
})

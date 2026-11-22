import { once } from 'node:events'
import { openAsBlob } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { libraryZip, planLibraryBackup } from '../../server/fullLibraryBackup'
import { createBlock } from '../../src/core/blocks'

const MiB = 1024 * 1024
const dims = { width: 1024, height: 1024 }
const photos = Array.from({ length: 11 }, (_, i) => 'photo-' + String(i).padStart(2, '0'))
const reference = photos[0]
const archiveName = (count: number) => 'library-' + count + '.zip'

async function fixture(temp: string) {
  const source = join(temp, 'source')
  const assets = join(source, 'assets')
  const projects = join(source, 'projects')
  await mkdir(assets, { recursive: true })
  await mkdir(projects, { recursive: true })
  const png = await sharp({ create: { ...dims, channels: 3, background: '#285e83' } }).png({ compressionLevel: 0 }).toBuffer()
  expect(png.length).toBeGreaterThan(3 * MiB)
  expect(png.length).toBeLessThan(4 * MiB)
  const body = {
    id: 'referenced', title: 'One used image', themeId: 'tech-blue', author: '', digest: '', createdAt: 1, updatedAt: 1,
    blocks: [createBlock('image', { image: { src: '/media/' + reference + '.png', assetId: reference, ...dims, alt: 'Reference' }, caption: 'A single referenced image' })],
  }
  const manuscript = JSON.stringify(body)
  await writeFile(join(projects, 'referenced.json'), manuscript)
  const index: Record<string, unknown> = {}
  let assetBytes = 0
  for (const [ordinal, id] of photos.entries()) {
    const file = id + '.png'
    const bytes = ordinal === 0 ? png : await sharp({
      create: { ...dims, channels: 3, background: { r: 45 + ordinal, g: 94, b: 131 } },
    }).png({ compressionLevel: 0 }).toBuffer()
    await writeFile(join(assets, file), bytes)
    assetBytes += bytes.length
    index[id] = { id, file, name: id, ...dims, size: bytes.length, createdAt: 1 }
    const count = ordinal + 1
    if (count < 10) continue
    const indexJson = JSON.stringify(index)
    expect(count === 10 ? assetBytes + Buffer.byteLength(indexJson) < 32 * MiB : assetBytes > 32 * MiB).toBe(true)
    await writeFile(join(assets, '_index.json'), indexJson)
    const signal = new AbortController().signal
    const plan = await planLibraryBackup(source, '0.1.0', signal)
    const filePath = join(temp, archiveName(count))
    await writeFile(filePath, libraryZip(plan, signal))
    const measured = (await stat(filePath)).size
    expect(measured).toBeGreaterThan(count * 3 * MiB)
    expect(measured).toBeLessThan(35 * MiB)
  }
  return { png, manuscript, source }
}

it('restores one referenced photo without spending the binary budget on ten unrelated indexed photos', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'xiumi-referenced-archive-budget-'))
  const data = join(temp, 'data')
  const scratch = join(temp, 'scratch')
  await mkdir(scratch)
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: scratch })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const base = 'http://127.0.0.1:' + address.port
    const url = base + '/api/data/restore'
    const { png, manuscript, source } = await fixture(temp)
    function respond(session: { token: string; cookie: string }, action: 'cancel' | 'apply') {
      return fetch(url + '/' + session.token + '/' + action, { method: 'POST',
        headers: { Cookie: session.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'apply' ? { confirm: true } : {}),
      })
    }
    async function preview(count: number, query: string) {
      const form = new FormData()
      form.append('file', await openAsBlob(join(temp, archiveName(count))), archiveName(count))
      const response = await fetch(url + query, { method: 'POST', body: form })
      const body = await response.json()
      expect(await readdir(scratch)).toEqual([])
      expect(await readdir(join(data, 'projects'))).toEqual([])
      expect(await readdir(join(data, 'assets'))).toEqual([])
      return { status: response.status, plan: body.plan, token: body.token, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? '' }
    }

    const modes = ['', '?indexedImages=1', '?components=1', '?standaloneImages=1']
    const states = new Map<string, Awaited<ReturnType<typeof preview>>>()
    for (const count of [10, 11]) for (const query of modes) {
      const state = await preview(count, query)
      states.set(count + ':' + query, state)
      if (state.status === 200) expect((await respond(state, 'cancel')).status).toBe(204)
    }
    for (const count of [10, 11]) {
      const defaultState = states.get(count + ':')!
      expect(defaultState.status).toBe(200)
      expect(defaultState.plan.projects).toEqual({ add: [], skip: [], unsupported: ['referenced'] })
      const indexed = states.get(count + ':?indexedImages=1')!
      expect(indexed.status).toBe(200)
      expect(indexed.plan.projects).toEqual({ add: ['referenced'], skip: [], unsupported: [] })
      expect(indexed.plan.assets).toMatchObject({ add: [reference] })
      expect(indexed.plan.unsupported).toEqual(photos.slice(1, count).map(id => 'assets/' + id + '.png'))
      expect(states.get(count + ':?components=1')!.status).toBe(200)
    }
    expect(states.get('10:?standaloneImages=1')!.status).toBe(200)
    expect(states.get('11:?standaloneImages=1')!.status).toBe(413)
    const session = await preview(11, '?indexedImages=1')
    const apply = await respond(session, 'apply')
    expect(apply.status).toBe(200)
    expect(await apply.json()).toMatchObject({ projects: { restored: ['referenced'] }, assets: { restored: [reference] } })
    expect(await readdir(join(data, 'assets'))).toEqual(['_index.json', reference + '.png'])
    expect((await readFile(join(data, 'assets', reference + '.png'))).equals(png)).toBe(true)
    expect(await readFile(join(source, 'projects/referenced.json'), 'utf8')).toBe(manuscript)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(temp, { recursive: true, force: true })
  }
}, 25_000)

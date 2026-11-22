import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import type { Asset } from '../../server/assets'

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
async function withLibrary<T>(data: string, action: (base: string) => Promise<T>) {
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: data })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No loopback interface')
    return await action('http://127.0.0.1:' + address.port)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
  }
}

async function sourceLibrary(base: string) {
  const upload = new FormData()
  const png = await sharp({ create: { width: 18, height: 12, channels: 4, background: '#d1426980' } }).png().toBuffer()
  const jpg = await sharp({ create: { width: 15, height: 10, channels: 3, background: '#317bb0' } }).jpeg().toBuffer()
  upload.append('files', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'Synthetic source PNG.png')
  upload.append('files', new Blob([new Uint8Array(jpg)], { type: 'image/jpeg' }), 'Synthetic source JPEG.jpg')
  const written = await fetch(base + '/api/assets', { method: 'POST', body: upload })
  expect(written.status).toBe(200)
  const indexed = await written.json() as Asset[]
  expect(indexed.map(a => a.file.split('.').at(-1))).toEqual(['png', 'jpg'])
  expect(await (await fetch(base + '/api/projects')).json()).toEqual([])
  const download = await fetch(base + '/api/data/backup')
  expect(download.status).toBe(200)
  expect(download.headers.get('content-type')).toContain('application/zip')
  return { indexed, backup: Buffer.from(await download.arrayBuffer()) }
}

it.each(['clean', 'conflict', 'late-conflict', 'independent-only', 'combined', 'not-opted-in'] as const)(
  'round-trips an actual asset-only fork download without writing during preview (%s)', async mode => {
    const temp = await mkdtemp(join(tmpdir(), 'xiumi-asset-roundtrip-'))
    try {
      const { indexed, backup } = await withLibrary(join(temp, 'source'), sourceLibrary)
      const zip = await JSZip.loadAsync(backup)
      expect(Object.keys(zip.files).some(name => name.startsWith('projects/'))).toBe(false)
      const [first, second] = indexed
      const data = join(temp, 'target')
      const archived = new Map(await Promise.all(indexed.map(async asset =>
        [asset.id, await zip.file('assets/' + asset.file)!.async('nodebuffer')] as const)))
      let contents: Uint8Array<ArrayBufferLike> = backup
      if (mode === 'independent-only' || mode === 'combined') {
        zip.file('assets/unindexed.png', archived.get(first.id)!)
        zip.file('projects/rejected.json', JSON.stringify({
          id: 'rejected', title: 'Rejected referring manuscript', blocks: [{
            id: 'bad', type: 'image', props: { variant: 'full', caption: '', image: { assetId: first.id, src: 'https://fixture.invalid/different.png' } },
          }],
        }))
        zip.file('projects/linked.json', JSON.stringify({
          id: 'linked', title: 'Valid referring manuscript', blocks: [{
            id: 'linked-image', type: 'image', props: { variant: 'full', caption: '', image: { assetId: first.id, src: '/media/' + first.file } },
          }],
        }))
        contents = await zip.generateAsync({ type: 'nodebuffer' })
      }
      const existing = await sharp({ create: { width: first.width, height: first.height, channels: 4, background: '#118f4280' } }).png().toBuffer()
      const file = join(data, 'assets', first.file)
      const index = join(data, 'assets', '_index.json')
      const collision = async () => {
        await writeFile(file, existing)
        await writeFile(index, JSON.stringify({ [first.id]: { ...first, size: existing.length } }))
      }
      await withLibrary(data, async base => {
        const route = base + '/api/data/restore'
        const preview = async (flags: string) => {
          const form = new FormData()
          form.append('file', new Blob([new Uint8Array(contents)]), 'actual-fork-download.zip')
          const response = await fetch(route + flags, { method: 'POST', body: form })
          expect(response.status).toBe(200)
          return { ...(await response.json()), cookie: response.headers.get('set-cookie')!.split(';', 1)[0] }
        }
        const apply = async ({ token, cookie }: { token: string; cookie: string }) => {
          const response = await fetch(route + '/' + token + '/apply', { method: 'POST', body: '{"confirm":true}',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' } })
          expect(response.status).toBe(200)
          return response.json()
        }
        if (mode === 'conflict') await collision()
        const enabled = mode !== 'not-opted-in'
        const offering = await preview(enabled
          ? '?standaloneImages=1' + (mode === 'combined' ? '&indexedImages=1' : '')
          : '?indexedImages=1')
        expect((await readdir(join(data, 'assets'))).sort()).toEqual(mode === 'conflict' ? ['_index.json', first.file].sort() : [])
        expect(offering.plan.projects.add).toEqual(mode === 'combined' ? ['linked'] : [])
        if (!enabled) {
          expect(offering.plan.assets.add).toEqual([])
          expect(offering.plan.unsupported).toEqual(expect.arrayContaining(indexed.map(a => 'assets/' + a.file)))
          return
        }
        const ids = indexed.map(a => a.id).sort((a, b) => a.localeCompare(b, 'en'))
        const order = mode === 'combined' ? [first.id, second.id] : ids
        expect(offering.plan.assets).toMatchObject({
          add: mode === 'conflict' ? [second.id] : order, skip: mode === 'conflict' ? [first.id] : [],
        })
        if (mode === 'late-conflict') await collision()
        const outcome = await apply(offering)
        const collided = mode === 'conflict' || mode === 'late-conflict'
        expect(outcome.assets.restored).toEqual(collided ? [second.id] : order)
        expect(outcome.assets.skipped).toEqual(collided ? [first.id] : [])
        const projects = await (await fetch(base + '/api/projects')).json()
        expect(projects.map((p: { id: string }) => p.id)).toEqual(mode === 'combined' ? ['linked'] : [])
        if (mode === 'independent-only' || mode === 'combined') {
          expect(outcome.projects.unsupported).toEqual(mode === 'combined' ? ['rejected'] : ['linked', 'rejected'])
          expect(outcome.unsupported).toContain('assets/unindexed.png')
          await expect(readFile(join(data, 'assets', 'unindexed.png'))).rejects.toMatchObject({ code: 'ENOENT' })
        }
        for (const asset of indexed) {
          const expected = asset.id === first.id && collided ? existing : archived.get(asset.id)!
          const generation = sha256(expected)
          const media = await fetch(base + '/media/' + asset.file + '?w=2400&gen=' + generation)
          expect(media.status).toBe(200)
          expect(Buffer.from(await media.arrayBuffer())).toEqual(expected)
          expect(await sharp(expected).metadata()).toMatchObject({ width: asset.width, height: asset.height })
        }
        if (!collided) {
          const before = (await stat(index, { bigint: true })).mtimeNs
          const repeat = await preview('?standaloneImages=1')
          expect(repeat.plan.assets).toEqual({ add: [], skip: [], alreadyPresent: ids })
          expect((await apply(repeat)).assets.restored).toEqual([])
          expect((await stat(index, { bigint: true })).mtimeNs).toBe(before)
        }
      })
    } finally { await rm(temp, { recursive: true, force: true }) }
  },
)

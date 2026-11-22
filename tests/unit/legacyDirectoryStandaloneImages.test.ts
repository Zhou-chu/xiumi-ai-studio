import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'

it.each(['opt-in', 'image-change', 'index-change', 'filename-collision', 'id-collision', 'ambiguous-index', 'catalog-limit'] as const)(
  'restores independent indexed images from an owner-local asset-only directory (%s)', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-standalone-'))
    const source = join(root, 'source')
    const target = join(root, 'target')
    const assets = join(source, 'assets')
    let server: ReturnType<typeof createServer> | undefined
    try {
      await mkdir(assets, { recursive: true })
      const zip = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-image-history.zip', import.meta.url)))
      const png = await zip.file('assets/history-only.png')!.async('nodebuffer')
      const otherPNG = await zip.file('assets/current-only.png')!.async('nodebuffer')
      const jpg = await sharp({ create: { width: 15, height: 10, channels: 3, background: '#2580a8' } }).jpeg().toBuffer()
      const pngName = 'history-only.png'
      const jpegName = 'standalone-jpeg.jpg'
      const archiveIndex = JSON.parse(await zip.file('assets/_index.json')!.async('string'))
      const jpgRecord = { id: 'standalone-jpeg', file: jpegName, name: 'Standalone JPEG', width: 15, height: 10, size: jpg.length, createdAt: 10 }
      const index = { 'history-only': archiveIndex['history-only'], [jpgRecord.id]: jpgRecord }
      const sourceIndex = JSON.stringify(index)
      await writeFile(join(assets, '_index.json'), sourceIndex)
      await writeFile(join(assets, pngName), png)
      await writeFile(join(assets, jpegName), jpg)
      await writeFile(join(assets, 'unindexed.png'), png)
      vi.stubEnv('DATA_DIR', target)
      vi.resetModules()
      const { createApp } = await import('../../server/app')
      server = createServer(createApp({ legacyMigrationSource: source })).listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw Error('missing loopback address')
      const origin = 'http://127.0.0.1:' + address.port
      const path = origin + '/api/data/migrate'
      const send = (suffix = '', body = {}, cookie = '') => fetch(path + suffix, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': origin, 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) },
        body: JSON.stringify(body),
      })
      const targetAssets = join(target, 'assets')
      if (mode === 'ambiguous-index' || mode === 'catalog-limit') {
        const supplemental = mode === 'ambiguous-index'
          ? { 'HISTORY-ONLY': { ...index['history-only'], id: 'HISTORY-ONLY', file: 'HISTORY-ONLY.png' } }
          : Object.fromEntries(Array.from({ length: 5001 }, (_, item) => ['entry-' + item, null]))
        await writeFile(join(assets, '_index.json'), JSON.stringify({ ...index, ...supplemental }))
        expect((await send('', { standaloneImages: true })).status).toBe(mode === 'ambiguous-index' ? 400 : 413)
        expect(await readdir(targetAssets)).toEqual([])
        expect(await readdir(join(target, 'projects'))).toEqual([])
        return
      }
      const preview = async (independent = true) => {
        const response = await send('', independent ? { standaloneImages: true } : {})
        expect(response.status).toBe(200)
        return { ...await response.json(), cookie: response.headers.get('set-cookie')!.split(';', 1)[0] }
      }
      const apply = ({ token, cookie }: { token: string; cookie: string }) => send('/' + token + '/apply', { confirm: true }, cookie)
      if (mode === 'opt-in') {
        expect((await send('', { standaloneImages: false })).status).toBe(400)
        expect((await send('', { standaloneImages: true, path: source })).status).toBe(400)
        const ordinary = await preview(false)
        expect(ordinary.plan).toMatchObject({ add: 0 })
        expect(ordinary.plan.assets).toBeUndefined()
        expect((await apply(ordinary)).status).toBe(200)
        expect(await readdir(targetAssets)).toEqual([])
      }
      if (mode === 'filename-collision') await writeFile(join(targetAssets, pngName), 'unrelated local filename')
      if (mode === 'id-collision') {
        const prior = { 'history-only': { ...index['history-only'], file: 'history-only.jpg' } }
        await writeFile(join(targetAssets, '_index.json'), JSON.stringify(prior))
        await writeFile(join(targetAssets, 'history-only.jpg'), 'unrelated local asset ID')
      }
      const local = await Promise.all((await readdir(targetAssets)).sort().map(async name => ({ name, bytes: await readFile(join(targetAssets, name)) })))
      const attempts = await preview()
      const collision = mode === 'filename-collision' || mode === 'id-collision'
      expect(attempts.plan).toMatchObject({ add: 0, assets: { add: collision ? 1 : 2, skip: collision ? 1 : 0, alreadyPresent: 0 } })
      expect(await readdir(join(target, 'projects'))).toEqual([])
      expect((await readdir(targetAssets)).sort()).toEqual(local.map(entry => entry.name))
      if (mode === 'image-change') {
        expect(otherPNG).toHaveLength(png.length)
        expect(otherPNG).not.toEqual(png)
        await writeFile(join(assets, pngName), otherPNG)
      }
      if (mode === 'index-change') {
        const changed = sourceIndex.replace('Standalone JPEG', 'Standalone JPG!')
        expect(changed).toHaveLength(sourceIndex.length)
        expect(changed).not.toBe(sourceIndex)
        await writeFile(join(assets, '_index.json'), changed)
      }
      expect((await send('/' + attempts.token + '/apply', { confirm: true, standaloneImages: true }, attempts.cookie)).status).toBe(400)
      const applied = await apply(attempts)
      expect(await readdir(join(target, 'projects'))).toEqual([])
      if (mode === 'image-change' || mode === 'index-change') {
        expect(applied.status).toBe(409)
        expect(await readdir(targetAssets)).toEqual([])
        return
      }
      expect(applied.status).toBe(200)
      expect(await applied.json()).toMatchObject({ restored: 0, assets: { restored: collision ? 1 : 2, skipped: collision ? 1 : 0, failed: 0 } })
      expect(await readFile(join(targetAssets, jpegName))).toEqual(jpg)
      const jpeg = await fetch(origin + '/media/' + jpegName + '?w=2400&gen=' + createHash('sha256').update(jpg).digest('hex'))
      expect(jpeg.status).toBe(200)
      expect(Buffer.from(await jpeg.arrayBuffer())).toEqual(jpg)
      if (mode === 'filename-collision') expect(await readFile(join(targetAssets, pngName), 'utf8')).toBe('unrelated local filename')
      if (mode === 'id-collision') {
        expect(await readFile(join(targetAssets, 'history-only.jpg'), 'utf8')).toBe('unrelated local asset ID')
        expect(JSON.parse(await readFile(join(targetAssets, '_index.json'), 'utf8'))['history-only'])
          .toEqual(JSON.parse(local.find(entry => entry.name === '_index.json')!.bytes.toString('utf8'))['history-only'])
      }
      if (!collision) {
        expect(await readFile(join(targetAssets, pngName))).toEqual(png)
        expect((await preview()).plan.assets).toMatchObject({ add: 0, alreadyPresent: 2 })
      }
      expect(await readFile(join(assets, '_index.json'), 'utf8')).toBe(sourceIndex)
      expect(await readFile(join(assets, pngName))).toEqual(png)
      expect(await readFile(join(assets, jpegName))).toEqual(jpg)
      expect(await readdir(targetAssets)).not.toContain('unindexed.png')
    } finally {
      if (server) {
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
      }
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  },
)

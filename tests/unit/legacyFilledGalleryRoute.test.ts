import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { unzipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { variantUrl } from '../../src/core/managedMediaUrl'
import type { Block, Doc } from '../../src/core/types'

async function withLibrary<T>(run: (base: string, data: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-project-gallery-'))
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

it('round-trips a filled gallery and its history-only image through the native backup', async () => {
  const fixture = await withLibrary(async (base, data) => {
    const { emptyDoc } = await import('../../src/editor/store')
    const { assetRef } = await import('../../src/editor/api')
    const upload = new FormData()
    for (const [i, background] of ['#175273', '#dc3853', '#ee945b'].entries()) {
      const png = await sharp({ create: { width: 10, height: 9, channels: 3, background } }).png().toBuffer()
      upload.append('files', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'gallery-' + i + '.png')
    }
    const response = await fetch(base + '/api/assets', { method: 'POST', body: upload })
    expect(response.ok).toBe(true)
    const assets: Parameters<typeof assetRef>[0][] = await response.json()
    expect(assets).toHaveLength(3)
    const refs = assets.map(assetRef)
    const gallery: Block<'gallery'> = { id: 'native-gallery-block', type: 'gallery', props: {
      images: [refs[1], refs[0]], columns: 2, caption: 'Edited gallery <em>&',
    } }
    const article: Doc = { ...emptyDoc(), id: 'native-gallery', blocks: [gallery] }
    const resource = base + '/api/projects/' + article.id
    expect((await fetch(resource, { method: 'PUT', ...json(article) })).ok).toBe(true)
    const historical: Block<'gallery'> = { ...gallery, props: { ...gallery.props, images: [refs[0], refs[2]], caption: 'Historical gallery' } }
    const historyResponse = await fetch(resource + '/versions', {
      method: 'POST', ...json({ label: 'Before change', doc: { ...article, blocks: [historical] } }),
    })
    expect(historyResponse.ok).toBe(true)
    const snapshot = await historyResponse.json()
    const backup = await fetch(base + '/api/data/backup')
    expect(backup.ok).toBe(true)
    const bytes = await Promise.all(assets.map(asset => readFile(join(data, 'assets', asset.file))))
    return { zip: await backup.blob(), gallery, historical, snapshot, refs, bytes }
  })
  const form = () => {
    const body = new FormData()
    body.set('file', fixture.zip, 'native-gallery.zip')
    return body
  }
  await withLibrary(async (base, data) => {
    const route = base + '/api/data/restore'
    const optedOut = await fetch(route, { method: 'POST', body: form() })
    expect(optedOut.ok).toBe(true)
    expect((await optedOut.json()).plan.projects.unsupported).toEqual(['native-gallery'])
    expect(await readdir(join(data, 'assets'))).toEqual([])
  })
  await withLibrary(async (base, data) => {
    const route = base + '/api/data/restore'
    const preview = await fetch(route + '?indexedImages=1', { method: 'POST', body: form() })
    expect(preview.ok).toBe(true)
    const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await preview.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual([])
    expect(plan.projects.add).toEqual(['native-gallery'])
    expect(plan.projects.unsupported).toEqual([])
    expect(plan.assets.add.sort()).toEqual(fixture.refs.map(ref => ref.assetId).sort())
    const applied = await fetch(route + '/' + token + '/apply', { method: 'POST', ...json({ confirm: true }),
      headers: { 'Content-Type': 'application/json', Cookie: cookie } })
    expect(applied.ok).toBe(true)
    const result = await applied.json()
    const resource = base + '/api/projects/native-gallery'
    expect(result.versions.restored).toEqual(['native-gallery/' + fixture.snapshot.id])
    const live = await fetch(resource)
    const historical = await fetch(resource + '/versions/' + fixture.snapshot.id)
    expect(live.ok && historical.ok).toBe(true)
    const documents: Doc[] = [await live.json(), (await historical.json()).doc]
    for (const [i, expected] of [fixture.gallery, fixture.historical].entries()) {
      const doc = documents[i]
      const gallery = doc.blocks[0] as Block<'gallery'>
      expect(gallery.id).toBe(expected.id)
      expect(gallery.props.columns).toBe(expected.props.columns)
      expect(gallery.props.caption).toBe(expected.props.caption)
      expect(gallery.props.images.map(image => image.assetId)).toEqual(expected.props.images.map(image => image.assetId))
      const html = compileDoc(doc).html
      let previous = -1
      for (const image of gallery.props.images) {
        expect(image.src).toMatch(/\?gen=[a-f0-9]{64}$/)
        const variant = variantUrl(image.src, undefined, 2400)
        const response = await fetch(base + variant)
        expect(response.ok).toBe(true)
        const sourceIndex = fixture.refs.findIndex(source => source.assetId === image.assetId)
        expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.bytes[sourceIndex])
        const at = html.indexOf(variantUrl(image.src, '4:3', 720).replaceAll('&', '&amp;'))
        expect(at).toBeGreaterThan(previous)
        previous = at
      }
    }
  })
}, 20_000)

it('reopens the genuine upstream ZIP with ordered gallery refs and byte-identical history assets', async () => {
  const zip = await readFile(new URL('../fixtures/legacy-backup/upstream-filled-gallery.zip', import.meta.url))
  const entries = unzipSync(new Uint8Array(zip))
  const id = 'upstream-native-gallery'
  const project: Doc = JSON.parse(Buffer.from(entries['projects/' + id + '.json']).toString('utf8'))
  const version = '1795441821592-HIwX'
  const history: { doc: Doc } = JSON.parse(Buffer.from(entries['versions/' + id + '/' + version + '.json']).toString('utf8'))
  await withLibrary(async (base, data) => {
    const route = base + '/api/data/restore'
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(zip)], { type: 'application/zip' }), 'upstream-filled-gallery.zip')
    const response = await fetch(route + '?indexedImages=1', { method: 'POST', body: form })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    expect(plan.projects.add).toEqual([id])
    expect(plan.versions.add).toEqual([id + '/' + version])
    expect(await readdir(join(data, 'projects'))).toEqual([])
    const applied = await fetch(route + '/' + token + '/apply', { method: 'POST', ...json({ confirm: true }),
      headers: { 'Content-Type': 'application/json', Cookie: cookie } })
    expect(applied.status).toBe(200)
    const reopened: Doc = await (await fetch(base + '/api/projects/' + id)).json()
    const reopenedHistory: { doc: Doc } = await (await fetch(base + '/api/projects/' + id + '/versions/' + version)).json()
    for (const [expected, actual] of [[project, reopened], [history.doc, reopenedHistory.doc]]) {
      const before = expected.blocks[0] as Block<'gallery'>
      const after = actual.blocks[0] as Block<'gallery'>
      expect(after.props.columns).toBe(before.props.columns)
      expect(after.props.caption).toBe(before.props.caption)
      expect(after.props.images.map(({ src, ...metadata }) => ({ src: src.split('?')[0], ...metadata }))).toEqual(before.props.images)
      for (const image of after.props.images) {
        expect(image.src).toMatch(/\?gen=[a-f0-9]{64}$/)
        const file = image.src.split('?')[0].slice('/media/'.length)
        expect(await readFile(join(data, 'assets', file))).toEqual(Buffer.from(entries['assets/' + file]))
      }
    }
  })
}, 20_000)

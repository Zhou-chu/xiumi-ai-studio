import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { variantUrl } from '../../src/core/managedMediaUrl'
import type { Block, Doc } from '../../src/core/types'

async function withLibrary<T>(run: (base: string, data: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-project-carousel-'))
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


it('restores an upstream populated carousel and its historical slots without external media', async () => {
  const zip = await readFile(new URL('../fixtures/legacy-backup/upstream-filled-carousel.zip', import.meta.url))
  const entries = unzipSync(new Uint8Array(zip))
  const id = 'upstream-native-carousel'
  const [snapshotPath] = Object.keys(entries).filter(name => name.startsWith('versions/' + id + '/'))
  const version = snapshotPath.split('/').at(-1)!.replace(/\.json$/, '')
  const expected: Doc = JSON.parse(Buffer.from(entries['projects/' + id + '.json']).toString('utf8'))
  const earlier: { doc: Doc } = JSON.parse(Buffer.from(entries[snapshotPath]).toString('utf8'))
  const body = () => {
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(zip)], { type: 'application/zip' }), 'upstream-filled-carousel.zip')
    return form
  }
  await withLibrary(async (base, data) => {
    const route = base + '/api/data/restore'
    const withoutImages = await fetch(route, { method: 'POST', body: body() })
    expect(withoutImages.status).toBe(200)
    expect((await withoutImages.json()).plan.projects.unsupported).toEqual([id])
    expect(await readdir(join(data, 'projects'))).toEqual([])
  })
  await withLibrary(async (base, data) => {
    const route = base + '/api/data/restore'
    const preview = await fetch(route + '?indexedImages=1', { method: 'POST', body: body() })
    expect(preview.status).toBe(200)
    const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await preview.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual([])
    expect(plan.projects.add).toEqual([id])
    expect(plan.versions.add).toEqual([id + '/' + version])
    expect(plan.assets.add).toHaveLength(3)
    const applied = await fetch(route + '/' + token + '/apply', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ confirm: true }) })
    expect(applied.status).toBe(200)
    expect((await applied.json()).versions.restored).toEqual([id + '/' + version])
    const actual = await fetch(base + '/api/projects/' + id)
    const historical = await fetch(base + '/api/projects/' + id + '/versions/' + version)
    expect(actual.ok && historical.ok).toBe(true)
    const picked: Doc[] = [await actual.json(), (await historical.json()).doc]
    for (const [i, source] of [expected, earlier.doc].entries()) {
      const before = source.blocks[0] as Block<'carousel'>
      const after = picked[i].blocks[0] as Block<'carousel'>
      expect(after.id).toBe(before.id)
      expect(after.props).toMatchObject({ label: before.props.label, ratio: before.props.ratio, variant: before.props.variant })
      expect(after.props.pics.map(({ image, caption }) => image ? { caption, image: { ...image, src: image.src.split('?')[0] } } : { caption }))
        .toEqual(before.props.pics)
      const html = compileDoc(picked[i]).html
      expect(html).toContain('Ordinary &lt;Native&gt;&amp;')
      expect(html).toContain(i === 0 ? 'First &lt;Live&gt;&amp;' : 'History only')
      expect(html).not.toContain(i === 0 ? 'Empty middle' : 'Empty first')
      expect(html).toContain('width:' + (i === 0 ? '168%' : '200%'))
      let previous = -1
      for (const { image } of after.props.pics) {
        if (!image) continue
        expect(image.src).toMatch(/^\/media\/[\w-]+\.jpg\?gen=[a-f0-9]{64}$/)
        const renderedUrl = variantUrl(image.src, after.props.ratio, 720)
        const where = html.indexOf(renderedUrl.replaceAll('&', '&amp;'))
        expect(where).toBeGreaterThan(previous)
        previous = where
        const sourceBytes = entries['assets/' + image.src.split('?')[0].slice('/media/'.length)]
        const original = await fetch(base + variantUrl(image.src, undefined, 2400))
        expect(original.status).toBe(200)
        expect(Buffer.from(await original.arrayBuffer())).toEqual(Buffer.from(sourceBytes))
        expect((await fetch(base + renderedUrl)).ok).toBe(true)
      }
    }
  })
}, 20_000)

it('does not read an unused invalid raster on behalf of a structurally unsupported carousel', async () => {
  const fixture = await readFile(new URL('../fixtures/legacy-backup/upstream-filled-carousel.zip', import.meta.url))
  const entries = unzipSync(new Uint8Array(fixture))
  const id = 'upstream-native-carousel'
  const filename = 'projects/' + id + '.json'
  const doc: Doc = JSON.parse(Buffer.from(entries[filename]).toString('utf8'))
  const carousel = doc.blocks[0] as Block<'carousel'>
  const file = 'assets/' + carousel.props.pics[0].image!.src.slice('/media/'.length)
  // Ordinary bad file content: catalog/ZIP sizes still match; this member
  // must not be decoded at all for the unsupported carousel.
  entries[file] = new Uint8Array(entries[file].length).fill(32)
  entries[filename] = Buffer.from(JSON.stringify({ ...doc, blocks: [{ ...carousel, props: { ...carousel.props, ratio: '2:1' } }] }))
  for (const name of Object.keys(entries)) if (name.startsWith('versions/' + id + '/')) delete entries[name]
  entries['projects/safe-text.json'] = Buffer.from(JSON.stringify({ id: 'safe-text', title: 'Safe independent document', blocks: [] }))
  await withLibrary(async (base, data) => {
    const route = base + '/api/data/restore'
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(zipSync(entries))]), 'invalid-media-unused.zip')
    const preview = await fetch(route + '?indexedImages=1', { method: 'POST', body: form })
    expect(preview.status).toBe(200)
    const { token, plan } = await preview.json()
    expect(plan.projects.add).toEqual(['safe-text'])
    expect(plan.projects.unsupported).toEqual([id])
    expect(plan.assets.add).toEqual([])
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual([])
    const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
    const applied = await fetch(route + '/' + token + '/apply', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ confirm: true }) })
    expect(applied.status).toBe(200)
    expect((await applied.json()).projects.restored).toEqual(['safe-text'])
    expect(await readdir(join(data, 'assets'))).toEqual([])
  })
}, 20_000)

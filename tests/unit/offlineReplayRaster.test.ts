import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { compileOfflineReplay } from '../../src/editor/wechatOutput'
import { compileReplay } from '../../src/core/compiler'
import { defaultReplay, makeItem, makeScene, normalizeReplay } from '../../src/core/replay/schema'
import type { Block, Doc, ImageRef } from '../../src/core/types'

const file = 'archived-component-photo.png'
const aid = 'archived-component-photo'
const asset = (name: string, bytes: Buffer) => ({
  id: name.replace(/\.[^.]+$/, ''), file: name, name, size: bytes.length, generation: digest(bytes), createdAt: 1, width: 8, height: 6,
})
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function replay(bg?: ImageRef, photo?: ImageRef): Block<'replay'> {
  return {
    id: 'owned-replay',
    type: 'replay',
    props: {
      ...defaultReplay(),
      ...(bg && { canvas: { width: 750, background: { type: 'image', value: '#202020', image: bg } } }),
      scenes: [makeScene([makeItem('title', { content: 'Offline fixture' }), makeItem('image', { image: photo, label: 'Owned photo' })])],
    },
  }
}
const documentOf = (block: Block<'replay'>): Doc => ({
  id: 'offline-article', title: 'Offline raster', author: '', digest: '', themeId: 'tsinghua-purple',
  createdAt: 1, updatedAt: 1, blocks: [block],
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('keeps valid managed generation on replay background and item through normalization and drawing', () => {
  const src = '/media/' + file + '?gen=' + 'a'.repeat(64)
  const block = replay({ src, assetId: aid }, { src, assetId: aid })
  const decoded = normalizeReplay(block.props)
  expect(decoded.canvas.background.image?.src).toBe(src)
  expect(decoded.scenes[0].items[1].image?.src).toBe(src)
  const refs: string[] = []
  const html = compileReplay({ ...block, props: decoded }, { mapImage: value => (refs.push(value), value) }).html
  expect(refs).toEqual(Array(2).fill('/media/' + file + '?w=1500&gen=' + 'a'.repeat(64)))
  expect(html.match(/<image\b/g)).toHaveLength(2)
})

it('writes bytes from verified same-origin indexed PNG and JPEG into self-contained SVG replay HTML', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'xiumi-replay-raster-'))
  const data = join(temp, 'library')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp()).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const zip = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-component.zip', import.meta.url)))
    const png = await zip.file('assets/' + file)!.async('nodebuffer')
    const jpeg = await sharp(png).jpeg().toBuffer()
    const checked = [asset(file, png), asset('offline-item.jpg', jpeg)]
    for (const [i, bytes] of [png, jpeg].entries()) await writeFile(join(data, 'assets', checked[i].file), bytes)
    await writeFile(join(data, 'assets', '_index.json'), JSON.stringify(Object.fromEntries(checked.map(a => [a.id, a]))))
    const transport = fetch
    const requests = vi.fn((route: string, init: RequestInit) => transport('http://127.0.0.1:' + address.port + route, init))
    vi.stubGlobal('fetch', requests)
    const block = replay({ src: '/media/' + file + '?gen=' + checked[0].generation, assetId: checked[0].id }, { src: '/media/offline-item.jpg', assetId: checked[1].id })
    const html = await compileOfflineReplay(documentOf(block))
    expect(html).toContain('default-src \'none\'')
    expect(html).toContain('<animate')
    expect(html).toContain('Offline fixture')
    expect(html).toContain('href="data:image/png;base64,' + png.toString('base64') + '"')
    expect(html).toContain('href="data:image/jpeg;base64,' + jpeg.toString('base64') + '"')
    expect(html).not.toMatch(/href="\/media\/|https?:\/\/mmbiz/)
    expect(requests.mock.calls.map(([url]) => url).sort()).toEqual([
      '/api/assets', ...checked.map(a => '/media/' + a.file + '?w=2400&gen=' + a.generation),
    ].sort())
    expect(requests.mock.calls.every(([, init]) => init.redirect === 'error' && init.mode === 'same-origin')).toBe(true)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(temp, { recursive: true, force: true })
  }
})

it.each([
  { src: 'https://example.invalid/remote.png' }, { src: 'data:image/png;base64,AA==' },
  { src: '/media/sample.svg' }, { src: '/media/sample.png?gen=bad' },
  { src: '/media/sample.png?gen=' + 'a'.repeat(64) + '&unused=1' },
  { src: '/media/sample.png', assetId: 'unrelated' },
])('rejects an unsupported or mismatched replay image before issuing any request (%j)', async image => {
  const requests = vi.fn()
  vi.stubGlobal('fetch', requests)
  await expect(compileOfflineReplay(documentOf(replay(image)))).rejects.toThrow(/已索引/)
  expect(requests).not.toHaveBeenCalled()
})

it('does not need the inventory for text-only replay and refuses duplicate or stale media without an asset read', async () => {
  const requests = vi.fn()
  vi.stubGlobal('fetch', requests)
  await expect(compileOfflineReplay(documentOf(replay()))).resolves.toContain('<animate')
  expect(requests).not.toHaveBeenCalled()
  const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#000' } }).png().toBuffer()
  const checked = asset(file, png)
  const item = { src: '/media/' + file, assetId: aid }
  for (const catalog of [[checked, checked], [{ ...checked, generation: 'different' }], []]) {
    requests.mockReset().mockResolvedValue(Response.json(catalog))
    await expect(compileOfflineReplay(documentOf(replay(item)))).rejects.toThrow(/已索引/)
    expect(requests.mock.calls.map(([url]) => url)).toEqual(['/api/assets'])
  }
  requests.mockReset().mockResolvedValue(Response.json([checked]))
  await expect(compileOfflineReplay(documentOf(replay({ ...item, src: item.src + '?gen=' + 'a'.repeat(64) })))).rejects.toThrow(/已索引/)
  expect(requests).toHaveBeenCalledTimes(1)
})

it.each(['mime', 'signature', 'short', 'long', 'missing'] as const)('refuses a bad owned image response rather than creating a partial file (%s)', async mode => {
  const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#000' } }).png().toBuffer()
  const checked = asset(file, png)
  let bytes = Buffer.from(png)
  if (mode === 'signature') bytes[0] = 0
  if (mode === 'short') bytes = bytes.subarray(0, -1)
  if (mode === 'long') bytes = Buffer.concat([bytes, Buffer.from([0])])
  const requests = vi.fn((url: string) => Promise.resolve(url === '/api/assets' ? Response.json([checked]) : new Response(new Uint8Array(bytes), {
    status: mode === 'missing' ? 404 : 200,
    headers: { 'Content-Type': mode === 'mime' ? 'image/svg+xml' : 'image/png' },
  })))
  vi.stubGlobal('fetch', requests)
  await expect(compileOfflineReplay(documentOf(replay({ src: '/media/' + file, assetId: aid })))).rejects.toThrow(/已索引/)
  expect(requests.mock.calls.map(([url]) => url)).toEqual(['/api/assets', '/media/' + file + '?w=2400&gen=' + checked.generation])
})

it('rejects oversized records and invalid inventory shape before requesting bytes', async () => {
  const requests = vi.fn()
  vi.stubGlobal('fetch', requests)
  const img = { src: '/media/' + file, assetId: aid }
  const doc = documentOf(replay(img))
  const limited = { id: aid, file, size: 8 * 1024 * 1024 + 1 }
  for (const response of [Response.json([limited]), Response.json({ entries: [] }), new Response('', { status: 503 })]) {
    requests.mockReset().mockResolvedValueOnce(response)
    await expect(compileOfflineReplay(doc)).rejects.toThrow()
    expect(requests.mock.calls.map(([url]) => url)).toEqual(['/api/assets'])
  }
  const sources = ['a', 'b', 'c'].map(file => ({ id: file, file: file + '.png', size: 6 * 1024 * 1024 }))
  requests.mockReset().mockResolvedValueOnce(Response.json(sources))
  const block = replay({ src: '/media/a.png', assetId: 'a' }, { src: '/media/b.png', assetId: 'b' })
  block.props.scenes[0].items.push(makeItem('image', { image: { src: '/media/c.png', assetId: 'c' } }))
  await expect(compileOfflineReplay(documentOf(block))).rejects.toThrow('16 MiB')
  expect(requests.mock.calls.map(([url]) => url)).toEqual(['/api/assets'])
})

it('reads one canonical legacy asset when both item and background share its file', async () => {
  const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#000' } }).png().toBuffer()
  const { generation: _ignored, ...legacy } = asset(file, png)
  expect(_ignored).toHaveLength(64)
  const requests = vi.fn((url: string) => Promise.resolve(url === '/api/assets' ? Response.json([legacy]) : new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png; charset=binary' } })))
  vi.stubGlobal('fetch', requests)
  const img = { src: '/media/' + file, assetId: aid }
  const html = await compileOfflineReplay(documentOf(replay(img, img)))
  expect(html.match(/href="data:image\/png/gu)).toHaveLength(2)
  expect(requests.mock.calls.map(([url]) => url)).toEqual(['/api/assets', '/media/' + file + '?w=2400'])
})

it('bounds the expanded repeated raster payload, not only the distinct files being read', async () => {
  const local = { id: 'foo', file: 'foo.png', size: 6 * 1024 * 1024 }
  const requests = vi.fn().mockResolvedValueOnce(Response.json([local]))
  vi.stubGlobal('fetch', requests)
  const ref = { src: '/media/foo.png', assetId: 'foo' }
  const block = replay(ref, ref)
  block.props.scenes[0].items.push(makeItem('image', { image: ref }))
  await expect(compileOfflineReplay(documentOf(block))).rejects.toThrow('16 MiB')
  expect(requests).toHaveBeenCalledTimes(1)
})

it('bounds the inventory body before parsing even if it contains a normal matching entry', async () => {
  const requests = vi.fn().mockResolvedValueOnce(Response.json([{
    id: 'foo', file: 'foo.png', size: 8, ignoredLabel: 'x'.repeat(4 * 1024 * 1024),
  }]))
  vi.stubGlobal('fetch', requests)
  await expect(compileOfflineReplay(documentOf(replay({ src: '/media/foo.png', assetId: 'foo' })))).rejects.toThrow('素材库')
  expect(requests).toHaveBeenCalledTimes(1)
})

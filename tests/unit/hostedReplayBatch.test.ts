import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let directory: string
let media: typeof import('../../server/assets')
let prepare: typeof import('../../server/hostedReplayBatch').prepareHostedReplayBatch
const approved = 'https://mmbiz.qpic.cn/mock/out/0?wx_fmt=jpeg'
const jpeg = (background: string) => sharp({ create: { width: 120, height: 90, channels: 3, background } }).jpeg().toBuffer()
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hosted-replay-batch-'))
  vi.stubEnv('DATA_DIR', directory)
  vi.resetModules()
  media = await import('../../server/assets')
  prepare = (await import('../../server/hostedReplayBatch')).prepareHostedReplayBatch
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

async function fixture(background: string) {
  const asset = await media.saveAsset(await jpeg(background), 'fixture.jpg')
  const data = await media.variantPath(asset.file, undefined, 2400)
  const { readFile } = await import('node:fs/promises')
  const generation = createHash('sha256').update(await readFile(data)).digest('hex')
  return { asset, generation, source: '/media/' + asset.file + '?fit=1%3A1&w=64&gen=' + generation }
}

it('rejects a late invalid owned source before any transfer', async () => {
  const a = await fixture('red')
  const b = await fixture('blue')
  const send = vi.fn().mockResolvedValue(approved)
  await expect((async () => (await prepare([a.source, b.source.replace(b.generation, 'a'.repeat(64))])).transfer(true, send))()).rejects.toThrow(/素材/)
  expect(send).not.toHaveBeenCalled()
})

it('freezes genuine cropped variants independent of later asset deletion and caller mutation', async () => {
  const a = await fixture('red')
  const b = await fixture('blue')
  const sources = [a.source, b.source]
  const pending = prepare(sources)
  sources[0] = 'https://unregistered.invalid/'
  const batch = await pending
  expect(batch.sources).toEqual([a.source, b.source])
  expect(Object.isFrozen(batch.sources)).toBe(true)
  await media.deleteAsset(a.asset.id)
  await media.deleteAsset(b.asset.id)
  const colors: number[][] = []
  const send = vi.fn(async (raster: { blob: Blob; source: string }) => {
    expect(Object.isFrozen(raster)).toBe(true)
    expect(raster.blob.type).toBe('image/jpeg')
    const decoded = sharp(Buffer.from(await raster.blob.arrayBuffer()))
    expect(await decoded.metadata()).toMatchObject({ format: 'jpeg', width: 64, height: 64 })
    const rgb = await decoded.raw().toBuffer()
    colors.push([...rgb.subarray(0, 3)])
    return approved
  })
  expect(await batch.transfer(true, send)).toEqual({ [a.source]: approved, [b.source]: approved })
  expect(colors[0][0]).toBeGreaterThan(200)
  expect(colors[1][2]).toBeGreaterThan(200)
  await expect(batch.transfer(true, send)).rejects.toThrow(/已使用/)
})

it('never transfers before consent, and identifies irreversible effects on an invalid late response', async () => {
  const a = await fixture('red')
  const b = await fixture('blue')
  const send = vi.fn().mockResolvedValueOnce(approved).mockResolvedValueOnce('https://foreign.invalid/raw')
  expect(await (await prepare([a.source])).transfer(false, send)).toBe(null)
  expect(send).not.toHaveBeenCalled()
  await expect((await prepare([a.source, b.source])).transfer(true, send)).rejects.toMatchObject({
    confirmedImages: 1, attemptedImages: 2, sideEffectsUnknown: true, message: expect.stringContaining('无法撤回'),
  })
  expect(send).toHaveBeenCalledTimes(2)
})

it.each([
  'https://foreign.invalid/asset.jpg',
  '/media/../asset.jpg',
  '/media/a.svg',
  '/media/a.jpg?w=64&w=65',
  '/media/a.jpg?w=63',
  '/media/a.jpg?w=9999',
  '/media/a.jpg?fit=0:1',
  '/media/a.jpg?fit=999:0',
  '/media/a.jpg?fit=1:999&w=2400',
  '/media/a.jpg?other=key',
  '/media/a.jpg?gen=abc',
  '/media/unindexed.jpg',
])('starts no transfer for unsupported variant %s', async (source) => {
  const a = await fixture('red')
  const send = vi.fn().mockResolvedValue(approved)
  await expect((async () => (await prepare([a.source, source])).transfer(true, send))()).rejects.toThrow(/素材/)
  expect(send).not.toHaveBeenCalled()
})

it('does not pretend a rejected first send is safely unwritten or retry automatically', async () => {
  const a = await fixture('red')
  const send = vi.fn().mockRejectedValue(new Error('fixture disconnected'))
  const plan = await prepare([a.source])
  await expect(plan.transfer(true, send)).rejects.toMatchObject({
    confirmedImages: 0, attemptedImages: 1, sideEffectsUnknown: true,
  })
  await expect(plan.transfer(true, send)).rejects.toThrow(/已使用/)
  expect(send).toHaveBeenCalledOnce()
})

it('limits batch size and rejects duplicate variants before any preparation', async () => {
  const a = await fixture('red')
  await expect(prepare([])).rejects.toThrow(/素材/)
  await expect(prepare([a.source, a.source])).rejects.toThrow(/素材/)
  await expect(prepare(Array.from({ length: 33 }, (_, i) => '/media/fixture' + i + '.jpg'))).rejects.toThrow(/素材/)
})

it('does not grow or flatten a genuine PNG and supports distinct variants of one indexed source', async () => {
  const bytes = await sharp({ create: { width: 120, height: 90, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.4 } } }).png().toBuffer()
  const a = await media.saveAsset(bytes, 'fixture.png')
  const source = '/media/' + a.file
  const variants = [source, source + '?w=64']
  const send = vi.fn(async (raster: { blob: Blob }) => {
    expect(raster.blob.type).toBe('image/png')
    const metadata = await sharp(Buffer.from(await raster.blob.arrayBuffer())).metadata()
    expect(metadata.hasAlpha).toBe(true)
    expect(metadata.width).toBe(send.mock.calls.length === 1 ? 120 : 64)
    return 'https://mmbiz.qlogo.cn/mock/out/0'
  })
  const mapping = await (await prepare(variants)).transfer(true, send)
  expect(Object.isFrozen(mapping)).toBe(true)
  expect(Object.keys(mapping!)).toEqual(variants)
})

it('feeds the exact verified batch mapping back into the real SVG planner and requires final download consent', async () => {
  const { defaultReplay, makeScene, makeItem } = await import('../../src/core/replay/schema')
  const { prepareHostedReplayXiumi } = await import('../../src/editor/wechatOutput')
  const { asset, generation } = await fixture('indigo')
  const replay = defaultReplay()
  const image = { src: '/media/' + asset.file + '?gen=' + generation, assetId: asset.id }
  replay.scenes = [makeScene([makeItem('title', { content: 'Real replay fixture' }), makeItem('image', { image })])]
  const doc = { id: 'batch', title: 'Batch', author: '', digest: '', themeId: 'tsinghua-purple' as const, createdAt: 1, updatedAt: 1,
    blocks: [{ id: 'block', type: 'replay' as const, props: replay }] }
  const send = vi.fn().mockResolvedValue(approved)
  const download = vi.fn()
  const consent = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
  const hooks = { confirmUpload: vi.fn(() => true), download, confirmDownload: consent,
    upload: async (sources: readonly string[]) => (await prepare(sources)).transfer(true, send) }
  expect(await prepareHostedReplayXiumi(doc, [asset]).run(hooks)).toBe('cancelled-after-upload')
  expect(download).not.toHaveBeenCalled()
  expect(await prepareHostedReplayXiumi(doc, [asset]).run(hooks)).toBe('downloaded')
  const result = await download.mock.calls[0][0].blob.text()
  expect(result).toContain('<image href="' + approved)
  expect(result).not.toContain('/media/')
  expect(send.mock.calls[0][0].generation).toBe(generation)
})

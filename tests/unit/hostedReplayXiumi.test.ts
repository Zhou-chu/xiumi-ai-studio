import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { defaultReplay, makeItem, makeScene } from '../../src/core/replay/schema'
import type { Block, Doc } from '../../src/core/types'
import { XIUMI_LIMIT, xiumiLength, xiumiSvgBoxes } from '../../src/core/xiumiExport'
import { prepareHostedReplayXiumi } from '../../src/editor/wechatOutput'
import { assertHostedReplayLinks } from '../../src/editor/hostedReplayXiumi'

const file = 'fixture.png'
const png = { id: 'fixture', file }
const media = '/media/' + file
const fixtureUrl = 'https://mmbiz.qpic.cn/demo/frozen.png'
const asset = (length: number) => 'https://mmbiz.qpic.cn/demo/' + 'a'.repeat(length) + '.png'

function documentOf() {
  const replay = defaultReplay()
  replay.canvas.background = { type: 'image', value: '#071226', image: { src: media, assetId: png.id } }
  replay.scenes = [makeScene([
    makeItem('title', { content: 'Synthetic replay title' }),
    makeItem('image', { image: { src: media, assetId: png.id }, label: 'Synthetic replay bitmap' }),
  ])]
  const block: Block<'replay'> = { id: 'hosted-replay', type: 'replay', props: replay }
  const doc: Doc = { id: 'fixture', title: 'Before confirmation', author: '', digest: '', themeId: 'tsinghua-purple', createdAt: 1, updatedAt: 1, blocks: [block] }
  return { doc, block }
}
function inertHooks(url = fixtureUrl) {
  return {
    confirmUpload: vi.fn(() => true),
    upload: vi.fn(async (urls: readonly string[]) => Object.fromEntries(urls.map(source => [source, url]))),
    confirmDownload: vi.fn(() => true),
    download: vi.fn<(result: { blob: Blob; name: string; parts: number }) => void>(),
  }
}
afterEach(() => vi.unstubAllGlobals())

it('preflights replay media before any side effect, then recompiles the immutable snapshot through inert callbacks', async () => {
  const { doc, block } = documentOf()
  const ordinary: Block<'image'> = { id: 'ordinary-photo', type: 'image', props: { variant: 'full', caption: 'Ordinary image witness', image: { src: media } } }
  doc.blocks.push(ordinary)
  doc.blocks.push({ id: 'css-photo', type: 'html', props: { html: '<section style="background-image:url(&quot;/media/fixture.png?w=1500&quot;)">Background witness</section>', label: 'CSS image' } })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const hooks = inertHooks()
  const plan = prepareHostedReplayXiumi(doc, [png])
  expect(plan.parts).toBe(1)
  expect(plan.images).toBeGreaterThanOrEqual(2)
  expect(hooks.upload).not.toHaveBeenCalled()
  doc.blocks.splice(0)
  block.props.scenes[0].items[0].content = 'Unexpected edit'
  expect(await plan.run(hooks)).toBe('downloaded')
  const sources = hooks.upload.mock.calls[0][0]
  expect(sources).toContain(media + '?w=1500')
  expect(Object.isFrozen(sources)).toBe(true)
  expect(hooks.confirmUpload).toHaveBeenCalledWith({ parts: 1, images: sources.length })
  expect(hooks.confirmDownload).toHaveBeenCalledWith({ plannedParts: 1, actualParts: 1, uploadedImages: sources.length })
  const out = await hooks.download.mock.calls[0][0].blob.text()
  expect(out).toContain('Synthetic replay title')
  expect(out).toContain('Synthetic replay bitmap')
  expect(out).toContain('Ordinary image witness')
  expect(out).not.toContain('Unexpected edit')
  expect(out).toContain('<image href="' + fixtureUrl)
  expect(out).toContain('src="' + fixtureUrl)
  expect(out).toContain('url(&quot;' + fixtureUrl)
  expect(out).not.toContain('/media/')
  expect(fetch).not.toHaveBeenCalled()
  await expect(plan.run(hooks)).rejects.toThrow(/已使用/)
})

it('disallows upload for a cancelled preflight, invalid replay image, missing ownership or indivisible excess', async () => {
  const { doc, block } = documentOf()
  const hooks = inertHooks()
  hooks.confirmUpload.mockReturnValue(false)
  expect(await prepareHostedReplayXiumi(doc, [png]).run(hooks)).toBe('cancelled-before-upload')
  expect(hooks.upload).not.toHaveBeenCalled()
  expect(hooks.confirmDownload).not.toHaveBeenCalled()
  expect(hooks.download).not.toHaveBeenCalled()
  expect(() => prepareHostedReplayXiumi(doc, [])).toThrow(/素材/)
  block.props.canvas.background.image = { src: 'https://example.invalid/unproven.png' }
  expect(() => prepareHostedReplayXiumi(doc, [png])).toThrow(/素材/)
  block.props.canvas.background.image = { src: media }
  doc.blocks.push({ id: 'oversized', type: 'html', props: { html: '<p>' + 'z'.repeat(XIUMI_LIMIT + 1) + '</p>', label: 'Oversize' } })
  expect(() => prepareHostedReplayXiumi(doc, [png])).toThrow(/长度上限/)
  expect(hooks.upload).not.toHaveBeenCalled()
})

describe('final mapping and emitted references', () => {
  it.each(['missing', 'unapproved', 'local', 'extra', 'bad-identity', 'not-a-url', 'aborted'] as const)('rejects final %s rewrite without download', async mode => {
    const { doc } = documentOf()
    const hooks = inertHooks()
    hooks.upload.mockImplementationOnce(async sources => {
      const source = sources[0]
      if (mode === 'aborted') throw new Error('fixture image transfer aborted')
      if (mode === 'not-a-url') return { [source]: 'https://???' }
      if (mode === 'missing') return {}
      if (mode === 'unapproved') return { [source]: 'https://example.invalid/fake.png' }
      if (mode === 'local') return { [source]: media }
      if (mode === 'extra') return { [source]: fixtureUrl, '/media/unplanned.png': fixtureUrl }
      return { [source]: 'https://username@mmbiz.qpic.cn/fake.png' }
    })
    const result = prepareHostedReplayXiumi(doc, [png]).run(hooks)
    if (mode === 'aborted') await expect(result).rejects.toThrow(/fixture image transfer aborted/)
    else await expect(result).rejects.toThrow(/图片可能已上传，无法撤回；未生成下载/)
    expect(hooks.upload).toHaveBeenCalledOnce()
    expect(hooks.confirmDownload).not.toHaveBeenCalled()
    expect(hooks.download).not.toHaveBeenCalled()
  })

  it.each([
    '<svg><image href="/media/fixture.png" /></svg>',
    "<svg><image xlink:href='/media/fixture.png' /></svg>",
    '<svg><image href="data:image/svg+xml,fixture" /></svg>',
    '<img src="/media/fixture.png">',
    '<section style="background-image:url(&quot;/media/fixture.png&quot;)">a</section>',
  ])('refuses emitted image residues in the final document', html => {
    expect(() => assertHostedReplayLinks(html)).toThrow(/图片/)
  })
})

it('recounts after mapping; declining the explicit actual split confirmation never downloads', async () => {
  const { doc } = documentOf()
  const filler: Block<'html'> = { id: 'near-split', type: 'html', props: { html: '', label: 'Bounded split' } }
  doc.blocks.push(filler)
  const paragraphs = 200
  filler.props.html = '<p></p>'.repeat(paragraphs)
  const count = xiumiLength(xiumiSvgBoxes(compileDoc(doc).html))
  const chars = XIUMI_LIMIT - count - 350
  const perParagraph = Math.max(1, Math.floor(chars / paragraphs))
  filler.props.html = ('<p>' + 'x'.repeat(perParagraph) + '</p>').repeat(paragraphs)
  const hooks = inertHooks(asset(800))
  hooks.confirmDownload.mockReturnValue(false)
  const preview = prepareHostedReplayXiumi(doc, [png])
  expect(preview.parts).toBe(1)
  expect(await preview.run(hooks)).toBe('cancelled-after-upload')
  expect(hooks.confirmDownload).toHaveBeenCalledWith({ plannedParts: 1, actualParts: 2, uploadedImages: 1 })
  expect(hooks.download).not.toHaveBeenCalled()

  hooks.confirmDownload.mockReturnValue(true)
  expect(await prepareHostedReplayXiumi(doc, [png]).run(hooks)).toBe('downloaded')
  const zip = await JSZip.loadAsync(await hooks.download.mock.calls[0][0].blob.arrayBuffer())
  expect(Object.keys(zip.files)).toEqual(['导入秀米-1.txt', '导入秀米-2.txt', '说明.txt'])
  expect(await zip.file('导入秀米-1.txt')!.async('string')).toContain(asset(800))
})

it.each([
  '?w=0&w=1',
  '?w=bad',
  '?fit=wrong',
  '?fit=1:1',
  '?external=1',
  '?gen=' + 'z'.repeat(64),
])('refuses unqualified or unverifiable authored replay query %s before transport', query => {
  const { doc, block } = documentOf()
  block.props.canvas.background.image = { src: media + query, assetId: png.id }
  expect(() => prepareHostedReplayXiumi(doc, [png])).toThrow(/已索引/)
})

it('refuses unsupported catalog versions, duplicate names and mismatched source IDs before any transfer', () => {
  const { doc, block } = documentOf()
  expect(() => prepareHostedReplayXiumi(doc, [png, png])).toThrow(/已索引/)
  expect(() => prepareHostedReplayXiumi(doc, [{ ...png, generation: 'a'.repeat(64) }])).toThrow(/已索引/)
  expect(() => prepareHostedReplayXiumi(doc, [{ ...png, file: 'other.png' }])).toThrow(/已索引/)
  block.props.canvas.background.image!.assetId = 'wrong-id'
  expect(() => prepareHostedReplayXiumi(doc, [png])).toThrow(/已索引/)
  block.props.canvas.background.image = undefined
  block.props.scenes[0].items[1].image = undefined
  expect(() => prepareHostedReplayXiumi(doc, [png])).toThrow(/没有需要上传/)
})

it('carries a selected generation unchanged into the transfer and rendered SVG', async () => {
  const { doc, block } = documentOf()
  const generation = 'a'.repeat(64)
  const qualified = { src: media + '?gen=' + generation, assetId: png.id }
  block.props.canvas.background.image = qualified
  block.props.scenes[0].items[1].image = qualified
  const hooks = inertHooks()
  expect(await prepareHostedReplayXiumi(doc, [png]).run(hooks)).toBe('downloaded')
  const expected = media + '?w=1500&gen=' + generation
  expect(hooks.upload.mock.calls[0][0]).toEqual([expected])
  const withCatalogPin = inertHooks()
  expect(await prepareHostedReplayXiumi(doc, [{ ...png, generation }]).run(withCatalogPin)).toBe('downloaded')
  expect(withCatalogPin.upload.mock.calls[0][0]).toEqual([expected])
  const html = await hooks.download.mock.calls[0][0].blob.text()
  expect(html).toContain('<image href="' + fixtureUrl)
  expect(html).not.toContain('/media/')
  expect(() => prepareHostedReplayXiumi(doc, [{ ...png, generation: 'b'.repeat(64) }])).toThrow(/已索引/)
})

it('does not turn a valid existing hosted bitmap into an upload or accept a root URL', async () => {
  const { doc } = documentOf()
  doc.blocks.push({ id: 'existing', type: 'html', props: { html: '<img src="https://mmbiz.qlogo.cn/demo/existing/0?wx_fmt=png">', label: 'existing' } })
  const hooks = inertHooks()
  expect(await prepareHostedReplayXiumi(doc, [png]).run(hooks)).toBe('downloaded')
  expect(hooks.upload.mock.calls[0][0]).toEqual([media + '?w=1500'])
  expect(await hooks.download.mock.calls[0][0].blob.text()).toContain('https://mmbiz.qlogo.cn/demo/existing/0?wx_fmt=png')
  await expect(prepareHostedReplayXiumi(doc, [png]).run(inertHooks('https://mmbiz.qpic.cn/'))).rejects.toThrow(/图片/)
})

it('stages the immutable request before consent and releases it on decline without transferring', async () => {
  const { doc } = documentOf()
  const hooks = inertHooks()
  const transfer = vi.fn().mockResolvedValue({})
  const cancel = vi.fn().mockResolvedValue(undefined)
  const stage = vi.fn(async (sources: readonly string[]) => ({ images: sources.length, transfer, cancel }))
  const confirmUpload = vi.fn(async () => {
    expect(stage).toHaveBeenCalledOnce()
    expect(transfer).not.toHaveBeenCalled()
    return false
  })
  const status = await prepareHostedReplayXiumi(doc, [png]).run({
    stage, confirmUpload, confirmDownload: hooks.confirmDownload, download: hooks.download,
  })
  expect(status).toBe('cancelled-before-upload')
  expect(cancel).toHaveBeenCalledOnce()
  expect(transfer).not.toHaveBeenCalled()
  expect(hooks.download).not.toHaveBeenCalled()
})

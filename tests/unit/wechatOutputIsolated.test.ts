// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CompileOptions, CompileResult } from '../../src/core/compiler'
import type { Doc } from '../../src/core/types'
import {
  assertReplayOk, collectImageUrls, compileForWechat, copyRichText, download, prepareXiumiUpload,
  standaloneHtml, xiumiPackage, xiumiUploaded,
} from '../../src/editor/wechatOutput'

const h = vi.hoisted(() => ({
  compile: vi.fn(), glyph: vi.fn(), wechat: vi.fn(), checked: vi.fn(), zip: vi.fn(), ascii: vi.fn(), replace: vi.fn(), fetch: vi.fn(),
  replayError: 'replay: ',
}))
vi.mock('../../src/core/compiler', () => ({ compileDoc: h.compile, REPLAY_ERROR: h.replayError, css: () => 'font-size:0' }))
vi.mock('../../src/editor/api', () => ({ api: { replayGlyphs: h.glyph, wechatUploadImages: h.wechat } }))
vi.mock('../../src/core/xiumiExport', () => ({ checkedXiumiParts: h.checked, asciiHtml: h.ascii, makeZip: h.zip, replaceLocalImages: h.replace }))
const input = (): Doc => ({ id: 'article', title: '初稿', author: '作者', digest: '', themeId: 'thu-eea-de', blocks: [], createdAt: 0, updatedAt: 0 })
const compiled = (html = '<p>正文</p>', warnings: string[] = []): CompileResult => ({ html, warnings, charCount: html.length })
const mockSources = (sources: string[], warnings: string[] = []) => h.compile.mockImplementation((_doc: Doc, options?: CompileOptions) =>
  compiled(sources.map(url => options?.mapImage?.(url) ?? url).join('\n'), [...warnings]),
)
const blocked = () => { throw Error('Unexpected external boundary call') }
beforeEach(() => {
  for (const mock of Object.values(h)) if (typeof mock === 'function') mock.mockReset().mockImplementation(blocked)
  vi.stubGlobal('fetch', h.fetch)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(blocked)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.replaceChildren()
})
const readBlob = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = reject
  reader.readAsText(blob)
})

it('collects unique compiler-visited URLs in first-visit order without processing images', () => {
  const doc = input()
  mockSources(['/media/a.jpg', 'https://example.invalid/b.jpg', '/media/a.jpg', '/media/a.jpg?w=80'])
  expect(collectImageUrls(doc)).toEqual(['/media/a.jpg', 'https://example.invalid/b.jpg', '/media/a.jpg?w=80'])
  expect(h.compile).toHaveBeenCalledExactlyOnceWith(doc, { mapImage: expect.any(Function) })
  expect(h.fetch).not.toHaveBeenCalled()
  expect(h.wechat).not.toHaveBeenCalled()
})

it('embeds only managed files, preserving remote and existing embedded sources and non-length warnings', async () => {
  const png = 'data:image/png;base64,cG5n'
  const remote = 'https://example.invalid/photo'
  mockSources(['/media/a.jpg', png, remote, '/media/a.jpg'], ['超过 20,000 字符', '保留此警告'])
  h.fetch.mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(['a'], { type: 'image/jpeg' })) })
  const progress = vi.fn()
  const result = await compileForWechat(input(), 'embed', progress)
  expect(result.html.split('\n')).toEqual(['data:image/jpeg;base64,YQ==', png, remote, 'data:image/jpeg;base64,YQ=='])
  expect(result.warnings).toEqual(['保留此警告'])
  expect(h.fetch).toHaveBeenCalledExactlyOnceWith('/media/a.jpg')
  expect(h.glyph).not.toHaveBeenCalled()
  expect(h.wechat).not.toHaveBeenCalled()
  expect(progress).toHaveBeenCalledExactlyOnceWith('内嵌图片 1/1')
})

it('stops embedding before final compile when the first local image cannot be read', async () => {
  mockSources(['/media/missing.jpg','/media/later.jpg'])
  h.fetch.mockResolvedValueOnce({ ok: false, blob: blocked })
  await expect(compileForWechat(input(), 'embed')).rejects.toThrow('图片加载失败 /media/missing.jpg')
  expect(h.fetch).toHaveBeenCalledExactlyOnceWith('/media/missing.jpg')
  expect(h.compile).toHaveBeenCalledOnce()
})

it('batches glyphs at 40, uploads only managed paths, and preserves external links', async () => {
  const glyphs = Array.from({ length: 41 }, (_, i) => 'data:image/png;base64,' + i)
  const local = '/media/a.jpg?w=720'
  const remote = 'https://example.invalid/a.jpg'
  mockSources([...glyphs, local, local, remote])
  const events: string[] = []
  h.glyph.mockImplementation(async (batch: string[]) => {
    events.push('save ' + batch.length)
    return Object.fromEntries(batch.map(key => [key, '/media/g' + key.split(',')[1] + '.png']))
  })
  h.wechat.mockImplementation(async (urls: string[]) => {
    events.push('upload ' + urls.length)
    return Object.fromEntries(urls.map(url => [url, 'https://wx.invalid' + url]))
  })
  const result = await compileForWechat(input(), 'wechat', message => events.push(message))
  expect(events).toEqual(['保存文字图片 40/41','save 40','保存文字图片 41/41','save 1','上传 42 张图片到微信…','upload 42'])
  expect(h.glyph.mock.calls.map(call => call[0])).toEqual([glyphs.slice(0,40), glyphs.slice(40)])
  expect(h.wechat).toHaveBeenCalledExactlyOnceWith([local, ...glyphs.map((_,i) => '/media/g' + i + '.png')])
  const lines = result.html.split('\n')
  expect(lines[0]).toBe('https://wx.invalid/media/g0.png')
  expect(lines.slice(-4)).toEqual(['https://wx.invalid/media/g40.png','https://wx.invalid' + local,'https://wx.invalid' + local,remote])
  expect(h.fetch).not.toHaveBeenCalled()
})

it('maps managed paths to the current origin without touching remote URLs or hitting upload', async () => {
  const glyph = 'data:image/png;base64,a'
  const svg = 'data:image/svg+xml,other'
  mockSources(['/media/a.jpg', glyph, svg, 'https://example.invalid/r.jpg'])
  h.glyph.mockResolvedValueOnce({ [glyph]: '/media/g.png' })
  const result = await compileForWechat(input(), 'absolute')
  expect(result.html.split('\n')).toEqual([location.origin + '/media/a.jpg', location.origin + '/media/g.png', svg, 'https://example.invalid/r.jpg'])
  expect(h.wechat).not.toHaveBeenCalled()
  expect(h.fetch).not.toHaveBeenCalled()
})

it('treats only Replay-tagged diagnostics as a hard stop and does not include additional messages', () => {
  const normal = compiled('<p>ok</p>', ['一般提示'])
  expect(assertReplayOk(normal)).toBe(normal)
  expect(() => assertReplayOk(compiled('', ['一般提示', h.replayError + '   缺字形', h.replayError + '  第二条'])))
    .toThrow(/^编辑回放未通过检查，已停止导出：缺字形$/)
})

it('writes escaped standalone metadata while retaining markup and setting no-referrer policy', () => {
  const html = standaloneHtml({ ...input(), title: '<标题>&', author: '<作者>&' }, '<p class="article">正文</p>')
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  expect(parsed.title).toBe('<标题>&')
  expect(parsed.querySelector('h1')?.textContent).toBe('<标题>&')
  expect(parsed.querySelector('.meta')?.textContent).toBe('<作者>&')
  expect(parsed.querySelector('.article')?.textContent).toBe('正文')
  expect(parsed.querySelector('meta[name=referrer]')?.getAttribute('content')).toBe('no-referrer')
})

it('uses promised clipboard data synchronously and writes both text/html and extracted plain text', async () => {
  let resolve!: (value: string) => void
  const content = new Promise<string>(r => { resolve = r })
  const blobs: Record<string, Promise<Blob>>[] = []
  vi.stubGlobal('ClipboardItem', class { constructor(parts: Record<string, Promise<Blob>>) { blobs.push(parts) } })
  const write = vi.fn(async () => { await Promise.all(Object.values(blobs[0])) })
  vi.stubGlobal('navigator', { clipboard: { write } })
  const result = copyRichText(content)
  expect(write).toHaveBeenCalledOnce()
  expect(Object.keys(blobs[0])).toEqual(['text/html','text/plain'])
  resolve('<p>甲 &amp; <strong>乙</strong></p>')
  await expect(result).resolves.toBe('clipboard-api')
  expect(await readBlob(await blobs[0]['text/html'])).toBe('<p style="font-size:0">&nbsp;</p><p>甲 &amp; <strong>乙</strong></p><p style="font-size:0">&nbsp;</p>')
  expect((await readBlob(await blobs[0]['text/plain'])).trim()).toBe('甲 & 乙')
})

it.each([true, false])('cleans the temporary selection and DOM when the fallback copy result is %s', async ok => {
  vi.stubGlobal('ClipboardItem', undefined)
  const exec = vi.fn((command: string) => {
    expect(command).toBe('copy')
    expect(window.getSelection()?.toString().trim()).toBe('只在复制时插入')
    expect(document.querySelector('div[style]')?.textContent).toContain('只在复制时插入')
    return ok
  })
  vi.stubGlobal('document', Object.assign(document, { execCommand: exec }))
  try {
    const result = copyRichText(Promise.resolve('<b>只在复制时插入</b>'))
    if (ok) await expect(result).resolves.toBe('exec-command')
    else await expect(result).rejects.toThrow('浏览器拒绝写入剪贴板')
    expect(exec).toHaveBeenCalledOnce()
    expect(document.body.childNodes).toHaveLength(0)
    expect(window.getSelection()?.rangeCount).toBe(0)
  } finally { Reflect.deleteProperty(document, 'execCommand') }
})

it('passes a typed UTF-8 blob to one download and revokes the exact URL after click', async () => {
  vi.useFakeTimers()
  const created = vi.fn(() => 'blob:https://example.invalid/local-test')
  const revoked = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: created, revokeObjectURL: revoked })
  const clicked = vi.mocked(HTMLAnchorElement.prototype.click)
  clicked.mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('测试.html')
    expect(this.href).toBe('blob:https://example.invalid/local-test')
    expect(revoked).not.toHaveBeenCalled()
  })
  download('测试.html', '<p>本地</p>', 'text/html')
  expect(clicked).toHaveBeenCalledOnce()
  expect(created).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'text/html;charset=utf-8' }))
  await vi.advanceTimersByTimeAsync(1999)
  expect(revoked).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(revoked).toHaveBeenCalledExactlyOnceWith('blob:https://example.invalid/local-test')
})

const stubParts = (...parts: string[]) => {
  h.checked.mockReturnValue(parts)
  h.ascii.mockImplementation(val => 'encoded:' + val)
}

it('forces SVG text for a manual package and blocks local pictures embedded inside replay SVG before fetching', async () => {
  const doc = input()
  h.compile.mockReturnValueOnce(compiled('<svg><image href="/media/hidden.jpg"></image></svg>'))
  await expect(xiumiPackage(doc)).rejects.toThrow('编辑回放里有本地图片')
  expect(h.compile).toHaveBeenCalledExactlyOnceWith(doc, { replaySvgText: true })
  expect(h.checked).not.toHaveBeenCalled()
  expect(h.replace).not.toHaveBeenCalled()
  expect(h.fetch).not.toHaveBeenCalled()
})

it('creates one ASCII text download receipt when there are no attachments or additional parts', async () => {
  h.compile.mockReturnValueOnce(compiled('orig'))
  h.replace.mockReturnValueOnce({ html: 'rewritten', urls: [] })
  stubParts('分段正文')
  const receipt = await xiumiPackage(input())
  expect(h.checked).toHaveBeenCalledExactlyOnceWith('rewritten')
  expect(h.ascii).toHaveBeenCalledExactlyOnceWith('分段正文')
  expect(receipt).toMatchObject({ name: '导入秀米.txt', images: 0, parts: 1, blob: { type: 'text/plain;charset=utf-8' } })
  expect(await readBlob(receipt.blob)).toBe('encoded:分段正文')
  expect(h.zip).not.toHaveBeenCalled()
})

it('writes multipart text and notes before numbered image data and requests placeholder geometry', async () => {
  h.compile.mockReturnValueOnce(compiled('orig'))
  h.replace.mockImplementationOnce((_html: string, placeholder: (url: string, i: number) => string) => {
    expect(placeholder('/media/first.png?fit=4%3A3', 0)).toBe('data:image/jpeg;base64,stub')
    return { html: 'rewritten', urls: ['/media/first.png?fit=4%3A3','/media/second.jpeg'] }
  })
  stubParts('a','b')
  const draw = { fillRect: vi.fn(), fillText: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(draw as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,stub')
  h.fetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => Uint8Array.of(9).buffer })
    .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => Uint8Array.of(7).buffer })
  h.zip.mockReturnValueOnce(Uint8Array.of(1,2).buffer)
  const progress = vi.fn()
  const result = await xiumiPackage(input(), progress)
  expect(draw.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 480, 360)
  expect(draw.fillText).toHaveBeenCalledExactlyOnceWith('图 01', 240, 180)
  expect(result).toMatchObject({ name: '导入秀米.zip', parts: 2, images: 2, blob: { type: 'application/zip', size: 2 } })
  const files = h.zip.mock.calls[0][0] as { name: string; data: Uint8Array }[]
  expect(files.map(f => f.name)).toEqual(['导入秀米-1.txt','导入秀米-2.txt','说明.txt','图片/01.png','图片/02.jpg'])
  expect([...files[3].data]).toEqual([9])
  expect([...files[4].data]).toEqual([7])
  const notes = new TextDecoder().decode(files[2].data)
  expect(notes).toContain('按 1 到 2 的顺序')
  expect(notes).toContain('01 到 02')
  expect(progress.mock.calls.flat()).toEqual(['打包图片 1/2','打包图片 2/2'])
})

it('rejects a missing manual asset without creating a download or attempting subsequent asset fetches', async () => {
  h.compile.mockReturnValueOnce(compiled())
  h.replace.mockReturnValueOnce({ html: 'checked', urls: ['/media/old.jpg','/media/next.jpg'] })
  stubParts('a')
  h.fetch.mockResolvedValueOnce({ ok: false, arrayBuffer: blocked })
  await expect(xiumiPackage(input())).rejects.toThrow('第 1 张图片读取失败')
  expect(h.fetch).toHaveBeenCalledExactlyOnceWith('/media/old.jpg')
  expect(h.zip).not.toHaveBeenCalled()
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
})

it('checks the cloned snapshot before upload, then checks separately rewritten output and returns its actual receipt', async () => {
  const doc = input()
  h.compile.mockImplementation((snapshot: Doc, options: CompileOptions) => {
    const mapped = options.mapImage?.('/media/file.jpg')
    return compiled('<img src="' + mapped + '"><p>' + snapshot.title + '</p>')
  })
  h.checked.mockReturnValueOnce(['pre1','pre2']).mockReturnValueOnce(['final'])
  h.ascii.mockImplementation(val => 'ascii ' + val)
  h.wechat.mockResolvedValueOnce({ '/media/file.jpg': 'https://wx.invalid/file.jpg' })
  const prepared = prepareXiumiUpload(doc)
  expect(prepared.parts).toBe(2)
  expect(h.wechat).not.toHaveBeenCalled()
  doc.title = '新文档'
  const result = await prepared.upload()
  expect(h.compile.mock.calls.map(args => args[0].title)).toEqual(['初稿','初稿'])
  expect(h.compile.mock.calls[0][0]).not.toBe(doc)
  expect(h.compile.mock.calls[0][1].replayPendingImageUpload).toBe(true)
  expect(h.compile.mock.calls[1][1]).not.toHaveProperty('replayPendingImageUpload')
  expect(h.wechat).toHaveBeenCalledExactlyOnceWith(['/media/file.jpg'])
  expect(h.checked.mock.calls.flat()).toEqual(['<img src="/media/file.jpg"><p>初稿</p>','<img src="https://wx.invalid/file.jpg"><p>初稿</p>'])
  expect(result).toMatchObject({ name: '导入秀米.txt', parts: 1, images: 0 })
  expect(await readBlob(result.blob)).toBe('ascii final')
})

it.each(['<img src="/media/local.jpg">', '<svg><image href="/media/local.jpg"></image></svg>', '<p style="background:url(&quot;/media/local.jpg&quot;)"></p>'])('never offers a package for a final local source: %s', async final => {
  h.compile.mockReturnValueOnce(compiled()).mockReturnValueOnce(compiled(final))
  h.checked.mockReturnValueOnce(['source'])
  h.wechat.mockResolvedValueOnce({})
  await expect(xiumiUploaded(input())).rejects.toThrow('有图片没有上传成功，请重试')
  expect(h.checked).toHaveBeenCalledOnce()
  expect(h.zip).not.toHaveBeenCalled()
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
})

it('hands a failed rich clipboard write to one fallback copy and returns the actual method', async () => {
  let parts: Record<string, Promise<Blob>>
  vi.stubGlobal('ClipboardItem', class { constructor(value: Record<string, Promise<Blob>>) { parts = value } })
  const order: string[] = []
  const write = vi.fn(async () => { await Promise.all(Object.values(parts)); order.push('failed'); throw Error('clipboard denied') })
  vi.stubGlobal('navigator', { clipboard: { write } })
  const exec = vi.fn(() => { expect(window.getSelection()?.toString().trim()).toBe('备用'); order.push('fallback'); return true })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
  try {
    await expect(copyRichText(Promise.resolve('<h2>备用</h2>'))).resolves.toBe('exec-command')
    expect(order).toEqual(['failed','fallback'])
    expect(exec).toHaveBeenCalledExactlyOnceWith('copy')
    expect(document.body.childNodes).toHaveLength(0)
  } finally { Reflect.deleteProperty(document, 'execCommand') }
})

it('downloads an existing Blob without re-encoding or overriding its MIME type', () => {
  vi.useFakeTimers()
  const blob = new Blob(['fixture'], { type: 'application/zip' })
  const create = vi.fn((_blob: Blob) => 'blob:https://example.invalid/archive')
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => undefined)
  download('fixture.zip', blob)
  expect(create.mock.calls[0][0]).toBe(blob)
  vi.runAllTimers()
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:https://example.invalid/archive')
})

it('requires preflight parts and final replay validation before any file assembly', async () => {
  h.compile.mockReturnValueOnce(compiled('source'))
  h.checked.mockImplementationOnce(() => { throw Error('source exceeds limit') })
  expect(() => prepareXiumiUpload(input())).toThrow('source exceeds limit')
  expect(h.wechat).not.toHaveBeenCalled()
  h.compile.mockReturnValueOnce(compiled('new source')).mockReturnValueOnce(compiled('new output', [h.replayError + '终稿问题']))
  h.checked.mockReturnValueOnce(['checked'])
  h.wechat.mockResolvedValueOnce({})
  await expect(xiumiUploaded(input())).rejects.toThrow('已停止导出：终稿问题')
  expect(h.ascii).not.toHaveBeenCalled()
  expect(h.zip).not.toHaveBeenCalled()
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
})

it('reports failed article generation only through the awaited fallback operation', async () => {
  vi.stubGlobal('ClipboardItem', undefined)
  vi.stubGlobal('navigator', {})
  const failure = Error('synthetic compiler failure')
  await expect(copyRichText(Promise.reject(failure))).rejects.toBe(failure)
  expect(document.body.childNodes).toHaveLength(0)
  // Let the event loop flush any unhandled derivative promise rejection.
  await new Promise<void>(resolve => setTimeout(resolve, 0))
})

it('cleans temporary selection and article markup even if the browser copy operation throws', async () => {
  vi.stubGlobal('ClipboardItem', undefined)
  vi.stubGlobal('navigator', {})
  const failure = Error('fixture clipboard throws')
  const exec = vi.fn(() => { throw failure })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
  try {
    await expect(copyRichText(Promise.resolve('<p>只用于复制</p>'))).rejects.toBe(failure)
    expect(exec).toHaveBeenCalledExactlyOnceWith('copy')
    expect(window.getSelection()?.rangeCount).toBe(0)
    expect(document.body.childNodes).toHaveLength(0)
  } finally { Reflect.deleteProperty(document, 'execCommand') }
})

it('does not leak unconsumed clipboard data rejections when the browser refuses before reading items', async () => {
  const write = vi.fn().mockRejectedValue(Error('permission denied'))
  vi.stubGlobal('navigator', { clipboard: { write } })
  const item = vi.fn()
  vi.stubGlobal('ClipboardItem', class { constructor(parts: Record<string, Promise<Blob>>) { item(parts) } })
  const compiled = Error('article source failed')
  await expect(copyRichText(Promise.reject(compiled))).rejects.toBe(compiled)
  expect(item).toHaveBeenCalledExactlyOnceWith({ 'text/html': expect.any(Promise), 'text/plain': expect.any(Promise) })
  expect(write).toHaveBeenCalledOnce()
  expect(document.body.childNodes).toHaveLength(0)
  await new Promise<void>(resolve => setTimeout(resolve, 0))
})

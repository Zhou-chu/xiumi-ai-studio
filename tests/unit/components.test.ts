import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import zlib from 'node:zlib'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { hueFamily, makeDraft } from '../../src/core/components'
import { displayHtml, displayUrl, rehostUrls, rewriteImages, storedHtml } from '../../src/core/images'
import { collectColors, docMainColors, fixedDecorCount, harmonize, recolorHtml } from '../../src/core/recolor'
import { sanitizeHtml } from '../../src/core/sanitize'
import { backgroundPhotos, extractSlots, removeBackgroundPhotos, setBackgroundPhoto, skeleton } from '../../src/core/slots'
import { asciiHtml, makeZip, replaceLocalImages, splitForXiumi, xiumiLength, xiumiReport, xiumiSvgBoxes } from '../../src/core/xiumiExport'
import { THEMES } from '../../src/core/themes'
import { toHsl } from '../../src/core/color'
import type { Doc } from '../../src/core/types'
import { detectSource } from '../../src/core/wxImport'

const parse = (s: string) => new JSDOM(s).window.document
const rootOf = (html: string) => parse(`<!doctype html><body><section id="r">${html}</section></body>`).getElementById('r')!
const source = { kind: 'xiumi' as const, title: '测试', url: '', account: '' }

/** 仿真实秀米版块：图片卡、胶囊标题（×2）、正文、轮播，都包在一层白底容器里 */
const JPG = (n: number) => `https://mmbiz.qpic.cn/sz_mmbiz_jpg/p${n}/640?wx_fmt=jpeg`
const card = (t: string) => `<section style="margin: 10px 0"><section style="display: inline-block; width: 100%; padding: 5px; border: 1px solid #528065"><img src="${JPG(1)}" style="width: 100%"><p style="font-size: 13px">${t}</p></section></section>`
const slide = (n: number) => `<g><foreignObject width="100%" height="100%"><svg viewBox="0 0 1080 720" style="background-image: url(&quot;${JPG(n)}&quot;); background-size: 100%"></svg></foreignObject></g>`
const carousel = `<section style="display: flex; flex-flow: row nowrap; margin: 10px 0"><section style="display: inline-block; width: 100%; background-color: #ecf6e4"><svg viewBox="0 0 1080 720" style="display: block">${slide(1)}${slide(2)}${slide(1)}<animate attributeName="opacity" values="0;1"></animate></svg></section></section>`
/** 秀米拼图标题：网格里的碎片 + 标题 */
const GRID = `<section style="display: grid; width: 100%"><section style="width: 40%"><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/a/0?wx_fmt=png" style="width: 100%"></section><section style="width: 30%"><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/b/0?wx_fmt=png" style="width: 100%"></section><section style="display: flex"><svg viewBox="0 0 90 20"><foreignObject width="100%" height="100%"><p style="font-size: 18px">章节标题</p></foreignObject></svg></section></section>`

describe('background photos', () => {
  it('lists distinct photos with counts, ignoring textures and backgrounds with text', () => {
    const html = `${carousel}<section style="background-image: url(https://mmbiz.qpic.cn/paper/0?wx_fmt=png)"><p>纹理</p></section><section style="background-image: url(${JPG(9)})"><p>文字压在照片上</p></section>`
    expect(backgroundPhotos(html, parse).map((b) => [b.src, b.count])).toEqual([[JPG(1), 2], [JPG(2), 1]])
  })
  it('replaces every use of one photo, cropped to the viewBox, and survives sanitizing', () => {
    const out = setBackgroundPhoto(carousel, JPG(1), { src: '/media/new.jpg' }, { parse })
    expect(backgroundPhotos(out, parse).map((b) => b.src)).toEqual(['/media/new.jpg?fit=100%3A67&w=1080', JPG(2)])
    expect(out).not.toContain('p1/')
    expect(sanitizeHtml(out, parse)).toContain('/media/new.jpg?fit=100%3A67')
    expect(extractSlots(out, parse)).toEqual(extractSlots(carousel, parse))
  })
  it('rejects unsafe sources', () => {
    expect(setBackgroundPhoto(carousel, JPG(1), { src: 'javascript:alert(1)' }, { parse })).toBe(carousel)
  })
  it('exports replaced backgrounds through the image mapping', () => {
    const html = setBackgroundPhoto(carousel, JPG(1), { src: '/media/new.jpg' }, { parse })
    const doc: Doc = { id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks: [createBlock('html', { html })], createdAt: 0, updatedAt: 0 }
    const urls: string[] = []
    const r = compileDoc(doc, { mapImage: (u) => (urls.push(u), 'https://mmbiz.qpic.cn/uploaded') })
    expect(urls.filter((u) => u.startsWith('/media/'))).toHaveLength(2)
    expect(r.html).not.toContain('/media/')
    expect(r.html.split('https://mmbiz.qpic.cn/uploaded').length - 1).toBe(2)
    expect(compileDoc(doc).warnings.join()).toContain('本地图片')
  })
  it('treats photos that differ only by background as the same structure', () => {
    expect(skeleton(carousel, parse)).toBe(skeleton(setBackgroundPhoto(carousel, JPG(2), { src: '/media/x.jpg' }, { parse }), parse))
    expect(removeBackgroundPhotos(carousel, parse).html).not.toContain('<svg')
  })
})

describe('sanitize image sources', () => {
  it('keeps local and Xiumi backgrounds, drops others, and does not break data URIs', () => {
    const html = sanitizeHtml(
      '<section style="background-image: url(/media/a.jpg?fit=100%3A50&amp;w=1080)">甲</section><section style="background-image: url(//img.xiumi.us/x.jpg)">乙</section><section style="background-image: url(https://evil.com/x.jpg)">丙</section><section style="background-image: url(&quot;data:image/png;base64,AAAA&quot;); color: #123456">丁</section>',
      parse,
    )
    expect(html).toContain('/media/a.jpg?fit=100%3A50')
    expect(html).toContain('https://img.xiumi.us/x.jpg')
    expect(html).not.toContain('evil.com')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('color: #123456')
  })
  it('keeps protocol-relative images', () => {
    expect(sanitizeHtml('<img src="//img.xiumi.us/x.png">', parse)).toContain('src="https://img.xiumi.us/x.png"')
  })
})

describe('rehosting', () => {
  const html = '<img src="https://img.xiumi.us/a.png"><img src="https://mmbiz.qpic.cn/b/0"><section style="background-image: url(&quot;https://statics.xiumi.us/c.jpg&quot;); color: red">甲</section>'
  it('only collects Xiumi hosted images', () => {
    expect(rehostUrls(html, parse)).toEqual(['https://img.xiumi.us/a.png', 'https://statics.xiumi.us/c.jpg'])
  })
  it('rewrites what was saved and leaves the rest', () => {
    const out = rewriteImages(html, { 'https://statics.xiumi.us/c.jpg': '/media/c.jpg' }, parse)
    expect(out).toContain('url(&quot;/media/c.jpg&quot;)')
    expect(out).toContain('https://img.xiumi.us/a.png')
    expect(out).toContain('https://mmbiz.qpic.cn/b/0')
  })
  it('warns about Xiumi images that were not rehosted', () => {
    const doc = (h: string): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks: [createBlock('html', { html: h })], createdAt: 0, updatedAt: 0 })
    expect(compileDoc(doc('<img src="https://img.xiumi.us/a.png">')).warnings.join()).toContain('秀米图片')
    expect(compileDoc(doc('<section style="background-image: url(&quot;https://img.xiumi.us/a.png&quot;)"></section>')).warnings.join()).toContain('秀米图片')
    expect(compileDoc(doc('<img src="https://mmbiz.qpic.cn/a/0">')).warnings.join()).not.toContain('秀米图片')
  })
  it('detects the source of pasted content', () => {
    expect(detectSource(parse('<section powered-by="xiumi.us"><p>甲</p></section>'))).toBe('xiumi')
    expect(detectSource(parse('<img src="https://img.xiumi.us/a.png">'))).toBe('xiumi')
    expect(detectSource(parse('<section powered-by="xiumi.us"><img src="https://mmbiz.qpic.cn/a/0"></section>'))).toBe('wechat')
    expect(detectSource(parse('<p>甲</p>'), 'https://mp.weixin.qq.com/s/abc')).toBe('wechat')
    expect(detectSource(parse('<p>甲</p>'))).toBe('other')
  })
})

describe('displaying WeChat backgrounds', () => {
  const stored = '<section style="background-image: url(&quot;https://mmbiz.qpic.cn/sz_mmbiz_jpg/a/640?wx_fmt=jpeg&amp;x=1&quot;)"><img src="https://mmbiz.qpic.cn/b/0"></section><svg style="background-image: url(/media/a.jpg)"></svg>'
  it('routes only WeChat backgrounds through the local server', () => {
    const shown = displayHtml(stored)
    expect(shown).toContain('url(&quot;/api/wx-image?u=https%3A%2F%2Fmmbiz.qpic.cn')
    expect(shown).toContain('<img src="https://mmbiz.qpic.cn/b/0">')
    expect(shown).toContain('url(/media/a.jpg)')
    expect(displayUrl('https://img.xiumi.us/a.jpg')).toBe('https://img.xiumi.us/a.jpg')
  })
  it('round-trips back to the original address', () => {
    expect(storedHtml(displayHtml(stored))).toBe(stored)
  })
  it('keeps the original address through DOM serialisation and sanitizing', () => {
    const el = parse(`<!doctype html><body>${displayHtml(stored)}`).body
    const back = sanitizeHtml(storedHtml(el.innerHTML), parse)
    expect(back).toContain('https://mmbiz.qpic.cn/sz_mmbiz_jpg/a/640?wx_fmt=jpeg')
    expect(back).not.toContain('wx-image')
  })
})

describe('export for Xiumi', () => {
  const html = '<img src="/media/a.jpg?fit=100%3A50&amp;w=1080"><section style="background-image: url(&quot;/media/b.png?w=1080&quot;)"></section><img src="https://mmbiz.qpic.cn/x/0?wx_fmt=png"><svg style="background-image: url(&quot;/media/a.jpg?fit=100%3A50&amp;w=1080&quot;)"></svg><img src="data:image/gif;base64,AAAA"><section style="background-image: url(&quot;https://mmbiz.qpic.cn/y/0&quot;)"></section>'
  it('numbers local images in article order and reuses the number for repeats', () => {
    const seen: string[] = []
    const r = replaceLocalImages(html, (u, i) => (seen.push(u), `data:image/jpeg;base64,P${i}`))
    expect(seen).toEqual(['/media/a.jpg?fit=100%3A50&w=1080', '/media/b.png?w=1080'])
    expect(r.urls).toEqual(seen)
    expect(r.html).not.toContain('/media/')
    expect(r.html.split('base64,P0').length - 1).toBe(2)
    expect(r.html).toContain('https://mmbiz.qpic.cn/x/0?wx_fmt=png')
    expect(r.html).toContain('url(&quot;data:image/jpeg;base64,P1&quot;)')
  })
  it('reports what Xiumi cannot take', () => {
    expect(xiumiReport(html)).toEqual({ localImages: 2, localBackgrounds: 2, dataImages: 1, backgrounds: 3 })
    expect(xiumiReport('<img src="https://mmbiz.qpic.cn/x/0">')).toEqual({ localImages: 0, localBackgrounds: 0, dataImages: 0, backgrounds: 0 })
  })
  it('builds a valid stored zip with utf-8 names', async () => {
    const data = new TextEncoder().encode('内容')
    const zip = makeZip([{ name: '图片/01.jpg', data }, { name: 'a.txt', data: new Uint8Array() }])
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(6, true)).toBe(0x0800)
    expect(view.getUint32(14, true)).toBe(zlib.crc32(data))
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50)
    expect(view.getUint16(zip.length - 12, true)).toBe(2)
    const nameLen = view.getUint16(26, true)
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLen))).toBe('图片/01.jpg')
    expect(new TextDecoder().decode(zip.slice(30 + nameLen, 30 + nameLen + data.length))).toBe('内容')
  })
  it('writes the import file as pure ASCII, so reading it as GBK cannot garble the Chinese', () => {
    const src =
      `<section style="font-family: 'PingFang SC', 微软雅黑"><p>清华电机 · 赴德国实践 × 2026 🇩🇪&nbsp;50 Hz · 3φ · 120°</p>` +
      `<img src="https://example.com/图片.jpg" alt="双图 · 建议 4:3"><svg viewBox="0 0 10 10"><text x="0" y="5">TSINGHUA · EST. 1911</text></svg></section>` +
      compileDoc({ id: 'd', title: '实践', author: '', digest: '', themeId: 'thu-eea-de', createdAt: 0, updatedAt: 0, blocks: [createBlock('box'), createBlock('photos')] }).html
    const out = asciiHtml(src)
    expect(out).not.toMatch(/[\u0080-\u{10FFFF}]/u)
    // 解析后与原文完全一致：正文、属性、SVG 文字、emoji（两个码位）都还原
    expect(rootOf(out).innerHTML).toBe(rootOf(src).innerHTML)
    expect(out).toContain('&#x1F1E9;&#x1F1EA;')
    // 原问题：不带 BOM 的 UTF-8 按 GBK 读，· 变成“路”；ASCII 文件按 GBK 读不变
    const asGbk = (s: string) => new TextDecoder('gbk').decode(new TextEncoder().encode(s))
    expect(asGbk(src)).toContain('路')
    expect(asGbk(out)).toBe(out)
  })
  it('splits an article longer than the xiumi import limit at module boundaries, keeping the outer container', () => {
    const para = (i: number, n: number) => `<section style="margin-bottom: 16px"><p title="a>b">段落${i} ${'字'.repeat(n)}</p><img src="x.jpg" alt=""><br><svg viewBox="0 0 2 2"><rect width="1" height="1"/></svg></section>`
    const root = (kids: string) => `<section style="font-size: 16px; color: #333">${kids}</section>`
    const kids = Array.from({ length: 10 }, (_, i) => para(i, 2000)).join('')
    const html = root(kids)
    expect(splitForXiumi(html, 1_000_000)).toEqual([html])
    const parts = splitForXiumi(html, 7000)
    expect(parts.length).toBeGreaterThan(2)
    for (const p of parts) {
      expect(xiumiLength(p)).toBeLessThanOrEqual(7000)
      expect(p.startsWith('<section style="font-size: 16px; color: #333"><section style="margin-bottom: 16px">')).toBe(true)
      expect(rootOf(p).children.length).toBe(1) // 每段是一个完整闭合的元素
    }
    // 拼回去与原文一致：一个模块都不少、不重复
    expect(parts.map((p) => p.slice(root('').length - '</section>'.length, -'</section>'.length)).join('')).toBe(kids)

    // 单个模块太长：往里一层切，外层两级容器都保留
    const big = root(`<section style="border: 1px solid #000">${Array.from({ length: 6 }, (_, i) => `<p>${i}${'长'.repeat(3000)}</p>`).join('')}</section>`)
    const pieces = splitForXiumi(big, 7000)
    expect(pieces.length).toBe(3)
    for (const p of pieces) expect(p).toMatch(/^<section style="font-size: 16px; color: #333"><section style="border: 1px solid #000"><p>\d长/)
    expect(pieces.map((p) => rootOf(p).textContent).join('')).toBe(rootOf(big).textContent)

    // 实体按还原后的一个字符算（导出文件里中文写成实体，秀米按还原后计数）
    expect(xiumiLength('&#x6587;&#x5B57;&amp;')).toBe(3)
  })
  it('puts every svg in a zero line-height box so xiumi cannot push it down and clip it', () => {
    const icon = '<svg viewBox="0 0 14 14" width="14" height="14" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0;width:14px;height:14px;overflow:hidden;margin:2px 6px 0 0"><rect x="1" y="4" width="11" height="8"></rect></svg>'
    const inline = '<svg viewBox="0 0 9 9" width="9" height="9" style="display:inline-block;vertical-align:middle;width:9px"><circle cx="4" cy="4" r="3"></circle></svg>'
    const src = `<section style="display:flex;align-items:flex-start">${icon}<span>图｜变电设备</span></section><p>前${inline}后</p><svg viewBox="0 0 1 1"></svg>`
    const out = xiumiSvgBoxes(src)
    const root = rootOf(out)
    const [a, b] = [...root.querySelectorAll('svg')].map((s) => s as SVGElement)
    // 外层盒子：行高 0，带走外边距和 flex；SVG 本身是块级、只保留尺寸
    const boxA = a.parentElement as HTMLElement
    expect(boxA.tagName).toBe('SECTION')
    expect(boxA.style.lineHeight).toBe('0')
    expect(boxA.style.fontSize).toBe('0px')
    expect(boxA.style.margin).toBe('2px 6px 0px 0px')
    expect(boxA.style.flexShrink).toBe('0')
    expect(boxA.style.width).toBe('14px')
    expect(a.style.display).toBe('block')
    expect(a.style.margin).toBe('')
    expect(a.style.width).toBe('14px')
    expect(a.style.overflow).toBe('hidden')
    expect(boxA.parentElement!.style.display).toBe('flex')
    // 行内的 SVG 用行内块包，不打断段落
    const boxB = b.parentElement as HTMLElement
    expect(boxB.tagName).toBe('SPAN')
    expect(boxB.parentElement!.tagName).toBe('P')
    expect(boxB.style.display).toBe('inline-block')
    expect(boxB.style.verticalAlign).toBe('middle')
    expect(boxB.style.lineHeight).toBe('0')
    // 内容不变、没写样式的 SVG 不动
    expect(a.innerHTML).toBe('<rect x="1" y="4" width="11" height="8"></rect>')
    expect(root.textContent).toBe(rootOf(src).textContent)
    expect(out).toContain('<svg viewBox="0 0 1 1"></svg>')
  })
})

describe('recolor', () => {
  const GREEN = '<section style="background-color: #eef6ea; border: 1px solid rgb(82, 128, 101); color: #333333"><p style="color: rgba(82, 128, 101, 0.5)">甲</p><svg><rect fill="#9cc393" stroke="#ffffff"></rect><animate attributeName="fill" values="#9cc393;#528065"></animate></svg><section style="background-image: url(https://mmbiz.qpic.cn/a#abcdef)"></section></section>'
  it('collects chromatic colours and ignores urls', () => {
    const colors = collectColors(GREEN, parse)
    expect(colors.find((c) => c.hex === '#333333')?.chroma).toBe(false)
    expect(colors.find((c) => c.hex === '#ffffff')?.chroma).toBe(false)
    expect(colors.find((c) => c.hex === '#9cc393')?.chroma).toBe(true)
    expect(colors.some((c) => c.hex === '#abcdef')).toBe(false)
  })
  it('recolours styles, svg attributes and animations while keeping alpha and urls', () => {
    const out = recolorHtml(GREEN, { '#9cc393': '#aa00aa', '#528065': '#112233' }, parse)
    expect(out).toContain('fill="#aa00aa"')
    expect(out).toContain('values="#aa00aa;#112233"')
    expect(out).toContain('rgba(17, 34, 51, 0.5)')
    expect(out).toContain('border: 1px solid #112233')
    expect(out).toContain('#abcdef')
    expect(out).toContain('#333333')
  })
  it('moves hue to the target while keeping lightness', () => {
    const map = harmonize(collectColors(GREEN, parse), { primary: '#7f5bc8', accent: '#c8a44d' })
    const target = toHsl('#7f5bc8').h
    for (const [from, to] of Object.entries(map)) {
      expect(Math.abs(toHsl(to).h - target)).toBeLessThan(3)
      expect(Math.abs(toHsl(to).l - toHsl(from).l)).toBeLessThan(0.02)
    }
    expect(map['#333333']).toBeUndefined()
    expect(Object.keys(map).length).toBeGreaterThan(1)
  })
  it('maps a separate hue group to the accent colour', () => {
    const two = '<section style="background-color: #eef6ea"><p style="color: #528065">绿</p><p style="color: #e8913a">橙</p></section>'
    const map = harmonize(collectColors(two, parse), { primary: '#3f7fd1', accent: '#c8a44d' })
    expect(hueFamily(map['#528065'])).toBe('blue')
    expect(hueFamily(map['#e8913a'])).toBe('orange')
  })
  it('does nothing when the target colour is grey', () => {
    expect(harmonize(collectColors(GREEN, parse), { primary: '#666666', accent: '#999999' })).toEqual({})
  })
  it('unifies components from two templates into one palette', () => {
    const purple = createBlock('html', { html: '<section style="background-color: #f3eefa"><p style="color: #5b3a9c">紫色模板</p></section>' })
    const green = createBlock('html', { html: GREEN })
    const main = docMainColors([purple], THEMES[0], parse)
    expect(hueFamily(main.primary)).toBe('purple')
    const out = recolorHtml(green.props.html, harmonize(collectColors(green.props.html, parse), main), parse)
    const families = collectColors(out, parse).filter((c) => c.chroma).map((c) => hueFamily(c.hex))
    expect(new Set(families)).toEqual(new Set(['purple']))
  })
  it('falls back to theme colours and reports fixed decor', () => {
    expect(docMainColors([createBlock('paragraph')], THEMES[0], parse).primary).toBe(THEMES[0].colors.primary)
    expect(fixedDecorCount(GRID, parse)).toBe(2)
    expect(fixedDecorCount(carousel, parse)).toBe(0)
  })
})

describe('component storage', () => {
  let dir: string
  let store: typeof import('../../server/components')
  const draft = (html: string) => makeDraft({ name: '卡片', block: createBlock('html', { html, source }), source, via: 'block', attested: true }, parse)

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'xiumi-comp-'))
    vi.stubEnv('DATA_DIR', dir)
    vi.resetModules()
    store = await import('../../server/components')
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  it('saves, lists, renames and removes', async () => {
    const { component, duplicate } = await store.saveComponent(draft(card('甲')))
    expect(duplicate).toBe(false)
    expect(component).toMatchObject({ schema: 1, rev: 1 })
    const updated = await store.updateComponent(component.id, { name: '新名字', tags: ['甲', '甲'], kind: 'image', block: 'ignored' })
    expect(updated).toMatchObject({ name: '新名字', tags: ['甲'], kind: 'image', rev: 2 })
    expect(updated.block).toEqual(component.block)
    expect((await store.listComponents()).map((c) => c.id)).toEqual([component.id])
    await store.removeComponent(component.id)
    expect(await store.listComponents()).toEqual([])
    await expect(store.updateComponent(component.id, {})).rejects.toThrow('不存在')
  })
  it('does not store the same structure twice', async () => {
    const a = await store.saveComponent(draft(card('甲')))
    const b = await store.saveComponent(draft(card('乙')))
    expect(b.duplicate).toBe(true)
    expect(b.component.id).toBe(a.component.id)
    await store.removeComponent(a.component.id)
  })
  it('refuses unattested imports', async () => {
    await expect(store.saveComponent({ ...draft(card('甲')), origin: { ...source, attested: false } })).rejects.toThrow('确认使用权')
  })
  it('reports images whose asset was deleted', async () => {
    const { component } = await store.saveComponent(draft('<section style="border: 1px solid #000"><img src="/media/gone.jpg?fit=1:1"><img src="/media/kept.jpg"></section>'))
    writeFileSync(join(dir, 'assets', 'kept.jpg'), 'x')
    const [c] = await store.listComponents()
    expect(c.missing).toEqual(['gone.jpg'])
    await store.removeComponent(component.id)
  })
  it('skips corrupt files and records from a newer schema', async () => {
    writeFileSync(join(dir, 'components', 'broken.json'), '{not json')
    writeFileSync(join(dir, 'components', 'future.json'), JSON.stringify({ id: 'future', schema: 99, block: createBlock('heading'), createdAt: 1 }))
    expect(await store.listComponents()).toEqual([])
  })
})

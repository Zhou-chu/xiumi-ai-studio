import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { componentBlock, fingerprint, hueFamily, makeDraft, searchComponents, validateDraft, type LibraryComponent } from '../../src/core/components'
import { componentPieces, expandPick, fragmentHtml, fragmentLabel, fragmentStats, horizontalInset, insertionAnchor, isCarousel, pickElement, placeFragment, splitCandidates } from '../../src/core/fragments'
import { guessKind } from '../../src/core/templateFill'

const parse = (s: string) => new JSDOM(s).window.document
const rootOf = (html: string) => parse(`<!doctype html><body><section id="r">${html}</section></body>`).getElementById('r')!
const source = { kind: 'xiumi' as const, title: '测试', url: '', account: '' }

/** 仿真实秀米版块：图片卡、胶囊标题（×2）、正文、轮播，都包在一层白底容器里 */
const JPG = (n: number) => `https://mmbiz.qpic.cn/sz_mmbiz_jpg/p${n}/640?wx_fmt=jpeg`
const card = (t: string) => `<section style="margin: 10px 0"><section style="display: inline-block; width: 100%; padding: 5px; border: 1px solid #528065"><img src="${JPG(1)}" style="width: 100%"><p style="font-size: 13px">${t}</p></section></section>`
const pill = (t: string) => `<section style="margin: 10px 0"><section style="display: inline-block; width: 180px"><section style="display: flex; flex-flow: row nowrap"><section style="display: inline-block; width: 33%"><svg viewBox="0 0 10 10"><rect fill="#9cc393" width="10" height="10"></rect></svg></section><section style="display: inline-block; width: auto"><p style="color: #528065"><strong>${t}</strong></p></section><section style="display: inline-block; width: 33%"><svg viewBox="0 0 10 10"><rect fill="#9cc393" width="10" height="10"></rect></svg></section></section></section></section>`
const para = (t: string) => `<section style="padding: 0 5px; box-sizing: border-box"><p>${t}</p></section>`
const slide = (n: number) => `<g><foreignObject width="100%" height="100%"><svg viewBox="0 0 1080 720" style="background-image: url(&quot;${JPG(n)}&quot;); background-size: 100%"></svg></foreignObject></g>`
const carousel = `<section style="display: flex; flex-flow: row nowrap; margin: 10px 0"><section style="display: inline-block; width: 100%; background-color: #ecf6e4"><svg viewBox="0 0 1080 720" style="display: block">${slide(1)}${slide(2)}${slide(1)}<animate attributeName="opacity" values="0;1"></animate></svg></section></section>`
const BIG = `<section style="background-color: #f5fef1; font-size: 16px; color: rgb(62, 62, 62); letter-spacing: 1px"><section style="display: flex; flex-flow: row nowrap; width: 100%"><section style="display: inline-block; width: 100%; background-color: #ffffff; padding: 20px">${card('图注甲')}${pill('制作准备')}${para('一段正文。')}${card('图注乙')}${pill('成果展示')}${para('又一段正文。')}${carousel}</section></section></section>`
/** 秀米拼图标题：网格里的碎片 + 标题 */
const GRID = `<section style="display: grid; width: 100%"><section style="width: 40%"><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/a/0?wx_fmt=png" style="width: 100%"></section><section style="width: 30%"><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/b/0?wx_fmt=png" style="width: 100%"></section><section style="display: flex"><svg viewBox="0 0 90 20"><foreignObject width="100%" height="100%"><p style="font-size: 18px">章节标题</p></foreignObject></svg></section></section>`

describe('fragment picking', () => {
  it('picks the outermost svg, the enclosing block for inline text, and the whole grid for collage pieces', () => {
    const r = rootOf(`<section style="padding: 4px"><p>文字<strong id="s">加粗</strong></p><p>第二段</p></section>${GRID}${carousel}`)
    expect(pickElement(r.querySelector('#s')!, r)!.tagName.toLowerCase()).toBe('p')
    const grid = r.children[1]
    expect(pickElement(grid.querySelector('img')!, r)).toBe(grid)
    const rect = r.querySelector('foreignObject svg')!
    const svg = rect.closest('svg')!.parentElement!.closest('svg')!
    expect(r.contains(svg)).toBe(true)
    // 透明外壳（只有一个子元素）一并选中，保留底色和内边距
    expect(pickElement(rect, r)).toBe(r.children[2])
    expect(pickElement(r, r)).toBeNull()
  })
  it('expands one level at a time and stops at the block', () => {
    const r = rootOf(`<section id="outer"><section id="inner"><p id="a">甲</p><p>乙</p></section><p>丙</p></section><p>丁</p>`)
    const a = pickElement(r.querySelector('#a')!, r)!
    expect(a.id).toBe('a')
    const up = expandPick(a, r)!
    expect(up.id).toBe('inner')
    expect(expandPick(up, r)!.id).toBe('outer')
    expect(expandPick(r.querySelector('#outer')!, r)).toBeNull()
  })
  it('keeps inherited text styles on the extracted fragment', () => {
    const r = rootOf('<section style="color: #528065; font-size: 18px; padding: 9px"><section style="letter-spacing: 2px"><p id="p" style="color: #111111; margin: 0">标题</p></section></section>')
    const out = fragmentHtml(r.querySelector('#p')!, r)
    expect(out).toContain('letter-spacing: 2px')
    expect(out).toContain('font-size: 18px')
    expect(out).toContain('color: #111111')
    expect(out).not.toContain('#528065') // 自身已有颜色，不覆盖
    // 不可继承的样式不写到片段自身；外层的内边距变成外面一圈左右空白
    expect(parse(`<body>${out}</body>`).getElementById('p')!.getAttribute('style')).not.toContain('padding')
    expect(out.startsWith('<section style="padding-left: 9px; padding-right: 9px; box-sizing: border-box"><p id="p"')).toBe(true)
  })
  it('keeps the side space the outer layers gave the fragment', () => {
    // 仿真实大版块：纹理单栏左右 15px、白色卡片 20px，里面的图片框插入后应和原来一样宽
    const r = rootOf(`<section style="background-color: #f5fef1"><section style="display: flex; padding: 0px 15px"><section style="display: inline-block; width: 100%; padding: 20px"><section id="frame" style="margin: 10px 0px; border: 1px solid #9cc393"><img src="${JPG(1)}"></section></section></section></section>`)
    const out = fragmentHtml(r.querySelector('#frame')!, r)
    expect(out.startsWith('<section style="padding-left: 35px; padding-right: 35px; box-sizing: border-box"><section id="frame"')).toBe(true)
    const el = (style: string) => rootOf(`<section style="${style}"></section>`).firstElementChild!
    expect(horizontalInset([el('padding: 4px 6px 8px'), el('margin: 0 auto; border: 2px dashed #000')])).toEqual([8, 8])
    expect(horizontalInset([el('padding: 10px; padding-left: 3px; border-left: 1px solid; border-right: none')])).toEqual([4, 10])
    expect(horizontalInset([el('padding: 0 5%; margin-left: -12px; border-width: 0 3px')])).toEqual([0, 3])
    expect(horizontalInset([el('padding: 0'), el('')])).toEqual([0, 0])
    expect(fragmentHtml(r.querySelector('#frame')!, r.querySelector('#frame')!.parentElement!)).not.toContain('padding-left')
  })

  it('puts a component into the big block after the paragraph holding the caret, without doubling the side space', () => {
    const card = (body: string) =>
      rootOf(`<section style="background-color: #f5fef1"><section style="display: flex; padding: 0px 15px"><section id="card" style="display: inline-block; width: 100%; padding: 20px"><p id="p1"><span><strong id="b">文字一</strong></span></p>${body}<p id="p2">文字二</p></section></section></section>`)
    const frame = `<section style="padding-left: 35px; padding-right: 35px; box-sizing: border-box"><section id="frame" style="border: 1px solid #9cc393"><img src="${JPG(1)}"></section></section>`
    let r = card('')
    const caret = r.querySelector('#b')!.firstChild!
    const anchor = insertionAnchor(caret, r)!
    expect(anchor.id).toBe('p1')
    const added = placeFragment(anchor, r, frame)
    // 插回卡片里：外层已经留了 35px，外包的留白去掉，图片框就在第一段和第二段之间
    expect(added.map((e) => e.id)).toEqual(['frame'])
    expect(Array.from(r.querySelector('#card')!.children).map((e) => e.id)).toEqual(['p1', 'frame', 'p2'])
    expect(r.innerHTML).not.toContain('padding-left: 35px')
    // 只有一部分留白时补上差值
    r = card('')
    placeFragment(r.querySelector('#card')!, r, frame)
    expect(r.querySelector('#frame')!.parentElement!.getAttribute('style')).toBe('padding-left: 20px; padding-right: 20px; box-sizing: border-box')
    // 正文外面又包了一层 5px：最后一段后面插入时放到这层外面，宽度和原来一样；不是最后一段时留在原处
    r = card(`<section id="text" style="padding: 0 5px"><p id="t1">甲</p><p id="t2">乙</p><p><br></p></section>`)
    placeFragment(insertionAnchor(r.querySelector('#t2')!.firstChild, r)!, r, frame)
    expect(Array.from(r.querySelector('#card')!.children).map((e) => e.id)).toEqual(['p1', 'text', 'frame', 'p2'])
    r = card(`<section id="text" style="padding: 0 5px"><p id="t1">甲</p><p id="t2">乙</p></section>`)
    placeFragment(insertionAnchor(r.querySelector('#t1')!.firstChild, r)!, r, frame)
    expect(Array.from(r.querySelector('#text')!.children).map((e) => e.id)).toEqual(['t1', 'frame', 't2'])
    // 光标在一栏的段落里时放在这一栏里；光标就在横排的一格上时放到整行后面，不添一栏；SVG 轮播按整个轮播算；不在内容里时返回 null
    r = card(`<section id="row" style="display: flex"><section id="col" style="flex: 1"><p id="c">左栏</p></section><section id="cell" style="flex: 1">右栏</section></section><section id="wrap"><svg id="svg"><g><foreignObject><p id="deep">x</p></foreignObject></g></svg></section>`)
    expect(insertionAnchor(r.querySelector('#c')!.firstChild, r)!.id).toBe('c')
    expect(insertionAnchor(r.querySelector('#cell')!.firstChild, r)!.id).toBe('row')
    expect(insertionAnchor(r.querySelector('#deep')!.firstChild, r)!.id).toBe('svg')
    expect(insertionAnchor(r, r)).toBeNull()
    expect(insertionAnchor(null, r)).toBeNull()
    expect(insertionAnchor(rootOf('<p>外面</p>').firstChild, r)).toBeNull()
  })
})

describe('split suggestions on a Xiumi-like block', () => {
  const list = splitCandidates(BIG, parse)
  it('finds the photo card, pill heading and carousel, merging repeats', () => {
    const cardItem = list.find((f) => f.html.includes('border: 1px solid #528065') && f.depth === 0)!
    expect(cardItem).toMatchObject({ repeat: 2, texts: 1, photos: 1 })
    const pillItem = list.find((f) => f.label === '制作准备')!
    expect(pillItem.repeat).toBe(2)
    const c = list.find((f) => f.bgPhotos > 0)!
    expect(c.bgPhotos).toBe(2) // 三张幻灯片里两张相同
  })
  it('lists a carousel that fills most of its block', () => {
    // 真实模板：轮播占整个模块九成以上，只多一段短文字，之前会被当成“几乎整块”漏掉
    const many = carousel.replace(slide(1) + slide(2), [1, 2, 3, 4, 5, 6, 7, 8].map(slide).join(''))
    const block = `<section style="background-color: #f5fef1"><section style="padding: 20px">${para('一段很短的正文。')}${many}</section></section>`
    expect(many.length / block.length).toBeGreaterThan(0.9)
    const c = splitCandidates(block, parse).find((f) => f.bgPhotos > 0)!
    expect(c.bgPhotos).toBe(8)
    expect(c.label).toBe('轮播（8 张）')
    expect(isCarousel(c.html, parse)).toBe(true)
  })
  it('does not repeat a fragment that is practically the whole block', () => {
    expect(splitCandidates(`<section><section style="margin: 1px">${carousel}</section></section>`, parse)).toEqual([])
  })
  it('recognises carousels and names components by content', () => {
    expect(isCarousel(carousel, parse)).toBe(true)
    expect(isCarousel(card('x'), parse)).toBe(false)
    expect(isCarousel(`<svg viewBox="0 0 10 10" style="background-image: url(${JPG(1)})"></svg>`, parse)).toBe(false)
    expect(fragmentLabel(carousel, parse)).toBe('轮播（2 张）')
    expect(fragmentLabel(pill('制作准备'), parse)).toBe('制作准备')
    expect(fragmentLabel(`<section><img src="${JPG(1)}"></section>`, parse)).toBe('图片框（1 张）')
    expect(fragmentLabel('<section style="border: 1px solid #000"></section>', parse)).toBe('装饰组件')
    const d = makeDraft({ name: 'x', tags: ['活动'], block: createBlock('html', { html: carousel }), source, via: 'fragment', attested: true }, parse)
    expect(d.tags).toEqual(['活动', '轮播'])
    expect(d.kind).toBe('image')
  })
  it('skips plain paragraphs even with box-sizing: border-box', () => {
    expect(list.some((f) => f.label.includes('正文'))).toBe(false)
  })
  it('does not split a pill heading row or a grid collage', () => {
    expect(list.some((f) => f.chars < 300 && f.html.includes('<rect'))).toBe(false)
    expect(splitCandidates(GRID, parse)).toEqual([])
  })
  it('carries inherited styles and sanitizes each fragment', () => {
    const dirty = BIG.replace('<p>一段正文。</p>', '<p onclick="x()">一段正文。</p>')
    for (const f of splitCandidates(dirty, parse)) {
      expect(f.html).not.toMatch(/onclick/)
      expect(f.html).toContain('letter-spacing: 1px')
    }
  })
  it('breaks big imported blocks into first-level pieces and skips plain text', () => {
    const pad = BIG.replace('一段正文。', '正文'.repeat(3000))
    expect(componentPieces(pad, '大版块', parse).length).toBeGreaterThanOrEqual(3)
    expect(componentPieces('<p>只有文字</p>', '段落', parse)).toEqual([])
    expect(componentPieces(card('小卡片'), '小卡片', parse)).toEqual([{ html: card('小卡片'), label: '小卡片' }])
  })
  it('counts fragment stats', () => {
    expect(fragmentStats(card('x'), parse)).toMatchObject({ texts: 1, photos: 1, bgPhotos: 0 })
  })
})

describe('component records', () => {
  const block = createBlock('html', { html: card('图注'), label: '图片卡', source })
  it('builds a draft with stats, palette, fingerprint and private origin', () => {
    const d = makeDraft({ name: ' 图片卡 ', tags: ['活动', '活动', ' '], block, source, via: 'fragment', attested: true }, parse)
    expect(d).toMatchObject({ name: '图片卡', kind: guessKind(block, parse), tags: ['活动'], stats: { texts: 1, photos: 1 } })
    expect(d.origin).toMatchObject({ kind: 'xiumi', via: 'fragment', attested: true, redistributable: false })
    expect(hueFamily(d.palette[0])).toBe('green')
    expect(d.text).toContain('图注')
  })
  it('gives the same fingerprint to the same structure with different text and photos', () => {
    const other = createBlock('html', { html: card('别的图注').replace(JPG(1), JPG(5)) })
    expect(fingerprint(other, parse)).toBe(fingerprint(block, parse))
    expect(fingerprint(createBlock('html', { html: pill('x') }), parse)).not.toBe(fingerprint(block, parse))
    expect(fingerprint(createBlock('heading', { title: '甲' }), parse)).not.toBe(fingerprint(createBlock('heading', { title: '乙' }), parse))
  })
  it('classifies pieces', () => {
    expect(guessKind(createBlock('html', { html: pill('标题') }), parse)).toBe('heading')
    expect(guessKind(createBlock('html', { html: carousel }), parse)).toBe('image')
    expect(guessKind(createBlock('html', { html: '<section style="border: 1px solid #000"></section>' }), parse)).toBe('decor')
    expect(guessKind(createBlock('html', { html: '<p>文字｜张三</p><p>点击蓝字关注我们</p>' }), parse)).toBe('ending')
    expect(guessKind(createBlock('quote'), parse)).toBe('body')
  })
  it('requires attestation for imported content and forces it to stay private', () => {
    const d = makeDraft({ name: 'x', block, source, via: 'block', attested: false }, parse)
    expect(validateDraft(d).error).toContain('确认使用权')
    const ok = validateDraft({ ...makeDraft({ name: 'x', block, source, via: 'block', attested: true }, parse), origin: { ...source, attested: true, redistributable: true } })
    expect(ok.draft?.origin.redistributable).toBe(false)
    expect(validateDraft({ ...d, block: createBlock('heading'), origin: { kind: 'original' } }).draft?.origin.redistributable).toBe(true)
  })
  it('rejects bad data and neutralises stored scripts', () => {
    expect(validateDraft(null).error).toBeTruthy()
    expect(validateDraft({ block: { type: 'nope' } }).error).toBeTruthy()
    expect(validateDraft({ block: createBlock('html', { html: '   ' }), origin: { attested: true } }).error).toContain('为空')
    expect(validateDraft({ block: createBlock('html', { html: 'x'.repeat(400_001) }), origin: { attested: true } }).error).toContain('拆分')
    const d = validateDraft({ name: 'x', kind: 'bogus', palette: ['red', '#112233'], block: createBlock('html', { html: '<p onclick="a()">甲</p><script>b()</script>' }), origin: { attested: true, url: 'javascript:x' } }).draft!
    expect(d.block.type === 'html' && d.block.props.html).toBe('<p>甲</p>')
    expect(d).toMatchObject({ kind: 'body', palette: ['#112233'], origin: { url: '' } })
  })
  it('creates a fresh, clean block on each insert', () => {
    const dirty = { ...block, props: { ...block.props, html: '<p style="color: red" onclick="a()">甲</p><script>b()</script>' } }
    const a = componentBlock(dirty, parse)
    const b = componentBlock(dirty, parse)
    expect(a.id).not.toBe(b.id)
    expect(a.id).not.toBe(dirty.id)
    expect(a.type === 'html' && a.props.html).toBe('<p style="color: red">甲</p>')
  })
  it('keeps source through normalisation so loading a project does not rewrite it', () => {
    const b = componentBlock(block, parse)
    expect(b.type === 'html' && b.props.source).toEqual(source)
  })
  it('searches by text, tag, kind, source and hue', () => {
    const c = (name: string, kind: LibraryComponent['kind'], color: string, extra = {}) => ({ name, kind, tags: ['活动'], text: '风筝制作', palette: [color], origin: { title: '能源44', account: '', kind: 'xiumi' }, ...extra }) as any
    const list = [c('绿色相框', 'image', '#57a55a'), c('紫色标题', 'heading', '#7f5bc8', { tags: ['团日'], text: '开幕' })]
    expect(searchComponents(list, { text: '相框' }).map((x) => x.name)).toEqual(['绿色相框'])
    expect(searchComponents(list, { text: '团日' }).map((x) => x.name)).toEqual(['紫色标题'])
    expect(searchComponents(list, { text: '风筝 活动' }).map((x) => x.name)).toEqual(['绿色相框'])
    expect(searchComponents(list, { kind: 'heading' }).map((x) => x.name)).toEqual(['紫色标题'])
    expect(searchComponents(list, { hue: 'green' }).map((x) => x.name)).toEqual(['绿色相框'])
    expect(searchComponents(list, { text: '能源44' })).toHaveLength(2)
    expect(searchComponents(list, { text: '不存在' })).toEqual([])
  })
})

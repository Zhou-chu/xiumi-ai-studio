// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { makeDraft, normalizeTags, searchComponents, validateDraft } from '../../src/core/components'
import { componentPieces, fragmentHtml, fragmentLabel, fragmentStats, horizontalInset, insertionAnchor, pickElement, placeFragment } from '../../src/core/fragments'

function rootOf(html: string) {
  const doc = new DOMParser().parseFromString('<section id="root">' + html + '</section>', 'text/html')
  return doc.getElementById('root')!
}

it('copies nearest inherited text declarations without rewriting the original photo or layout', () => {
  const root = rootOf('<section style="font-size:21px;color:red;padding:5px"><section style="font-size:17px;letter-spacing:1px"><figure style="color:black"><img src="/media/a.jpg" alt="Source"><figcaption>Caption</figcaption></figure></section></section>')
  const before = root.innerHTML, original = root.querySelector('figure')!
  const fragment = rootOf(fragmentHtml(original, root, false))
  const figure = fragment.querySelector('figure')!
  expect(fragment.firstElementChild).toBe(figure)
  expect(figure.style.fontSize).toBe('17px')
  expect(figure.style.letterSpacing).toBe('1px')
  expect(figure.style.color).toBe('black')
  expect(figure.querySelector('img')?.getAttribute('src')).toBe('/media/a.jpg')
  expect(figure.querySelector('img')?.getAttribute('alt')).toBe('Source')
  expect(figure.textContent).toBe('Caption')
  expect(root.innerHTML).toBe(before)
})

it('keeps a flex-column caret at its authored paragraph and inserts in original node order', () => {
  const root = rootOf('<section id="column" style="display:flex;flex-direction:column"><p id="a">甲</p><p id="b">乙</p></section>')
  const anchor = insertionAnchor(root.querySelector('#a')!.firstChild, root)!
  expect(anchor.id).toBe('a')
  const inserted = placeFragment(anchor, root, '<figure id="photo"><img src="/media/b.jpg"></figure><p id="caption">图注</p>')
  expect(inserted.map(node => node.id)).toEqual(['photo', 'caption'])
  expect([...root.querySelector('#column')!.children].map(node => node.id)).toEqual(['a','photo','caption','b'])
  expect(inserted[0].querySelector('img')?.getAttribute('src')).toBe('/media/b.jpg')
  expect(root.textContent).toBe('甲图注乙')
})

it('preserves an intentional decorative inset wrapper instead of consuming its background', () => {
  const root = rootOf('<section style="padding:0 20px"><p id="a">Before</p></section>')
  const added = placeFragment(root.querySelector('#a')!, root, '<section style="padding-left:10px;padding-right:10px;background-color:#eee"><blockquote>Keep decoration</blockquote></section>')
  expect(added).toHaveLength(1)
  expect((added[0] as HTMLElement).style.backgroundColor).toBe('rgb(238, 238, 238)')
  expect(added[0].querySelector('blockquote')?.textContent).toBe('Keep decoration')
})

it('sums asymmetric overrides with decimal pixels and clamps negative sides', () => {
  const root = rootOf('<section style="padding:0 6.25px 0 7.5px!important;border:1px solid; margin-left:-50px; border-right-width: 2px"><div style="border-left:0.5px solid;border-right:none;margin-right:1.25px"></div></section>')
  expect(horizontalInset([root.querySelector('section')!,root.querySelector('div')!])).toEqual([0,9.5])
})

it('does not cross an authored wrapper containing its own text', () => {
  const root = rootOf('<section>作者前缀<div id="single"><p id="text">正文<strong>加粗</strong></p><p> &nbsp; </p></div></section>')
  const picked = pickElement(root.querySelector('strong')!, root)
  expect(picked?.id).toBe('single')
  expect(picked?.textContent).not.toContain('作者前缀')
})

it('keeps one intact compact styled photo piece while bare text is not a library component', () => {
  const html = '<figure style="border:1px solid #333"><img src="/media/a.jpg"><figcaption>原图注</figcaption></figure>'
  expect(componentPieces(html,'图文原件')).toEqual([{ html, label: '图文原件' }])
  expect(componentPieces('<p>单独正文</p>','正文')).toEqual([])
  expect(fragmentStats(html)).toMatchObject({ texts: 1, photos: 1, bgPhotos: 0, chars: html.length })
  expect(fragmentLabel('<section><img src="/media/plain.jpg"></section>')).toBe('图片框（1 张）')
})

it('bounds normalized tags and uses stable first-seen order', () => {
  const long = '甲'.repeat(16)
  const tags = [' ', '活动', ' 活动 ', long + '外', long + '后', ...Array.from({ length: 20 }, (_, i) => '标签' + i)]
  const result = normalizeTags(tags)
  expect(result).toHaveLength(12)
  expect(result.slice(0,4)).toEqual(['活动',long,'标签0','标签1'])
  expect(normalizeTags('not an array')).toEqual([])
})

it('role-aware filtering combines body, title, and metadata without changing component origin', () => {
  const block = createBlock('heading',{ title: '开场' })
  const draft = makeDraft({ name: '章节开场', role:'h1', tags:['团日'], block, source:{kind:'original',title:'活动记录',url:'',account:''}, via:'template', attested:true })
  const saved = validateDraft({...draft, kind:'cover'}).draft!
  expect(saved.kind).toBe('heading')
  expect(saved.origin).toMatchObject({kind:'original', via:'template', redistributable:true})
  expect(searchComponents([saved], {text:'团日 活动记录',role:'h1'})).toEqual([saved])
  expect(searchComponents([saved], {text:'团日',role:'h2'})).toEqual([])
})

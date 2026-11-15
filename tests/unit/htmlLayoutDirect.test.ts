// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { restructureImportedHtml } from '../../src/core/htmlLayout'
import { THEMES } from '../../src/core/themes'

const theme = THEMES.find(item => item.id === 'tsinghua-purple')!
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const content = (html: string) => {
  const doc = parse(html)
  return { text: doc.body.textContent, resources: Array.from(doc.body.querySelectorAll('[src],[href],[srcset],[poster]')).map(node => [
    node.tagName, ...['src','href','srcset','poster','alt'].map(attr => node.getAttribute(attr)),
  ]) }
}

it('flattens cosmetic transparent wrappers and groups headings with their following body', () => {
  const html = '<main style="margin:4px;padding:2px;background-color:transparent"><section><p>实际导语</p><h2>第一章</h2><p>正文</p></section><article style="background-color:rgba(0,0,0,0);color:#111"><h3>下一节</h3><p>尾段</p></article></main>'
  const result = restructureImportedHtml(html, 'chapters', theme)
  expect(result).toMatchObject({ preserved: 0 })
  expect(result.error).toBeUndefined()
  const output = parse(result.html!)
  const sections = [...output.querySelectorAll('[data-layout-chapter]')]
  expect(sections.map(section => section.textContent)).toEqual(['实际导语', '第一章正文', '下一节尾段'])
  expect(sections.map(section => section.getAttribute('data-layout-chapter'))).toEqual(['1','2','3'])
  expect((sections[1] as HTMLElement).style.borderLeftWidth).toBe('3px')
  expect(output.querySelector('main,article')).toBeNull()
  expect(content(result.html!)).toEqual(content(html))
})
it('creates an editorial group for each top-level text or element in original order', () => {
  const html = '<div>导语<p>一段</p><hr><p>末尾</p></div>'
  const result = restructureImportedHtml(html, 'editorial', theme)
  expect(result.error).toBeUndefined()
  const root = parse(result.html!).querySelector<HTMLElement>('[data-article-layout="editorial"]')!
  expect(root.style.fontSize).toBe(`${theme.fontSize}px`)
  expect([...root.children].map(x => x.textContent)).toEqual(['导语','一段','','末尾'])
  expect((root.children[0] as HTMLElement).style.borderBottomWidth).toBe('1px')
  expect(content(result.html!)).toEqual(content(html))
})
it('retains opaque contrast backgrounds and explicit wrapper identity without merging descendants', () => {
  const contrast = '<div style="background-color:#111"><p style="color:#fff">仍可读</p></div>'
  const semantic = '<section id="manual" aria-label="保留"><p>章节元数据</p></section>'
  const html = '<p>安全正文</p>' + contrast + semantic
  const result = restructureImportedHtml(html, 'chapters', theme)
  expect(result).toMatchObject({ preserved: 2 })
  expect(result.html).toContain(contrast)
  expect(result.html).toContain(semantic)
  expect(content(result.html!)).toEqual(content(html))
})
it.each([
  '<table><tr><td>复杂表格</td></tr></table>',
  '<section style="display:grid"><p>布局语义</p></section>',
  '<p style="position:relative">定位段落</p>',
  '<div style="background-image:url(/fixture/local.png)"><p>背景</p></div>',
  '<svg width="12"><text>静态图形</text></svg>',
])('declines rearranging an entirely opaque island without issuing replacement HTML', (html) => {
  expect(restructureImportedHtml(html, 'editorial', theme)).toEqual({
    error: '该片段全部属于复杂布局，无法安全拆分；保留原结构，未执行重排。', preserved: 1,
  })
})
it('does not reorder or strip link, image, srcset, poster or alt attributes', () => {
  const html = '<article><p><a href="/fixture/link">链接</a></p><figure><img src="/fixture/pic.png" srcset="/fixture/pic2.png 2x" alt="图片描述"><figcaption>附注</figcaption></figure><video src="/fixture/movie" poster="/fixture/cover.png">后备文字</video></article>'
  const result = restructureImportedHtml(html, 'editorial', theme)
  expect(result).toMatchObject({ preserved: 1 })
  expect(result.html).toContain('<video src="/fixture/movie" poster="/fixture/cover.png">后备文字</video>')
  expect(content(result.html!)).toEqual(content(html))
})
it('does not report a structural success when no meaningful or movable content exists', () => {
  expect(restructureImportedHtml('<!-- only comment --><div> </div>', 'chapters', theme)).toMatchObject({ preserved: 0 })
  expect(restructureImportedHtml('<!-- only comment --><div> </div>', 'chapters', theme).html).toBeUndefined()
})

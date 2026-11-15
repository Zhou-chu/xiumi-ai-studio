import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { articleToMarkdown } from '../../src/core/wxImport'

function convert(html: string, title = '文章标题') {
  const root = new JSDOM('<main>' + html + '</main>').window.document.querySelector('main')!
  const snapshot = root.innerHTML
  const result = articleToMarkdown({
    title, account: '', author: '', digest: '', cover: '', root,
    source: { kind: 'original', title, url: '', account: '' },
  })
  expect(root.innerHTML).toBe(snapshot)
  return result
}

it('serializes a table with escaped cell delimiters and ignores an empty table', () => {
  const { markdown } = convert('<table></table><table><tr><th>项目|类别</th><th>值</th></tr><tr><td>一</td><td>二</td></tr></table>')
  expect(markdown).toBe('# 文章标题\n\n| 项目/类别 | 值 |\n| --- | --- |\n| 一 | 二 |')
})

it('keeps inherited headings, bold-only headings, blockquotes and ordinary punctuation distinct', () => {
  const { markdown } = convert('<h2>文章标题</h2><h2>01</h2><section style="font-size:18px"><p>短标题</p><p>普通句子。</p></section><p><strong>加粗标题</strong></p><p><strong>半段</strong>普通</p><blockquote>引语正文</blockquote>')
  expect(markdown).toBe('# 文章标题\n\n## 短标题\n\n普通句子。\n\n## 加粗标题\n\n半段普通\n\n> 引语正文')
})

it('keeps repeated inline image positions but returns each image source only once', () => {
  const { markdown, images } = convert('<figure><img src="/media/test.jpg"><img><figcaption>说明</figcaption></figure><p><img src="/media/test.jpg">段落</p>')
  expect(images).toEqual(['/media/test.jpg'])
  expect(markdown).toBe('# 文章标题\n\n![](/media/test.jpg)\n\n说明\n\n![](/media/test.jpg)\n\n段落')
})

it('falls back to one for an invalid ordered start and keeps a negative integer when specified', () => {
  const { markdown } = convert('<ol start="2.5"><li>甲</li></ol><ol start="-2"><li>乙</li><li>丙</li></ol>')
  expect(markdown).toBe('# 文章标题\n\n1. 甲\n\n-2. 乙\n-1. 丙')
})

it('keeps text on both sides of wrapped inline photos without repeating either photo', () => {
  const { markdown, images } = convert('<p>前文<span><img src="/media/a.jpg"></span>中间<a href="#photo"><img src="/media/b.jpg"></a>后文</p>')
  expect(images).toEqual(['/media/a.jpg', '/media/b.jpg'])
  expect(markdown).toBe('# 文章标题\n\n![](/media/a.jpg)\n\n![](/media/b.jpg)\n\n前文中间后文')
})

it('still processes real nested paragraphs separately instead of flattening the section', () => {
  const { markdown } = convert('<section><p>第一段</p><section><p>第二段</p><p>第三段<img src="/media/d.jpg">结束</p></section></section>')
  expect(markdown).toBe('# 文章标题\n\n第一段\n\n第二段\n\n![](/media/d.jpg)\n\n第三段结束')
})

it('keeps a sole paragraph when wrapper peeling lands in its only inline span', () => {
  const { markdown } = convert('<p><span>仍有文字<img src="/media/one.jpg"></span></p>')
  expect(markdown).toBe('# 文章标题\n\n![](/media/one.jpg)\n\n仍有文字')
})

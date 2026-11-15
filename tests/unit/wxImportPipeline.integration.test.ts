import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { articleToMarkdown, extractArticle } from '../../src/core/wxImport'

const parse = (html: string) => new JSDOM(html).window.document

describe('in-memory source extraction → Markdown pipeline', () => {
  it('converts semantic markdown, inherited size, tables, images and deduplicated headers',()=>{
    const a=extractArticle(parse('<h1>Title</h1><main id="js_content"><h2>Title</h2><p style="font-size:20px">01</p><section style="font-size:20px"><p>Section</p></section><p><strong>Bold heading</strong></p><p>A long sentence with punctuation.</p><blockquote>Quote</blockquote><li>List item</li><table><tr><td>A|B</td><td>C</td></tr><tr><td>D</td><td>E</td></tr></table><table></table><img><img src="https://example.com/a.jpg"><img src="https://example.com/a.jpg"><figure><span><img src="https://example.com/b.jpg"></span></figure><p></p></main>'))
    const result=articleToMarkdown(a);expect(result.images).toEqual(['https://example.com/a.jpg','https://example.com/b.jpg'])
    expect(result.markdown).toContain('## Section');expect(result.markdown).toContain('> Quote');expect(result.markdown).toContain('- List item');expect(result.markdown).toContain('| A/B | C |');expect(result.markdown).not.toContain('## 01');expect(result.markdown).not.toContain('## Title')
    expect(articleToMarkdown(extractArticle(parse('<p>Text</p><p>Other</p>'))).markdown).toContain('Text')
  })
  it.each(['floating', 'report'] as const)('removes an unmarked reading page frame identified by a %s sibling', kind => {
    const aside = kind === 'floating'
      ? '<aside style="position:fixed">扫码</aside>'
      : '<aside><a href="https://example.invalid/report/page">投诉</a></aside>'
    const article = extractArticle(parse('<div><header><h3>Frame title</h3></header><main><p>' + '真正正文。'.repeat(20) + '</p></main>' + aside + '</div>'))
    expect(article.title).toBe('Frame title')
    expect(article.root.tagName).toBe('MAIN')
    const output = articleToMarkdown(article).markdown
    expect(output).toBe('# Frame title\n\n' + '真正正文。'.repeat(20))
  })
})

it('preserves nested lists, text order, and images when generating Markdown', () => {
  const article = extractArticle(parse('<main id="js_content"><ul><li>First<ul><li>Nested</li></ul></li><li>Second</li></ul><ol start="3"><li>Third<img src="https://example.invalid/list.jpg"><ol><li>Inner</li></ol></li><li>Fourth</li></ol></main>'))
  const result = articleToMarkdown(article)
  expect(result.markdown).toContain('- First\n  - Nested\n- Second')
  expect(result.markdown).toContain('3. Third\n   1. Inner\n4. Fourth')
  expect(result.markdown).toContain('![](https://example.invalid/list.jpg)')
  expect(result.images).toEqual(['https://example.invalid/list.jpg'])
})

it('uses safe integer starts, including zero and negative, only on ordered lists', () => {
  const article = extractArticle(parse('<main id="js_content"><ol start="0"><li>Zero</li></ol><ol start="-2"><li>Negative</li></ol><ol start="bad"><li>Default</li></ol><ol start="999999999999999999999"><li>Too large</li></ol><p start="3">Paragraph</p></main>'))
  const md = articleToMarkdown(article).markdown
  expect(md).toContain('0. Zero')
  expect(md).toContain('-2. Negative')
  expect(md).toContain('1. Default')
  expect(md).toContain('1. Too large')
  expect(Array.from(article.root.querySelectorAll('ol')).map(list => list.getAttribute('start'))).toEqual(['0', '-2', null, null])
  expect(article.root.querySelector('p')?.hasAttribute('start')).toBe(false)
  article.root.querySelector('ol')!.setAttribute('start', '')
  expect(articleToMarkdown(article).markdown).toContain('1. Zero')
})

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { extractArticle } from '../../src/core/wxImport'

const from = (markup: string) => extractArticle(new JSDOM(markup).window.document)

describe('explicit reader-page clipboard frame', () => {
  it('keeps the named article and its title, not reader chrome', () => {
    const article = from('<h1>Reader site</h1><header class="tn-board-head"><h2>Notes from the field</h2></header><main class="tn-article-body"><section style="margin-left:-12px;padding-left:12px;color:#333"><p>First paragraph</p><p>Second paragraph</p></section></main><footer>Reader statistics</footer>')
    expect(article.title).toBe('Notes from the field')
    expect(article.root.textContent).toBe('First paragraphSecond paragraph')
    expect(article.root.innerHTML).not.toMatch(/margin-left|padding-left/)
    expect(article.root.innerHTML).toContain('color: #333')
  })

  it('retains ordinary document and WeChat article selection', () => {
    const plain = from('<section><p>One</p><p>Two</p></section><p>Also article content</p>')
    expect(plain.root.textContent).toContain('Also article content')
    const wechat = from('<h1>WeChat content</h1><article id="js_content">WeChat article</article><main class="tn-article-body">Other body</main>')
    expect(wechat.root.textContent).toBe('WeChat article')
  })

  it('keeps positive authored margins and the nested layout intact', () => {
    const article = from('<main class="tn-article-body"><section style="margin-left:10px;padding-left:10px"><p>Indented paragraph</p></section></main>')
    expect(article.root.innerHTML).toContain('margin-left: 10px')
    expect(article.root.innerHTML).toContain('padding-left: 10px')
  })
})

import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { articleToHtmlBlocks, articleToMarkdown, splitHtmlBlock } from '../../src/core/wxImport'

const parse = (html: string) => new JSDOM(html).window.document

it.each(['height:200px', 'max-height:200px', 'box-shadow:0 0 2px #000', 'background-image:url(https://example.invalid/shell.jpg)', 'border-width:1px'])(
  'keeps a unique outer shell with %s intact in import and manual split',
  style => {
    const html = `<section style="${style}"><p style="background:#eee">甲</p><p style="background:#ddd">乙<img src="https://example.invalid/content.jpg"></p></section>`
    const block = createBlock('html', { html })
    expect(splitHtmlBlock(block, parse)).toBeNull()
    const output = articleToHtmlBlocks(parse('<main>' + html + '</main>').querySelector('main')!)
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ type: 'html', props: { html } })
  },
)

it('uses the supplied ordered start on a prepared article without running extraction', () => {
  const root = parse('<main><ol start="8"><li>前<img src="/media/local.jpg"><ul><li>内</li></ul></li><li>后</li></ol></main>').querySelector('main')!
  const title = 'Prepared'
  const result = articleToMarkdown({ title, account: '', author: '', digest: '', cover: '', root, source: { kind: 'original', title, url: '', account: '' } })
  expect(result).toEqual({ markdown: '# Prepared\n\n8. 前\n   - 内\n9. 后\n\n![](/media/local.jpg)', images: ['/media/local.jpg'] })
})

it('retains wrapped nested lists in their nearest list item exactly once', () => {
  const root = parse('<main><ul><li>Outer<div><ol start="2"><li>Middle<div><ul><li>Inner</li></ul></div></li></ol></div></li><li>Next</li></ul></main>').querySelector('main')!
  const result = articleToMarkdown({ title: '', account: '', author: '', digest: '', cover: '', root, source: { kind: 'original', title: '', url: '', account: '' } })
  expect(result.markdown).toBe('# 未命名推文\n\n- Outer\n  2. Middle\n     - Inner\n- Next')
})

it.each([
  ['9007199254740990', '9007199254740990. First\n9007199254740991. Second\n9007199254740992. Third'],
  ['9007199254740991', '9007199254740991. First\n9007199254740992. Second\n9007199254740993. Third'],
])('keeps exact computed indices past the safe Number range when the start is %s', (start, expected) => {
  const root = parse(`<main><ol start="${start}"><li>First</li><li>Second</li><li>Third</li></ol></main>`).querySelector('main')!
  const result = articleToMarkdown({ title: '', account: '', author: '', digest: '', cover: '', root, source: { kind: 'original', title: '', url: '', account: '' } })
  expect(result.markdown).toBe('# 未命名推文\n\n' + expected)
})

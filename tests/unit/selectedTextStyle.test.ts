// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { styledSelectionHtml } from '../../src/editor/selectedTextStyle'

it('styles only selected text across paragraphs without removing inline marks or images', () => {
  const host = document.createElement('div')
  host.innerHTML = '<p>alpha <strong>bold</strong></p><p><img src="/media/a.png">omega</p>'
  const range = document.createRange()
  range.setStart(host.firstChild!.firstChild!, 2)
  range.setEnd(host.lastChild!.lastChild!, 3)
  const html = styledSelectionHtml(host, range, 'fontSize', '24px')!
  expect(html).toContain('font-size: 24px')
  expect(html).toContain('<strong>')
  expect(html).toContain('<img src="/media/a.png">')
  expect(host.innerHTML).not.toContain('24px')
})
it('does not format collapsed or cross-editor selection or unsafe values', () => {
  const host = document.createElement('div'); host.textContent = 'hello'
  const range = document.createRange(); range.selectNodeContents(host); range.collapse(true)
  expect(styledSelectionHtml(host, range, 'fontSize', '24px')).toBeNull()
  range.selectNodeContents(host)
  expect(styledSelectionHtml(host, range, 'fontSize', '99999px')).toBeNull()
  expect(styledSelectionHtml(document.createElement('div'), range, 'fontFamily', 'Arial, sans-serif')).toBeNull()
})
it('replaces inner font overrides but retains colors and original structure', () => {
  const host = document.createElement('div'); host.innerHTML = '<span style="font-size:12px;color:red"><font size="2">text</font></span>'
  const range = document.createRange(); range.selectNodeContents(host)
  const html = styledSelectionHtml(host, range, 'fontSize', '32px')!
  expect(html).not.toContain('12px'); expect(html).not.toContain('size="2"'); expect(html).toContain('color: red'); expect(html).toContain('32px')
})

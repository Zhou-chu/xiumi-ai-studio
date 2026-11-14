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
it('rejects cross-cell and SVG/foreignObject ranges without changing the source', () => {
  const root = document.createElement('div')
  for (const html of ['<table><tr><td>one</td><td>two</td></tr></table>', '<p>before</p><svg><foreignObject><p>caption</p></foreignObject></svg><p>after</p>']) {
    root.innerHTML = html; const before = root.innerHTML
    const range = document.createRange(); range.selectNodeContents(root)
    expect(styledSelectionHtml(root, range, 'fontSize', '24px')).toBeNull()
    expect(root.innerHTML).toBe(before)
  }
})
it('preserves selected image/link attributes and leaves neighboring SVG untouched', () => {
 const root=document.createElement('div'); root.innerHTML='<p><a href="https://example.com">link</a><img src="/media/p.png" width="80" alt="图">text</p><svg><text>艺术</text></svg>'
 const before=root.innerHTML; const range=document.createRange();range.selectNodeContents(root.querySelector('p')!)
 const html=styledSelectionHtml(root,range,'fontFamily','Arial, sans-serif')!
 const holder=document.createElement('div');holder.innerHTML=html
 expect(holder.querySelector('a')!.getAttribute('href')).toBe('https://example.com')
 expect(holder.querySelector('img')!.outerHTML).toBe(root.querySelector('img')!.outerHTML)
 expect(root.innerHTML).toBe(before)
})
it('purifies cloned HTML before native insertion rather than relying on post-commit cleaning', () => {
 const root=document.createElement('div');root.innerHTML='<p><a href="java&#x73;cript:alert(1)">link</a><img src="/media/p.png" onerror="alert(1)">text</p>'
 const range=document.createRange();range.selectNodeContents(root)
 const result=styledSelectionHtml(root,range,'fontSize','24px')!
 const parsed=document.createElement('div');parsed.innerHTML=result
 expect(parsed.querySelector('a')!.hasAttribute('href')).toBe(false)
 expect(parsed.querySelector('img')!.hasAttribute('onerror')).toBe(false)
 expect(parsed.querySelector('img')!.getAttribute('src')).toBe('/media/p.png')
})

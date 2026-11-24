// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { fluidizeArticle } from '../../src/editor/fluidize'
import { ArticleImportModal } from '../../src/editor/ArticleImport'

it('converts a fixed pasted article column and proportional cards in the real import preview', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const markup = '<section id="js_content"><section style="width:600px; display: grid; background:#fff"><section style="width:300px; margin-left: 10px">第一栏</section><section style="width:289.5px">第二栏</section><section style="width:24px">图标</section></section></section>'
  try {
    await act(async () => root.render(<ArticleImportModal onClose={() => {}} />))
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.startsWith('粘贴富文本'))!.click())
    const paste = host.querySelector('[data-testid="article-paste"]')!
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: (kind: string) => kind === 'text/html' ? markup : '' } })
    await act(async () => paste.dispatchEvent(event))
    const preview = host.querySelector('.article-preview .mini-inner')!
    expect(preview.textContent).toContain('第一栏')
    expect(preview.textContent).toContain('第二栏')
    const outer = preview.querySelector<HTMLElement>('section[style*="display: grid"]')!
    expect(outer.style.width).toBe('100%')
    const [left, right, icon] = Array.from(outer.children) as HTMLElement[]
    expect(left.style.width).toBe('50%')
    expect(left.style.marginLeft).toBe('10px')
    expect(right.style.width).toBe('48.25%')
    expect(icon.style.width).toBe('24px')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})

it.each([
  ['fluid source', '<section style="width:100%"><section style="width:300px">原文</section></section>'],
  ['explicit grid tracks', '<section style="width:600px; display:grid; grid-template-columns:300px 300px"><section style="width:300px">原文</section></section>'],
  ['no evidence of proportional children', '<section style="width:600px"><section style="width:24px">原文</section></section>'],
  ['ambiguous multiple columns', '<section style="width:600px"><section style="width:300px">一</section></section><section style="width:600px"><section style="width:300px">二</section></section>'],
])('does not rewrite %s', (_label, html) => {
  const root = new DOMParser().parseFromString(html, 'text/html').body
  const before = root.innerHTML
  fluidizeArticle(root)
  expect(root.innerHTML).toBe(before)
  expect(root.isConnected).toBe(true)
  expect(root.ownerDocument).not.toBe(document)
})

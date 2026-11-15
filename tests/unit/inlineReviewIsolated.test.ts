// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Doc } from '../../src/core/types'
import type { Proposal } from '../../src/editor/store'
import type { ReviewItem } from '../../src/editor/reviewDisplay'
import { ReviewBlock, ReviewProvider, ReviewSlot } from '../../src/editor/InlineReview'

const h = vi.hoisted(() => ({
  state: {} as { doc: Doc; proposal: Proposal | null; resolveProposal: (...args: unknown[]) => void },
  project: vi.fn(),
  resolve: vi.fn(),
}))
vi.mock('../../src/editor/store', () => ({
  useStore: Object.assign((select: (s: typeof h.state) => unknown) => select(h.state), { getState: () => h.state }),
}))
vi.mock('../../src/core/compiler', () => ({ rootStyle: () => 'color:#222' }))
vi.mock('../../src/editor/reviewDisplay', () => ({ reviewItems: h.project }))

const doc: Doc = { id: 'fixture', title: '当前题目', author: '作者', digest: '摘要', blocks: [], themeId: 'minimal-magazine', createdAt: 1, updatedAt: 1 }
const proposal: Proposal = { base: doc, items: [], errors: [], summary: '合成建议', ignoredOps: 0, selectionPolicy: 'strict' }
const item = (data: Partial<ReviewItem>): ReviewItem => ({
  index: 1, kind: 'update', title: '局部建议', html: '<p>绿色建议文本</p>', replayFrames: [], beforeReplayFrames: [], projected: doc, ...data,
})
let host: HTMLDivElement, root: Root
const fetchGuard = vi.fn(() => { throw Error('Unexpected isolated review IO') })
const projectFixture = vi.fn()
const q = <T extends HTMLElement=HTMLElement>(selector: string) => host.querySelector<T>(selector)!
const card = (index: number) => q(`[data-review-index="${index}"]`)
const click = (node: HTMLElement) => act(() => node.click())
async function mount() {
  await act(async () => root.render(createElement(ReviewProvider, null,
    createElement('section', { onClick: projectFixture, onDoubleClick: projectFixture, onKeyDown: projectFixture },
      createElement(ReviewSlot, { beforeId: 'a' }),
      createElement(ReviewBlock, { id: 'a' }, createElement('textarea', { id: 'editable-a', defaultValue: '正在手动编辑' })),
      createElement(ReviewSlot, { beforeId: 'b' }),
      createElement(ReviewBlock, { id: 'b' }, createElement('span', null, '原始乙')),
      createElement(ReviewSlot),
      createElement('p', { id: 'progress', 'data-testid': 'review-progress', tabIndex: -1 }, '审阅进度')),
  )))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchGuard.mockClear(); vi.stubGlobal('fetch', fetchGuard)
  vi.stubGlobal('ResizeObserver', undefined)
  projectFixture.mockClear()
  h.resolve.mockReset()
  h.project.mockReset().mockReturnValue([])
  h.state = { doc, proposal: null, resolveProposal: h.resolve }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); expect(fetchGuard).not.toHaveBeenCalled(); vi.unstubAllGlobals() })
async function project(items: ReviewItem[]) {
  h.state = { ...h.state, proposal }
  h.project.mockReturnValue(items)
  await mount()
}
it('keeps the same original editor node when a pending suggestion is attached', async () => {
  await mount()
  const original = q<HTMLTextAreaElement>('#editable-a')
  original.value = '保留的输入'
  original.focus()
  expect(h.project).not.toHaveBeenCalled()
  await project([item({ targetId: 'a', attachmentId: 'a' })])
  expect(h.project).toHaveBeenCalledExactlyOnceWith(proposal, doc)
  expect(q('#editable-a')).toBe(original)
  expect(original.value).toBe('保留的输入')
  expect(document.activeElement).toBe(original)
  expect(q('.review-original-red')?.textContent).toContain('原模块 · 待审阅')
  expect(card(1)?.parentElement?.classList.contains('review-block')).toBe(true)
})
it('renders accessible metadata before/after and places article-level and orphan cards at their slots', async () => {
  await project([
    item({ index: 2, kind: 'setMeta', title: '文章信息', beforeId: 'a', beforeMeta: '旧标题', html: '', projected: { ...doc, title: '新标题', author: '', digest: '新摘要' } }),
    item({ index: 3, kind: 'insert', title: '插入', beforeId: 'b' }),
    item({ index: 4, title: '不存在的目标', error: '已过期', html: '' }),
  ])
  expect(card(2).textContent).toContain('标题：新标题')
  expect(card(2).textContent).toContain('作者：')
  expect(card(2).textContent).toContain('摘要：新摘要')
  expect(card(2).previousElementSibling?.textContent).toContain('旧标题')
  expect(card(2).compareDocumentPosition(q('#editable-a')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(card(3).textContent).toContain('新增模块')
  expect(card(3).nextElementSibling?.textContent).toContain('原始乙')
  expect(card(4).nextElementSibling?.id).toBe('progress')
})
it('makes stale suggestions reject-only and stops click, double-click and key bubbling', async () => {
  await project([item({ error: '已过期', targetId: 'a', attachmentId: 'a', html: '', reason: '可供参考' })])
  const stale = card(1)
  expect(stale.classList.contains('review-stale')).toBe(true)
  expect(stale.querySelector('[role="status"]')?.textContent).toContain('请拒绝此建议后重新生成')
  expect(stale.querySelector('.review-reason')?.textContent).toBe('可供参考')
  const accept = q<HTMLButtonElement>('.review-accept')
  expect(accept.disabled).toBe(true)
  click(accept)
  expect(h.resolve).not.toHaveBeenCalled()
  act(() => {
    stale.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    stale.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
  })
  click(q('.review-reject'))
  expect(projectFixture).not.toHaveBeenCalled()
  expect(h.resolve).toHaveBeenCalledExactlyOnceWith(1, 'rejected', proposal)
  expect(document.activeElement?.id).toBe('progress')
})
it('accepts using the captured proposal and moves focus to the first surviving nearby action', async () => {
  await project([
    item({ targetId: 'a', attachmentId: 'a', kind: 'remove', html: '' }),
    item({ index: 2, targetId: 'b', attachmentId: 'b', kind: 'move', position: 2, html: '' }),
  ])
  expect(card(1).textContent).toContain('接受后删除上方整个红色模块')
  expect(card(2).textContent).toContain('移动至第 2 位')
  click(card(1).querySelector<HTMLButtonElement>('.review-accept')!)
  expect(h.resolve).toHaveBeenCalledExactlyOnceWith(1, 'accepted', proposal)
  expect(document.activeElement).toBe(card(2).querySelector('.review-accept'))
})
it('keeps separate before/after theme previews sandboxed and provides standalone readable text', async () => {
  await project([item({ kind: 'setTheme', title: '新主题', beforeId: 'a', beforeHtml: '<p>旧预览</p>', original: doc })])
  const frames = [...host.querySelectorAll('iframe')]
  expect(frames).toHaveLength(2)
  for (const frame of frames) {
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    expect(frame.tabIndex).toBe(-1)
    expect(frame.srcdoc).toContain("script-src 'none'")
    expect(frame.srcdoc).toContain("form-action 'none'")
  }
  expect(frames[0].srcdoc).toContain('<p>旧预览</p>')
  expect(frames[1].srcdoc).toContain('<p>绿色建议文本</p>')
  expect(card(1).querySelector('details summary')?.textContent).toContain('辅助阅读')
  expect(card(1).querySelector('details div')?.textContent).toBe('绿色建议文本')
})
it('bounds static replay scene times, detects unavailable animation support and cleans its observer', async () => {
  const observe = vi.fn(), disconnect = vi.fn()
  await project([item({ replayFrames: [{ token: 'good', times: [2, -1, 86401, NaN, 4] }, { token: 'absent', times: [1] }] })])
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect = disconnect })
  const frame = q<HTMLIFrameElement>('iframe')
  const scene = document.implementation.createHTMLDocument()
  scene.body.innerHTML = '<section data-review-freeze="good"><svg><svg></svg></svg><svg></svg><svg></svg><svg></svg><svg></svg></section>'
  Object.defineProperty(frame, 'contentDocument', { value: scene })
  Object.defineProperty(scene.body, 'scrollHeight', { value: 95 })
  const roots = [...scene.querySelectorAll('svg')].filter(svg => !svg.parentElement?.closest('svg'))
  const pause = vi.fn(), seek = vi.fn()
  Object.defineProperties(roots[0], { pauseAnimations: { value: pause }, setCurrentTime: { value: seek } })
  const skipped = vi.fn()
  for (const root of roots.slice(1,4)) Object.defineProperties(root, { pauseAnimations: { value: skipped }, setCurrentTime: { value: skipped } })
  act(() => frame.dispatchEvent(new Event('load')))
  expect(seek).toHaveBeenCalledExactlyOnceWith(2)
  expect(pause).toHaveBeenCalledTimes(1)
  expect(skipped).not.toHaveBeenCalled()
  expect(host.textContent).toContain('此浏览器不支持静态定格')
  expect(host.textContent).toContain('原模块与导出的播放方式不变')
  expect(frame.style.height).toBe('95px')
  expect(observe).toHaveBeenCalledExactlyOnceWith(scene.body)
  act(() => root.render(null))
  expect(disconnect).toHaveBeenCalledTimes(1)
})

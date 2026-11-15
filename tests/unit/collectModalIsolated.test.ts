// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Block, Doc } from '../../src/core/types'
import type { ComponentDraft } from '../../src/core/components'
import type { CollectRequest } from '../../src/editor/componentActions'
import { CollectHost } from '../../src/editor/CollectModal'

const h = vi.hoisted(() => ({ save: vi.fn(), notify: vi.fn(), preview: vi.fn(), doc: {} as Doc }))
vi.mock('../../src/editor/store', () => ({ useStore: (pick: (s: { doc: Doc; notify: typeof h.notify }) => unknown) => pick({ doc: h.doc, notify: h.notify }) }))
vi.mock('../../src/editor/api', () => ({ api: { saveComponent: h.save } }))
vi.mock('../../src/core/compiler', () => ({ compileBlock: h.preview }))
vi.mock('../../src/editor/componentActions', () => ({ parseDoc: (s: string) => new DOMParser().parseFromString(s, 'text/html') }))
vi.mock('../../src/editor/Modal', () => ({
  Modal: ({ children, title }: { children: ReactNode; title: string }) => createElement('section', { role: 'dialog', 'aria-label': title }, children),
}))
const forbidden = () => { throw Error('Unexpected isolated collection transport') }
const fetchGuard = vi.fn(forbidden)
const heading = createBlock('heading', { title: '合成标题' })
const fragment = '<p>甲类片段</p>'
const other = '<p>乙类片段</p>'
const imported = createBlock('html', {
  label: '整段标记', html: '<div>' + fragment + other + '</div>',
  source: { kind: 'wechat', title: '合成来源', url: 'https://fixture.invalid/article', account: '合成账户' },
})
let root: Root, host: HTMLDivElement
const el = <T extends HTMLElement=HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!
const action = async (node: HTMLElement) => { await act(async () => { node.click() }) }
const open = (block: Block, more: Partial<CollectRequest> = {}) => act(() => window.dispatchEvent(new CustomEvent('open-collect', { detail: { block, via: 'block', ...more } })))
const change = (input: HTMLInputElement | HTMLSelectElement, value: string) => act(() => {
 const select = input instanceof HTMLSelectElement
 Object.getOwnPropertyDescriptor(select ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input,value)
 input.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true }))
})
const draft = (i = 0) => h.save.mock.calls[i][0] as ComponentDraft
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchGuard.mockClear(); vi.stubGlobal('fetch', fetchGuard)
  h.save.mockReset().mockImplementation(forbidden)
  h.notify.mockReset()
  h.preview.mockReset().mockImplementation((block: Block) => block.type === 'html' ? block.props.html : '<p>模块预览</p>')
  h.doc = { id: 'doc', title: '当前文稿', author: '', digest: '', blocks: [], createdAt: 1, updatedAt: 1, themeId: 'minimal-magazine' }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(createElement(CollectHost)))
})
afterEach(() => { act(() => root.unmount()); host.remove(); expect(fetchGuard).not.toHaveBeenCalled(); vi.unstubAllGlobals() })
it('keeps the host empty without a request and opens/closes a dialog from its dedicated event', async () => {
  expect(host.textContent).toBe('')
  open(heading)
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('收藏为组件')
  expect(el('collect-preview').textContent).toBe('模块预览')
  await action(el('collect-close'))
  expect(host.textContent).toBe('')
  expect(h.save).not.toHaveBeenCalled()
})
it('saves original content without consent controls and normalizes role/name/tags', async () => {
  open(heading)
  expect(el('collect-attest')).toBeNull()
  expect(el('split-list')).toBeNull()
  change(el<HTMLInputElement>('collect-name'), '  自制标题  ')
  change(el<HTMLInputElement>('collect-tags'), '甲，乙、甲 团队')
  change(el<HTMLSelectElement>('collect-role'), 'h2')
  h.save.mockResolvedValue({ duplicate: false, component: { name: '自制标题' } })
  const refreshed = vi.fn()
  window.addEventListener('components-changed', refreshed)
  try {
    await action(el('collect-save'))
    expect(draft()).toMatchObject({ name: '自制标题', role: 'h2', tags: ['甲','乙','团队'], block: heading, origin: { kind: 'original', via: 'block', attested: true, redistributable: true, title: '当前文稿' } })
    expect(refreshed).toHaveBeenCalledTimes(1)
  } finally { window.removeEventListener('components-changed', refreshed) }
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('已收藏组件「自制标题」')
  expect(host.textContent).toBe('')
})
it('gates imported content on explicit consent and sends a non-redistributable fragment with source', async () => {
  open(imported, { fragment })
  expect(el<HTMLInputElement>('collect-name').value).toBe('甲类片段')
  expect(el('collect-preview').textContent).toBe('甲类片段')
  expect(el<HTMLButtonElement>('collect-save').disabled).toBe(true)
  await action(el('collect-save'))
  expect(h.save).not.toHaveBeenCalled()
  await action(el('collect-attest'))
  h.save.mockResolvedValue({ duplicate: false, component: { name: '甲类片段' } })
  await action(el('collect-save'))
  expect(draft()).toMatchObject({ name: '甲类片段', block: { type: 'html', props: { html: fragment } }, origin: {
    kind: 'wechat', title: '合成来源', url: 'https://fixture.invalid/article', account: '合成账户', via: 'fragment', attested: true, redistributable: false,
  } })
  expect(el('split-0').textContent).toContain('已收藏')
  expect(el('collect-close').textContent).toBe('完成')
  expect(el('split-1').textContent).not.toContain('已收藏')
})
it('prefills from request source and uses whole-block provenance when changing scope', async () => {
  const content = createBlock('html', { label: '待选择', html: fragment + other })
  open(content, { via: 'template', fragment, source: { kind: 'xiumi', title: '模板来源' } })
  change(el<HTMLSelectElement>('collect-role'), 'quote')
  await action(el('split-1'))
  expect(el<HTMLInputElement>('collect-name').value).toBe('待选择')
  expect(el<HTMLSelectElement>('collect-role').value).toBe('quote')
  expect(el('collect-preview').textContent).toBe('甲类片段乙类片段')
  const link = host.querySelector<HTMLInputElement>('input[placeholder="https://"]')!
  change(link, ' https://fixture.invalid/part ')
  await action(el('collect-attest'))
  h.save.mockResolvedValue({ duplicate: false, component: { name: '待选择' } })
  await action(el('collect-save'))
  expect(draft()).toMatchObject({ block: { type: 'html', props: { html: fragment + other } }, role: 'quote', origin: {
    kind: 'xiumi', title: '模板来源', url: 'https://fixture.invalid/part', via: 'template', redistributable: false,
  } })
})
it('keeps the current dialog after a failed save and reports duplicate disclosure on retry', async () => {
  open(imported, { fragment })
  await action(el('collect-attest'))
  h.save.mockRejectedValueOnce(Error('合成写入拒绝')).mockResolvedValueOnce({ duplicate: true, component: { name: '已有组件' } })
  await action(el('collect-save'))
  expect(h.notify).toHaveBeenLastCalledWith('合成写入拒绝', 'error')
  expect(el('split-0').textContent).not.toContain('已收藏')
  expect(el<HTMLButtonElement>('collect-save').disabled).toBe(false)
  await action(el('collect-save'))
  expect(h.notify).toHaveBeenLastCalledWith('已有结构相同的组件「已有组件」，没有重复收藏')
  expect(el('split-0').textContent).toContain('已收藏')
})

it('does not carry consent or draft metadata to a different same-length fragment', async () => {
  expect(fragment.length).toBe(other.length)
  open(imported, { fragment })
  change(el<HTMLInputElement>('collect-name'), '前一个片段的名称')
  await action(el('collect-attest'))
  expect(el<HTMLButtonElement>('collect-save').disabled).toBe(false)
  open(imported, { fragment: other })
  expect(el('collect-preview').textContent).toBe('乙类片段')
  expect(el<HTMLInputElement>('collect-name').value).toBe('乙类片段')
  expect(el<HTMLInputElement>('collect-attest').checked).toBe(false)
  expect(el<HTMLButtonElement>('collect-save').disabled).toBe(true)
  await action(el('collect-save'))
  expect(h.save).not.toHaveBeenCalled()
})
it('requires fresh consent after reopening changed whole-block content with the same id', async () => {
  const first = createBlock('html', { label: '原始内容', html: fragment })
  open(first)
  await action(el('collect-attest'))
  expect(el<HTMLInputElement>('collect-attest').checked).toBe(true)
  const changed = { ...first, props: { ...first.props, label: '更新内容', html: other } }
  open(changed)
  expect(el<HTMLInputElement>('collect-name').value).toBe('更新内容')
  expect(el<HTMLInputElement>('collect-attest').checked).toBe(false)
  expect(el<HTMLButtonElement>('collect-save').disabled).toBe(true)
})
it('keeps a newer dialog open when an already dispatched old save completes', async () => {
  const newer = createBlock('html', { label: '新收藏内容', html: other })
  let settle!: (receipt: { duplicate: boolean; component: { name: string } }) => void
  h.save.mockReturnValueOnce(new Promise(resolve => { settle = resolve }))
  const refresh = vi.fn()
  window.addEventListener('components-changed', refresh)
  try {
    open(heading)
    await action(el('collect-save'))
    expect(h.save).toHaveBeenCalledTimes(1)
    open(newer)
    expect(el<HTMLInputElement>('collect-name').value).toBe('新收藏内容')
    await act(async () => { settle({ duplicate: false, component: { name: '旧请求已收藏' } }) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(el('collect-preview')?.textContent).toBe('乙类片段')
    expect(el<HTMLInputElement>('collect-attest').checked).toBe(false)
  } finally { window.removeEventListener('components-changed', refresh) }
})
it('starts a fresh consent decision even if a new request repeats the same fragment', async () => {
  open(imported, { fragment })
  await action(el('collect-attest'))
  open(imported, { fragment })
  expect(el<HTMLInputElement>('collect-attest').checked).toBe(false)
  expect(el<HTMLButtonElement>('collect-save').disabled).toBe(true)
})
it('ignores an obsolete save error while the new active dialog can fail and retry', async () => {
  let rejectOld!: (error: Error) => void
  h.save.mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject }))
    .mockRejectedValueOnce(Error('新请求暂时失败'))
    .mockResolvedValueOnce({ duplicate: false, component: { name: '乙类片段' } })
  open(heading)
  await action(el('collect-save'))
  open(imported, { fragment: other })
  await act(async () => { rejectOld(Error('旧请求错误')) })
  expect(h.notify).not.toHaveBeenCalled()
  expect(el<HTMLInputElement>('collect-attest').checked).toBe(false)
  await action(el('collect-attest'))
  await action(el('collect-save'))
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('新请求暂时失败', 'error')
  expect(el('split-0').textContent).not.toContain('已收藏')
  await action(el('collect-save'))
  expect(h.save).toHaveBeenCalledTimes(3)
  expect(h.notify).toHaveBeenLastCalledWith('已收藏组件「乙类片段」')
})
it('publishes a successful save to the library even after the dialog was dismissed', async () => {
  let settle!: (value: { duplicate: boolean; component: { name: string } }) => void
  h.save.mockReturnValueOnce(new Promise(resolve => { settle = resolve }))
  const refresh = vi.fn()
  window.addEventListener('components-changed', refresh)
  try {
    open(heading)
    await action(el('collect-save'))
    await action(el('collect-close'))
    await act(async () => { settle({ duplicate: false, component: { name: '已收藏' } }) })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(h.notify).not.toHaveBeenCalled()
  } finally { window.removeEventListener('components-changed', refresh) }
})

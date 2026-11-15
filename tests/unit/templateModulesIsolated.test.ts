// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Block, Doc } from '../../src/core/types'
import type { Template } from '../../src/editor/api'
import { templateRoles, TemplateModules, themeOf } from '../../src/editor/TemplateModules'

const h = vi.hoisted(() => ({ save: vi.fn(), notify: vi.fn(), close: vi.fn(), saved: vi.fn() }))
vi.mock('../../src/editor/store', () => ({ useStore: (select: (state: { notify: typeof h.notify }) => unknown) => select({ notify: h.notify }) }))
vi.mock('../../src/editor/api', () => ({ api: { updateTemplate: h.save } }))
vi.mock('../../src/editor/ComponentLibrary', () => ({
  LazyPreview: ({ block, doc }: { block: Block; doc: Pick<Doc,'themeId' | 'themeOverrides'> }) =>
    createElement('span', { 'data-preview': block.id, 'data-theme': doc.themeId, 'data-font': doc.themeOverrides?.fontSize }),
}))
vi.mock('../../src/editor/Modal', () => ({
  Modal: ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) =>
    createElement('section', { role: 'dialog', 'aria-label': title }, children, createElement('button', { onClick: onClose }, '关闭')),
}))

const title = { ...createBlock('html', { label: '原文标题', html: '<h2>原文标题</h2>' }), id: 'title' }
const body = { ...createBlock('paragraph'), id: 'body' }
const template = (roles?: Template['roles']): Template => ({ id: 'source', name: '原文模板', blocks: [title, body], roles, createdAt: 0 })
let root: Root
let host: HTMLDivElement
const changes = vi.fn((_event: Event) => undefined)
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Unexpected network') }))
  for (const m of Object.values(h)) m.mockReset()
  h.save.mockImplementation(() => { throw Error('Unexpected template save') })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  changes.mockClear()
  window.addEventListener('templates-changed', changes)
})
afterEach(() => {
  window.removeEventListener('templates-changed', changes)
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals()
})
const mount = (t: Template, onSaved: ((next: Template) => void) | null = h.saved) => act(() => root.render(createElement(TemplateModules, { template: t, onClose: h.close, onSaved: onSaved ?? undefined })))
const query = <T extends HTMLElement>(selector: string) => {
  const found = host.querySelector<T>(selector)
  if (!found) throw Error('Missing ' + selector)
  return found
}
const saveButton = () => query<HTMLButtonElement>('[data-testid="save-module-roles"]')
const select = (i: number) => query<HTMLSelectElement>('[data-testid="module-role-' + i + '"]')
const choose = (i: number, role: string) => act(() => {
  const node = select(i)
  node.value = role
  node.dispatchEvent(new Event('change', { bubbles: true }))
})
const click = (button: HTMLButtonElement) => act(() => button.click())

it('keeps explicit roles distinct from actual fixture inference and respects supplied or default theme', () => {
  const shown = template({ title: 'h3' })
  expect(themeOf(shown)).toEqual({ themeId: 'minimal-magazine', themeOverrides: undefined })
  expect(templateRoles(shown)).toEqual({ roles: ['h3','body'], confirmed: [true,false] })
  mount({ ...shown, themeId: 'thu-eea-de', themeOverrides: { fontSize: 18 } })
  expect(select(0).value).toBe('h3')
  expect(select(1).value).toBe('body')
  expect(query('[data-preview="title"]').dataset).toMatchObject({ theme: 'thu-eea-de', font: '18' })
  expect(host.textContent).toContain('原文标题')
  expect(host.querySelectorAll('small')).toHaveLength(2)
  expect([...host.querySelectorAll('small')].map(x => x.textContent?.includes('自动识别'))).toEqual([false,true])
  expect(saveButton().disabled).toBe(false)
})

it('detects duplicate active roles and reconciles when the choice is edited or reset', () => {
  mount(template({ title: 'h2', body: 'body' }))
  expect(saveButton().disabled).toBe(true)
  choose(1,'h2')
  expect(host.querySelectorAll('.tm-info em')).toHaveLength(2)
  expect(query('.tm-info em').textContent).toContain('同名 2 个')
  expect(saveButton().disabled).toBe(false)
  choose(0,'other')
  choose(1,'other')
  expect(host.querySelector('.tm-info em')).toBeNull()
  choose(0,'h2')
  choose(1,'body')
  expect(saveButton().disabled).toBe(true)
  click(saveButton())
  expect(h.save).not.toHaveBeenCalled()
})

it('passes roles by immutable module ID, commits feedback only after success, and blocks clicks while pending', async () => {
  const original = template({ title: 'h1' })
  mount(original)
  choose(0, 'h2')
  choose(1, 'other')
  const returned = { ...original, roles: { title: 'h2', body: 'other' } } satisfies Template
  let finish!: (value: Template) => void
  h.save.mockImplementationOnce(() => new Promise<Template>(resolve => { finish = resolve }))
  click(saveButton())
  expect(saveButton().disabled).toBe(true)
  click(saveButton())
  expect(h.save).toHaveBeenCalledExactlyOnceWith('source', { roles: { title: 'h2', body: 'other' } })
  expect(changes).not.toHaveBeenCalled()
  expect(h.saved).not.toHaveBeenCalled()
  expect(h.close).not.toHaveBeenCalled()
  await act(async () => finish(returned))
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('已保存模块的标准名称')
  expect(h.saved).toHaveBeenCalledExactlyOnceWith(returned)
  expect(h.close).toHaveBeenCalledOnce()
  expect(changes).toHaveBeenCalledOnce()
  expect(original.roles).toEqual({ title: 'h1' })
  expect(changes.mock.invocationCallOrder[0]).toBeLessThan(h.close.mock.invocationCallOrder[0])
})

it('reports request failure without events or closing, keeps the draft, and retries explicitly', async () => {
  const original = template()
  mount(original, null)
  choose(0, 'other')
  h.save.mockRejectedValueOnce(Error('请求未完成')).mockResolvedValueOnce(original)
  await act(async () => saveButton().click())
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('请求未完成','error')
  expect(changes).not.toHaveBeenCalled()
  expect(h.close).not.toHaveBeenCalled()
  expect(select(0).value).toBe('other')
  expect(saveButton().disabled).toBe(false)
  await act(async () => saveButton().click())
  expect(h.save).toHaveBeenCalledTimes(2)
  expect(h.save.mock.calls[0]).toEqual(h.save.mock.calls[1])
  expect(changes).toHaveBeenCalledOnce()
  expect(h.close).toHaveBeenCalledOnce()
})

it('cancels draft role changes without persistence, then derives defaults again on remount', () => {
  const t = template({ title: 'h2', body: 'body' })
  mount(t)
  choose(0,'ending')
  const cancel = [...host.querySelectorAll('button')].find(x => x.textContent === '取消')
  if (!cancel) throw Error('Missing cancel')
  click(cancel)
  expect(h.close).toHaveBeenCalledOnce()
  expect(h.save).not.toHaveBeenCalled()
  expect(changes).not.toHaveBeenCalled()
  act(() => root.render(null))
  mount(t)
  expect(select(0).value).toBe('h2')
  expect(saveButton().disabled).toBe(true)
})

it('publishes a completed save after dismissal without closing the next template being edited', async () => {
  const initial = template()
  const next = { ...template({ title: 'h2', body: 'body' }), id: 'other', name: '另一份模板' }
  function Host() {
    const [viewing, setViewing] = useState<Template | null>(initial)
    return createElement('div', null, createElement('button', { id: 'next', onClick: () => setViewing(next) }, '打开另一份模板'),
      viewing && createElement(TemplateModules, { template: viewing, onClose: () => setViewing(null) }))
  }
  let finish!: (value: Template) => void
  h.save.mockImplementationOnce(() => new Promise<Template>(resolve => { finish = resolve }))
  act(() => root.render(createElement(Host)))
  click(saveButton())
  const cancel = [...host.querySelectorAll('button')].find(x => x.textContent === '取消')
  if (!cancel) throw Error('Missing cancel')
  click(cancel)
  expect(host.querySelector('[role=dialog]')).toBeNull()
  click(query<HTMLButtonElement>('#next'))
  choose(0,'h3')
  expect(query('[role=dialog]').getAttribute('aria-label')).toBe('模板模块 · 另一份模板')
  await act(async () => finish(initial))
  expect(changes).toHaveBeenCalledOnce()
  expect(host.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('模板模块 · 另一份模板')
  expect(select(0).value).toBe('h3')
})

it('reinitializes a replaced template under Strict Mode and ignores an old failure without disabling a new retry', async () => {
  const previous = template()
  const next = { ...template({ title: 'h3', body: 'body' }), id: 'another', name: '后一个模板' }
  let fail!: (error: Error) => void
  h.save.mockImplementationOnce(() => new Promise<Template>((_, reject) => { fail = reject }))
    .mockRejectedValueOnce(Error('本次失败'))
    .mockResolvedValueOnce(next)
  const show = (value: Template) => act(() => root.render(createElement(StrictMode, null,
    createElement(TemplateModules, { template: value, onClose: h.close, onSaved: h.saved }))))
  show(previous)
  choose(0,'ending')
  click(saveButton())
  expect(saveButton().disabled).toBe(true)
  show(next)
  expect(select(0).value).toBe('h3')
  choose(0,'other')
  expect(saveButton().disabled).toBe(false)
  await act(async () => fail(Error('过期失败')))
  expect(h.notify).not.toHaveBeenCalled()
  expect(h.saved).not.toHaveBeenCalled()
  expect(h.close).not.toHaveBeenCalled()
  expect(changes).not.toHaveBeenCalled()
  expect(select(0).value).toBe('other')
  await act(async () => saveButton().click())
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('本次失败','error')
  expect(saveButton().disabled).toBe(false)
  await act(async () => saveButton().click())
  expect(h.save.mock.calls.slice(1)).toEqual([
    ['another', { roles: { title: 'other', body: 'body' } }],
    ['another', { roles: { title: 'other', body: 'body' } }],
  ])
  expect(h.saved).toHaveBeenCalledExactlyOnceWith(next)
  expect(h.close).toHaveBeenCalledOnce()
  expect(changes).toHaveBeenCalledOnce()
})

it('preserves the in-progress role choice when metadata for the same template ID refreshes', () => {
  const initial = template({ title: 'h2', body: 'body' })
  mount(initial)
  choose(0,'h3')
  mount({ ...initial, name: '名字刷新', roles: { title: 'h1', body: 'body' } })
  expect(query('[role=dialog]').getAttribute('aria-label')).toBe('模板模块 · 名字刷新')
  expect(select(0).value).toBe('h3')
  expect(saveButton().disabled).toBe(false)
  expect(h.save).not.toHaveBeenCalled()
})

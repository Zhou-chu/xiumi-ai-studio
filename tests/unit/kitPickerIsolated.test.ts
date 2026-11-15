// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { LibraryComponent } from '../../src/core/components'
import type { Block, Doc } from '../../src/core/types'
import type { Template } from '../../src/editor/api'
import { KitPicker, kitCandidates, layoutOptions, resolveKit, useComponents, type KitChoice } from '../../src/editor/KitPicker'

const h = vi.hoisted(() => ({ notify: vi.fn(), components: vi.fn(), picked: vi.fn(), pickedComps: vi.fn(), choice: vi.fn() }))
vi.mock('../../src/editor/store', () => ({
  useStore: (select: (state: { notify: typeof h.notify }) => unknown) => select({ notify: h.notify }),
}))
vi.mock('../../src/editor/api', () => ({ api: { components: h.components } }))
vi.mock('../../src/editor/ComponentLibrary', () => ({
  LazyPreview: ({ block, doc }: { block: Block; doc: Pick<Doc,'themeId' | 'themeOverrides'> }) =>
    createElement('span', { 'data-preview': block.id, 'data-theme': doc.themeId, 'data-font': doc.themeOverrides?.fontSize }),
}))
vi.mock('../../src/editor/TemplateModules', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/editor/TemplateModules')>(),
  TemplateModules: ({ template, onClose }: { template: Template; onClose: () => void }) =>
    createElement('button', { 'data-template-dialog': template.id, onClick: onClose }, '关闭模块预览'),
}))
vi.mock('../../src/editor/Modal', () => ({
  Modal: ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) =>
    createElement('section', { role: 'dialog', 'aria-label': title }, children, createElement('button', { onClick: onClose }, '关闭')),
}))

const headerA = { ...createBlock('heading', { title: '模板标题甲' }), id: 'ha' }
const headerB = { ...createBlock('html', { label: '原文标题乙', html: '<h2>原文标题乙</h2>' }), id: 'hb' }
const photo = { ...createBlock('image', { caption: '图片' }), id: 'photo' }
const ignored = { ...createBlock('heading', { title: '明确忽略' }), id: 'ignored' }
const alpha: Template = { id: 'alpha', name: '模板甲', blocks: [headerA, photo, ignored], roles: { ha: 'h1', photo: 'img1', ignored: 'other' }, createdAt: 0 }
const beta: Template = { id: 'beta', name: '模板乙', blocks: [headerB], roles: { hb: 'h1' }, themeId: 'thu-eea-de', themeOverrides: { fontSize: 18 }, createdAt: 0 }
function component(id: string, name: string, block: Block, role?: LibraryComponent['role']): LibraryComponent {
  return {
    id, schema: 1, rev: 0, name, block, role, kind: 'heading', tags: [], fingerprint: id, palette: [],
    fixedDecor: 0, stats: { texts: 0, photos: 0, bgPhotos: 0, chars: 0 }, text: '', origin: { via: 'block', kind: 'original', title: '', url: '', account: '', attested: true, attestedAt: 0, redistributable: true }, createdAt: 0, updatedAt: 0,
  }
}
const first = component('first', '课程版', headerA, 'h1')
const second = component('second', '一级标题节庆版', headerB)
const pic = component('pic', '校园照片', photo, 'img1')
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Unexpected external request') }))
  for (const mock of Object.values(h)) mock.mockReset()
  h.components.mockImplementation(() => { throw Error('Unexpected component read') })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

interface Options { templates?: Template[]; comps?: LibraryComponent[]; picked?: string[]; pickedComps?: string[]; choice?: KitChoice }
function Controlled(options: Options) {
  const [picked, setPicked] = useState(options.picked ?? [])
  const [pickedComps, setPickedComps] = useState(options.pickedComps ?? [])
  const [choice, setChoice] = useState(options.choice ?? {})
  return createElement(KitPicker, {
    templates: options.templates ?? [alpha,beta], comps: options.comps ?? [first, second, pic], picked, pickedComps, choice,
    setPicked: x => { h.picked(x); setPicked(x) },
    setPickedComps: x => { h.pickedComps(x); setPickedComps(x) },
    setChoice: x => { h.choice(x); setChoice(x) },
  })
}
const mount = (options: Options = {}) => act(() => root.render(createElement(Controlled, options)))
const q = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const node = host.querySelector<T>(selector)
  if (!node) throw Error('Missing ' + selector)
  return node
}
const withText = (selector: string, text: string) => {
  const node = [...host.querySelectorAll<HTMLElement>(selector)].find(x => x.textContent?.includes(text))
  if (!node) throw Error('Missing ' + text)
  return node
}
const click = (node: HTMLElement) => act(() => node.click())
const test = <T extends HTMLElement = HTMLElement>(id: string) => q<T>('[data-testid="' + id + '"]')
const choose = (id: string, value: string) => act(() => {
  const node = test<HTMLSelectElement>('kit-choice-' + id)
  node.value = value
  node.dispatchEvent(new Event('change', { bubbles: true }))
})
const search = (value: string) => act(() => {
  const node = q<HTMLInputElement>('input[placeholder^="搜索"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(node,value)
  node.dispatchEvent(new Event('input', { bubbles: true }))
})

it('normalizes picked templates, retains provided roles/themes and ignores missing or excluded template entries', () => {
  const candidates = kitCandidates([alpha,beta], ['deleted','beta','alpha'], [first,second], ['missing','second'])
  expect(candidates.map(c => [c.key,c.role,c.label])).toEqual([
    ['t:beta:hb','h1','#1 原文标题乙'], ['t:alpha:ha','h1','#1 章节标题'], ['t:alpha:photo','img1','#2 单图'], ['c:second','h1',second.name],
  ])
  expect(candidates[0].theme).toEqual({ themeId: 'thu-eea-de', themeOverrides: { fontSize: 18 } })
  expect(candidates[1].theme.themeId).toBe('minimal-magazine')
  expect(candidates[3].theme).toEqual({ themeId: 'minimal-magazine' })
  expect(candidates[1].block).not.toBe(alpha.blocks[0])
  expect(resolveKit(candidates, {}).h1?.block).toBe(second.block)
  expect(resolveKit(candidates, { h1: 'stale-key' }).h1?.block).toBe(second.block)
  expect(resolveKit(candidates, { h1: 't:alpha:ha' }).h1?.from).toBe('模板甲')
  expect(resolveKit(candidates, { h1: 'none' })).not.toHaveProperty('h1')
})

it('offers dedicated picture layouts in role order, not text-plus-image modules', () => {
  const cands = kitCandidates([alpha], ['alpha'], [component('mixed', '图文分栏', photo, 'imageText'), component('grid', '四图', photo, 'img4')], ['grid','mixed'])
  expect(layoutOptions(resolveKit(cands, {}))).toEqual(['img1','img4'])
  expect(layoutOptions(resolveKit(cands, { img1: 'none', img4: 'none' }))).toEqual([])
})

it('keeps template-module preview separate from template selection, and closes without changing the kit', () => {
  mount()
  expect(host.querySelector('[data-testid="kit-table"]')).toBeNull()
  click(test('view-modules'))
  expect(q('[data-template-dialog]').dataset.templateDialog).toBe('alpha')
  expect(h.picked).not.toHaveBeenCalled()
  click(q('[data-template-dialog]'))
  expect(host.querySelector('[data-template-dialog]')).toBeNull()
  click(withText('[data-testid="pick-template"]','模板乙'))
  click(withText('[data-testid="pick-template"]','模板甲'))
  expect(h.picked.mock.calls).toEqual([[['beta']], [['beta','alpha']]])
  expect(test<HTMLSelectElement>('kit-choice-h1').value).toBe('t:beta:hb')
  expect(host.textContent).toContain('图片版式：单图')
  expect(host.textContent).toContain('同名 2 个')
  click(withText('[data-testid="pick-template"]','模板乙'))
  expect(test<HTMLSelectElement>('kit-choice-h1').value).toBe('t:alpha:ha')
})

it('switches candidates and hides deselected roles without disturbing another role choice', () => {
  mount({ picked: ['alpha','beta'], pickedComps: ['first'], choice: { img1: 't:alpha:photo' } })
  const select = test<HTMLSelectElement>('kit-choice-h1')
  expect(select.value).toBe('c:first')
  click(withText('th button','一级标题'))
  expect(q('[data-preview="ha"]').dataset.theme).toBe('minimal-magazine')
  choose('h1','t:beta:hb')
  const switched = q('[data-preview="hb"]')
  expect(switched.dataset.theme).toBe('thu-eea-de')
  expect(switched.dataset.font).toBe('18')
  expect(h.choice).toHaveBeenLastCalledWith({ h1: 't:beta:hb', img1: 't:alpha:photo' })
  choose('h1','none')
  expect(select.closest('tr')?.classList.contains('off')).toBe(true)
  expect(host.querySelector('[data-preview="hb"]')).toBeNull()
  choose('h1','t:alpha:ha')
  expect(q('[data-preview="ha"]')).toBeTruthy()
  click(withText('th button','一级标题'))
  expect(host.querySelector('[data-preview]')).toBeNull()
})

it('stages role replacements in the component dialog and commits only on Done', () => {
  mount({ picked: ['alpha'], pickedComps: ['first', 'missing'] })
  expect(host.textContent).not.toContain('undefined')
  click(test('pick-components'))
  click(withText('[data-testid="kit-component"]','一级标题节庆版'))
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('「一级标题」只能用一个组件，已换成「一级标题节庆版」')
  expect(withText('[data-testid="kit-component"]','一级标题节庆版').classList.contains('on')).toBe(true)
  expect(withText('[data-testid="kit-component"]','课程版').classList.contains('on')).toBe(false)
  expect(h.pickedComps).not.toHaveBeenCalled()
  click(withText('.modal-actions button','取消'))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(test<HTMLSelectElement>('kit-choice-h1').value).toBe('c:first')
  click(test('pick-components'))
  click(withText('[data-testid="kit-component"]','一级标题节庆版'))
  click(test('kit-components-done'))
  expect(h.pickedComps).toHaveBeenLastCalledWith(['missing','second'])
  expect(test<HTMLSelectElement>('kit-choice-h1').value).toBe('c:second')
  click(q('.kit-comps .chip button'))
  expect(h.pickedComps).toHaveBeenLastCalledWith(['missing'])
  expect(test<HTMLSelectElement>('kit-choice-h1').value).toBe('t:alpha:ha')
})

it('searches text and role groups, and preserves explicitly deselected components', () => {
  mount({ pickedComps: ['pic'] })
  click(test('pick-components'))
  click(withText('[role="dialog"] .seg button','图片'))
  expect(host.querySelectorAll('[data-testid="kit-component"]')).toHaveLength(1)
  expect(test('kit-component').textContent).toContain('校园照片')
  search('查无此项')
  expect(host.textContent).toContain('没有符合条件的组件')
  search('校园')
  click(test('kit-component'))
  expect(test('kit-component').classList.contains('on')).toBe(false)
  click(test('kit-components-done'))
  expect(h.pickedComps).toHaveBeenCalledExactlyOnceWith([])
  expect(host.querySelector('[data-testid="kit-table"]')).toBeNull()
})

it('offers separate empty states when no imported templates or saved components exist', () => {
  mount({ templates: [], comps: [] })
  expect(host.textContent).toContain('导入公众号推文时勾选「保存为模板」')
  click(test('pick-components'))
  expect(host.textContent).toContain('还没有收藏组件')
  click(withText('[role="dialog"] button','关闭'))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(h.pickedComps).not.toHaveBeenCalled()
})

const List = () => createElement('output', null, useComponents().map(c => c.name).join('|'))
it('loads component data, retains the last success during a failed refresh, and stops listening on unmount', async () => {
  h.components.mockResolvedValueOnce([first]).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce([second,pic])
  await act(async () => root.render(createElement(List)))
  expect(host.textContent).toBe('课程版')
  await act(async () => window.dispatchEvent(new Event('components-changed')))
  expect(host.textContent).toBe('课程版')
  await act(async () => window.dispatchEvent(new Event('components-changed')))
  expect(host.textContent).toBe('一级标题节庆版|校园照片')
  act(() => root.render(null))
  await act(async () => window.dispatchEvent(new Event('components-changed')))
  expect(h.components).toHaveBeenCalledTimes(3)
})

it('does not overwrite a newer component refresh when an older request completes last', async () => {
  let finishOld!: (value: LibraryComponent[]) => void
  let finishNew!: (value: LibraryComponent[]) => void
  h.components.mockImplementationOnce(() => new Promise<LibraryComponent[]>(resolve => { finishOld = resolve }))
    .mockImplementationOnce(() => new Promise<LibraryComponent[]>(resolve => { finishNew = resolve }))
  await act(async () => root.render(createElement(List)))
  await act(async () => window.dispatchEvent(new Event('components-changed')))
  await act(async () => finishNew([second,pic]))
  expect(host.textContent).toBe('一级标题节庆版|校园照片')
  await act(async () => finishOld([first]))
  expect(host.textContent).toBe('一级标题节庆版|校园照片')
  expect(h.components).toHaveBeenCalledTimes(2)
})

it('accepts an earlier still-pending success if the later request failed', async () => {
  let finishOld!: (value: LibraryComponent[]) => void
  h.components.mockImplementationOnce(() => new Promise<LibraryComponent[]>(resolve => { finishOld = resolve }))
    .mockRejectedValueOnce(Error('refresh unavailable'))
  await act(async () => root.render(createElement(List)))
  await act(async () => window.dispatchEvent(new Event('components-changed')))
  expect(host.textContent).toBe('')
  await act(async () => finishOld([first]))
  expect(host.textContent).toBe('课程版')
  expect(h.components).toHaveBeenCalledTimes(2)
})

it('does not deliver a late unmounted request into a newly mounted component list', async () => {
  let finishOld!: (value: LibraryComponent[]) => void
  h.components.mockImplementationOnce(() => new Promise<LibraryComponent[]>(resolve => { finishOld = resolve }))
    .mockResolvedValueOnce([second])
  await act(async () => root.render(createElement(List, { key: 'before' })))
  await act(async () => root.render(createElement(List, { key: 'after' })))
  expect(host.textContent).toBe('一级标题节庆版')
  await act(async () => finishOld([first]))
  expect(host.textContent).toBe('一级标题节庆版')
  expect(h.components).toHaveBeenCalledTimes(2)
})

it('ignores a late request from the first effect setup in a Strict Mode replay on the same state', async () => {
  let finishOld!: (value: LibraryComponent[]) => void
  let finishNew!: (value: LibraryComponent[]) => void
  h.components.mockImplementationOnce(() => new Promise<LibraryComponent[]>(resolve => { finishOld = resolve }))
    .mockImplementationOnce(() => new Promise<LibraryComponent[]>(resolve => { finishNew = resolve }))
  await act(async () => root.render(createElement(StrictMode, null, createElement(List))))
  expect(h.components).toHaveBeenCalledTimes(2)
  await act(async () => finishNew([second, pic]))
  expect(host.textContent).toBe('一级标题节庆版|校园照片')
  await act(async () => finishOld([first]))
  expect(host.textContent).toBe('一级标题节庆版|校园照片')
})

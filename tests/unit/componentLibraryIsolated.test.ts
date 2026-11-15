// @vitest-environment jsdom
import { act, createElement, StrictMode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { textToRich } from '../../src/core/richtext'
import { fingerprint, type LibraryComponent } from '../../src/core/components'
import type { Part } from '../../src/core/templateFill'
import type { Template } from '../../src/editor/api'
import type { RoleId } from '../../src/core/roles'
import { ComponentLibrary, LazyPreview } from '../../src/editor/ComponentLibrary'

const h = vi.hoisted(() => ({
  read: vi.fn(), update: vi.fn(), remove: vi.fn(), insert: vi.fn(), collect: vi.fn(), notify: vi.fn(),
  compile: vi.fn(), catalog: vi.fn(), draggable: vi.fn(),
  state: {} as { doc: { themeId: string; blocks: never[] }; notify: typeof console.log; matchColors: boolean; setMatchColors: (next: boolean) => void },
}))
vi.mock('../../src/editor/api', () => ({ api: { components: h.read, updateComponent: h.update, deleteComponent: h.remove } }))
vi.mock('../../src/editor/store', () => ({ useStore: (select: (s: typeof h.state) => unknown) => select(h.state) }))
vi.mock('../../src/editor/componentActions', () => ({
  componentRole: (component: LibraryComponent) => component.role || 'body',
  parseDoc: (html: string) => new DOMParser().parseFromString(html, 'text/html'),
  insertComponent: h.insert, openCollect: h.collect,
}))
vi.mock('../../src/core/compiler', () => ({ compileBlock: h.compile }))
vi.mock('../../src/core/templateFill', () => ({ buildCatalog: h.catalog }))
vi.mock('@dnd-kit/core', () => ({
  useDraggable: (options: unknown) => {
    h.draggable(options)
    return { attributes: { 'data-drag-fixture': 'true' }, listeners: {}, setNodeRef: () => {} }
  },
}))

const body = createBlock('paragraph', { content: textToRich('Blue body') })
const heading = createBlock('heading', { title: 'Red heading' })
const doc = { themeId: 'minimal-magazine', blocks: [] as never[] }
function fixture(id: string, props: Partial<LibraryComponent>): LibraryComponent {
  return {
    id, schema: 1, rev: 1, name: id, kind: 'body', tags: [], block: body, palette: [],
    fingerprint: fingerprint(body), fixedDecor: 0, stats: { texts: 1, photos: 0, bgPhotos: 0, chars: 9 }, text: '',
    origin: { kind: 'original', title: '', url: '', account: '', via: 'block', attested: true, attestedAt: 1, redistributable: true }, createdAt: 1, updatedAt: 1,
    ...props,
  }
}
const red = fixture('red', { name: '红色标题', role: 'h1', kind: 'heading', block: heading, fingerprint: fingerprint(heading), palette: ['#ff0000'], tags: ['opening'], fixedDecor: 2, stats: { texts: 2, photos: 1, bgPhotos: 2, chars: 11 }, missing: ['fixture.jpg'] })
const blue = fixture('blue', { name: '蓝色正文', palette: ['#0055e0'], text: 'BLUE details' })
const templates = [{ id: 't1', name: '合成模板' }] as Template[]
let host: HTMLDivElement, root: Root
const forbidden = () => { throw Error('Unexpected isolated component library boundary call') }
const fetchGuard = vi.fn(forbidden)
const confirm = vi.fn((_message: string) => false)
const el = <T extends HTMLElement=HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!
const cardNames = (id = 'component-card') => [...host.querySelectorAll(`[data-testid="${id}"] .comp-info b`)].map((e) => e.textContent)
const click = async (id: string) => { await act(async () => { el(id).click() }) }
const event = async (name: string) => { await act(async () => { window.dispatchEvent(new Event(name)) }) }
function change(id: string, value: string) {
  const node = el<HTMLInputElement | HTMLSelectElement>(id)
  const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value)
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function mount(components: LibraryComponent[] = [], inputTemplates: Template[] = [], strict = false) {
  h.read.mockResolvedValue(components)
  function Fixture() {
    const [matchColors, setMatchColors] = useState(false)
    h.state = { doc, notify: h.notify, matchColors, setMatchColors }
    return createElement(ComponentLibrary, { templates: inputTemplates })
  }
  await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(Fixture)) : createElement(Fixture)))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetchGuard)
  vi.stubGlobal('confirm', confirm)
  vi.stubGlobal('IntersectionObserver', undefined)
  fetchGuard.mockClear()
  confirm.mockReset().mockReturnValue(false)
  h.read.mockReset().mockImplementation(forbidden)
  h.update.mockReset().mockImplementation(forbidden)
  h.remove.mockReset().mockImplementation(forbidden)
  h.catalog.mockReset().mockImplementation(forbidden)
  for (const mock of [h.insert, h.collect, h.notify, h.draggable]) mock.mockClear()
  h.compile.mockReset().mockReturnValue('<p>合成预览</p>')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  expect(fetchGuard).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
it('distinguishes an empty saved library from no matching saved results', async () => {
  await mount()
  expect(el('components-saved').textContent).toContain('0')
  expect(host.textContent).toContain('还没有收藏组件')
  h.read.mockResolvedValue([red, blue])
  await event('components-changed')
  expect(el('components-saved').textContent).toContain('2')
  expect(cardNames()).toEqual(['红色标题', '蓝色正文'])
  change('component-search', 'missing needle')
  expect(cardNames()).toEqual([])
  expect(host.textContent).toContain('没有符合条件的组件')
})
it('combines search, kind, hue and role filtering; the same kind/hue toggles off', async () => {
  await mount([red, blue])
  change('component-search', 'OPENING 红色')
  expect(cardNames()).toEqual(['红色标题'])
  await click('kind-body')
  expect(cardNames()).toEqual([])
  await click('kind-body')
  change('component-search', '')
  await click('hue-red')
  expect(cardNames()).toEqual(['红色标题'])
  change('component-role-filter', 'body')
  expect(cardNames()).toEqual([])
  await click('hue-red')
  expect(cardNames()).toEqual(['蓝色正文'])
  expect(el('component-role-filter').textContent).toContain('一级标题（1）')
})
it('shows missing assets and fixed decorations, and supplies the same block to insertion and drag boundaries', async () => {
  await mount([red])
  expect(el('component-missing').textContent).toBe('缺 1 张图片')
  expect(host.textContent).toContain('2 处图片装饰，不能改色')
  expect(host.textContent).toContain('3 张图')
  await click('component-insert')
  expect(h.insert).toHaveBeenCalledExactlyOnceWith(heading, { missing: ['fixture.jpg'] })
  expect(h.draggable).toHaveBeenLastCalledWith({ id: 'comp:red', data: { block: heading, missing: ['fixture.jpg'], label: '红色标题' } })
  await click('match-on-insert')
  expect(el<HTMLInputElement>('match-on-insert').checked).toBe(true)
})
it('saves typed metadata and the selected role, then displays the refreshed receipt', async () => {
  await mount([red])
  await click('component-edit')
  change('component-name', '已编辑标题')
  change('component-tags', 'alpha，beta、gamma delta')
  change('component-role', 'h2' satisfies RoleId)
  h.update.mockResolvedValue(undefined)
  h.read.mockResolvedValue([fixture('red', { ...red, name: '已编辑标题', role: 'h2', tags: ['alpha', 'beta', 'gamma', 'delta'] })])
  await click('component-edit-save')
  expect(h.update).toHaveBeenCalledExactlyOnceWith('red', { name: '已编辑标题', role: 'h2', tags: ['alpha', 'beta', 'gamma', 'delta'] })
  expect(h.read).toHaveBeenCalledTimes(2)
  expect(cardNames()).toEqual(['已编辑标题'])
  expect(host.textContent).toContain('二级标题')
  expect(host.textContent).toContain('#alpha #beta #gamma #delta')
})
it('cancels deletion without an API call and refreshes only after confirmed deletion', async () => {
  await mount([red])
  await click('component-delete')
  expect(confirm).toHaveBeenCalledExactlyOnceWith('删除组件「红色标题」？已插入文档的内容不受影响。')
  expect(h.remove).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  h.remove.mockResolvedValue(undefined)
  h.read.mockResolvedValue([])
  await click('component-delete')
  expect(h.remove).toHaveBeenCalledExactlyOnceWith('red')
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('已删除组件')
  expect(cardNames()).toEqual([])
})
it('refreshes on assets changes and leaves the last rendered list visible after a failed refresh', async () => {
  await mount([red])
  h.read.mockResolvedValueOnce([blue]).mockRejectedValueOnce(Error('合成加载失败'))
  await event('assets-changed')
  expect(cardNames()).toEqual(['蓝色正文'])
  await event('components-changed')
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('合成加载失败', 'error')
  expect(cardNames()).toEqual(['蓝色正文'])
  act(() => root.render(null))
  await event('components-changed')
  await event('assets-changed')
  expect(h.read).toHaveBeenCalledTimes(3)
})
it('hides built-ins and deduplicates template collection by fingerprint without changing insert availability', async () => {
  const included: Part = { id: 'p1', from: '合成来源', block: heading, kind: 'heading', photos: 0, texts: [] }
  const already: Part = { id: 'p2', from: '已有来源', block: body, kind: 'body', photos: 1, texts: [] }
  h.catalog.mockReturnValue([included, already, { ...already, id: 'b:paragraph', from: '内置来源' }])
  await mount([blue], templates)
  await click('components-parts')
  expect(cardNames('part-card')).toHaveLength(2)
  expect(host.textContent).toContain('已收藏')
  expect(host.textContent).not.toContain('内置来源')
  expect(host.querySelectorAll('[data-testid="part-collect"]')).toHaveLength(1)
  await click('part-collect')
  expect(h.collect).toHaveBeenCalledExactlyOnceWith({ block: heading, via: 'template', source: { title: '合成来源' } })
  await click('part-insert')
  expect(h.insert).toHaveBeenCalledExactlyOnceWith(heading)
  change('component-search', '已有来源')
  expect(cardNames('part-card')).toHaveLength(1)
  expect(el('part-collect')).toBeNull()
  await click('kind-heading')
  expect(host.textContent).toContain('没有符合条件的部件')
})
it('does not compile an offscreen preview, renders only on intersection and disconnects on unmount', () => {
  let intersect!: (visible: boolean) => void
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(listener: (records: Array<{isIntersecting: boolean}>) => void, options: IntersectionObserverInit) {
      expect(options.rootMargin).toBe('100px')
      intersect = (isIntersecting) => listener([{ isIntersecting }])
    }
    observe = observe
    disconnect = disconnect
  })
  act(() => root.render(createElement(LazyPreview, { block: body, doc, tall: true })))
  expect(observe).toHaveBeenCalledExactlyOnceWith(host.querySelector('.comp-preview.tall'))
  expect(h.compile).not.toHaveBeenCalled()
  act(() => intersect(true))
  expect(host.querySelector('.comp-inner p')?.textContent).toBe('合成预览')
  expect(h.compile).toHaveBeenCalledTimes(1)
  act(() => intersect(false))
  expect(host.querySelector('.comp-inner')?.textContent).toBe('')
  act(() => root.render(null))
  expect(disconnect).toHaveBeenCalledTimes(1)
})
it('renders a blank but stable preview if the compiler rejects a block', () => {
  h.compile.mockImplementationOnce(() => { throw Error('合成预览失败') })
  act(() => root.render(createElement(LazyPreview, { block: body, doc })))
  expect(h.compile).toHaveBeenCalledTimes(1)
  expect(host.querySelector('.comp-inner')?.textContent).toBe('')
})

function pendingComponents() {
  let resolve!: (components: LibraryComponent[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<LibraryComponent[]>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}
it('does not overwrite the last successful library refresh with an older result', async () => {
  await mount([red])
  const older = pendingComponents()
  const newer = pendingComponents()
  h.read.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  await event('components-changed')
  await event('assets-changed')
  expect(h.read).toHaveBeenCalledTimes(3)
  await act(async () => { newer.resolve([blue]) })
  expect(cardNames()).toEqual(['蓝色正文'])
  await act(async () => { older.resolve([red]) })
  expect(cardNames()).toEqual(['蓝色正文'])
})
it('starts editing the current receipt after same-ID metadata changes', async () => {
  await mount([red])
  h.read.mockResolvedValue([fixture('red', { ...red, name: '刷新后的标题', role: 'h2', tags: ['fresh'] })])
  await event('components-changed')
  expect(cardNames()).toEqual(['刷新后的标题'])
  await click('component-edit')
  expect(el<HTMLInputElement>('component-name').value).toBe('刷新后的标题')
  expect(el<HTMLInputElement>('component-tags').value).toBe('fresh')
  expect(el<HTMLSelectElement>('component-role').value).toBe('h2')
})
it('drops a cancelled draft without changing saved metadata or restarting the library read', async () => {
  await mount([red])
  await click('component-edit')
  change('component-name', '不保留的草稿')
  const cancel = [...el('component-card').querySelectorAll('button')].find((button) => button.textContent === '取消')!
  await act(async () => { cancel.click() })
  expect(cardNames()).toEqual(['红色标题'])
  await click('component-edit')
  expect(el<HTMLInputElement>('component-name').value).toBe('红色标题')
  expect(h.update).not.toHaveBeenCalled()
  expect(h.read).toHaveBeenCalledTimes(1)
})
it('does not disturb the open draft when a component refresh changes its source metadata', async () => {
  await mount([red])
  await click('component-edit')
  change('component-name', '仍在编辑的草稿')
  h.read.mockResolvedValue([fixture('red', { ...red, name: '后台新名称' })])
  await event('assets-changed')
  expect(el<HTMLInputElement>('component-name').value).toBe('仍在编辑的草稿')
})
it('retains a usable older success when the newer refresh fails', async () => {
  await mount([red])
  const older = pendingComponents()
  const newer = pendingComponents()
  h.read.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  await event('components-changed')
  await event('assets-changed')
  await act(async () => { newer.reject(Error('新请求确实失败')) })
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('新请求确实失败', 'error')
  expect(cardNames()).toEqual(['红色标题'])
  await act(async () => { older.resolve([blue]) })
  expect(cardNames()).toEqual(['蓝色正文'])
})
it('ignores an obsolete error after a more recent refresh succeeds', async () => {
  await mount([red])
  const older = pendingComponents()
  h.read.mockReturnValueOnce(older.promise).mockResolvedValueOnce([blue])
  await event('components-changed')
  await event('assets-changed')
  await act(async () => { older.reject(Error('旧错误')) })
  expect(cardNames()).toEqual(['蓝色正文'])
  expect(h.notify).not.toHaveBeenCalled()
})
it('keeps StrictMode replay in the same tree from reviving the prior effect', async () => {
  const previousEffect = pendingComponents()
  const liveEffect = pendingComponents()
  h.read.mockReturnValueOnce(previousEffect.promise).mockReturnValueOnce(liveEffect.promise)
  await mount([], [], true)
  expect(h.read).toHaveBeenCalledTimes(2)
  await act(async () => { previousEffect.resolve([red]) })
  expect(cardNames()).toEqual([])
  await act(async () => { liveEffect.resolve([blue]) })
  expect(cardNames()).toEqual(['蓝色正文'])
})
it('does not notify for a request rejected after the library unmounts', async () => {
  const read = pendingComponents()
  h.read.mockReturnValueOnce(read.promise)
  await mount()
  expect(h.read).toHaveBeenCalledTimes(1)
  act(() => root.render(null))
  await act(async () => { read.reject(Error('已离开组件库')) })
  expect(h.notify).not.toHaveBeenCalled()
})

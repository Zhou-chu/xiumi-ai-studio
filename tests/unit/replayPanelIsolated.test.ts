// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultReplay, makeItem, makeScene } from '../../src/core/replay/schema'
import type { ReplayDoc } from '../../src/core/replay/types'
import type { Block } from '../../src/core/types'
import { ReplayPanel } from '../../src/editor/ReplayPanel'
import type { Asset } from '../../src/editor/api'

const h = vi.hoisted(() => ({
  updateProps: vi.fn(), assets: vi.fn(), renderReplay: vi.fn(),
  drag: null as null | ((event: { active: { id: string }; over: null | { id: string } }) => void),
}))
vi.mock('../../src/editor/store', () => ({
  useStore: (select: (state: { updateProps: typeof h.updateProps }) => unknown) => select({ updateProps: h.updateProps }),
}))
vi.mock('../../src/editor/api', () => ({
  api: { assets: h.assets },
  assetRef: (a: Asset) => ({ src: '/media/' + a.file, assetId: a.id, alt: a.name, width: a.width, height: a.height }),
}))
vi.mock('../../src/core/replay', async () => ({
  ...await import('../../src/core/replay/schema'),
  ...await import('../../src/core/replay/sample'),
  renderReplay: h.renderReplay,
}))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ onDragEnd, children }: { onDragEnd: NonNullable<typeof h.drag>; children: ReactNode }) => {
    h.drag = onDragEnd
    return children
  },
  PointerSensor: Symbol('pointer'), closestCenter: vi.fn(), useSensor: vi.fn(), useSensors: vi.fn(),
}))
vi.mock('@dnd-kit/sortable', async importOriginal => ({
  arrayMove: (await importOriginal<typeof import('@dnd-kit/sortable')>()).arrayMove,
  SortableContext: ({ children }: { children: ReactNode }) => children,
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: null, setActivatorNodeRef: null, transform: null }),
}))

let host: HTMLDivElement
let root: Root
const fixture = (): Block<'replay'> => ({
  id: 'replay-a', type: 'replay', props: {
    ...defaultReplay(),
    scenes: [makeScene([
      makeItem('title', { id: 'title', content: '标题原文' }),
      makeItem('image', { id: 'photo' }),
      makeItem('shape', { id: 'shape' }),
      makeItem('stat', { id: 'stat' }),
      makeItem('divider', { id: 'divider' }),
    ]), makeScene([makeItem('quote', { id: 'quote', content: '第二场景原文' })])],
  },
})
function Controlled({ initial }: { initial: Block<'replay'> }) {
  const [block,setBlock] = useState(initial)
  useLayoutEffect(() => {
    h.updateProps.mockImplementation((id: string, patch: Partial<ReplayDoc>) => {
      if (id !== initial.id) throw Error('Unexpected block update')
      setBlock(current => ({ ...current, props: { ...current.props, ...patch } }))
    })
  }, [initial.id])
  return createElement(ReplayPanel, { block })
}
const mount = (initial = fixture()) => act(() => root.render(createElement(Controlled, { key: initial.id, initial })))
const find = <T extends HTMLElement>(selector: string, scope: HTMLElement = host) => {
  const node = scope.querySelector<T>(selector)
  if (!node) throw Error('Missing ' + selector)
  return node
}
const row = (index: number) => {
  const node = host.querySelectorAll<HTMLElement>('[data-testid="rp-item"]')[index]
  if (!node) throw Error('Missing item ' + index)
  return node
}
const named = (name: string, scope: HTMLElement = host) => {
  const node = [...scope.querySelectorAll('button')].find(button => button.textContent?.trim() === name)
  if (!node) throw Error('Missing button ' + name)
  return node
}
const field = (label: string, scope: HTMLElement = host) => {
  const node = [...scope.querySelectorAll('label')].find(element => element.firstElementChild?.textContent?.trim() === label || element.lastElementChild?.textContent?.trim() === label)
  if (!node) throw Error('Missing field ' + label)
  return find<HTMLInputElement | HTMLSelectElement>('input,select', node)
}
const click = (node: HTMLElement) => act(() => node.click())
const value = (node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, next: string) => act(() => {
  const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, next)
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
})
const assertPatch = (key: string, patch: Partial<ReplayDoc>) => expect(h.updateProps).toHaveBeenLastCalledWith('replay-a', patch, 'replay-a:' + key)
const scenes = () => (h.updateProps.mock.lastCall![1] as { scenes: ReplayDoc['scenes'] }).scenes
const item = (index: number, scene = 0) => scenes()[scene].items[index]
const photo: Asset = { id: 'asset-1', file: 'fixture.jpg', name: '本地图', size: 48, width: 64, height: 32, createdAt: 0 }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Unexpected network') }))
  vi.stubGlobal('confirm', vi.fn(() => { throw Error('Unexpected confirmation') }))
  h.updateProps.mockReset()
  h.assets.mockReset().mockImplementation(() => { throw Error('Unexpected asset request') })
  h.renderReplay.mockReset().mockImplementation(() => { throw Error('Unexpected replay render') })
  h.drag = null
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals()
})

it('requests preview only for the current block without rendering or writing it', () => {
  mount()
  const opened = vi.fn()
  window.addEventListener('open-replay', opened, { once: true })
  click(find('[data-testid="rp-preview"]'))
  expect(opened).toHaveBeenCalledTimes(1)
  expect(opened.mock.calls[0][0]).toMatchObject({ detail: { id: 'replay-a' } })
  expect(h.renderReplay).not.toHaveBeenCalled()
  expect(h.updateProps).not.toHaveBeenCalled()
})

it('preserves the selected scene on cancellation and selects the first scene only after explicit sample replacement', () => {
  mount()
  click(named('场景 2'))
  vi.mocked(confirm).mockReturnValueOnce(false).mockReturnValueOnce(true)
  click(find('[data-testid="rp-sample"]'))
  expect(h.updateProps).not.toHaveBeenCalled()
  expect(find<HTMLTextAreaElement>('[data-testid="rp-content"]').value).toBe('第二场景原文')
  click(find('[data-testid="rp-sample"]'))
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(h.updateProps).toHaveBeenCalledOnce()
  expect(h.updateProps.mock.lastCall![2]).toBe('replay-a:sample')
  expect(named('场景 1').classList.contains('on')).toBe(true)
  expect(find<HTMLTextAreaElement>('[data-testid="rp-content"]').value).not.toBe('标题原文')
  expect(scenes()).toHaveLength(2)
})

it('applies playback edits as scoped patches while preserving unrelated values', () => {
  const block = fixture()
  mount(block)
  const playback = { ...block.props.playback, trigger: 'tap', pace: 'fast' } as const
  click(named('点击开始（依赖 id，待验证）'))
  click(named('快'))
  assertPatch('pace', { playback })
  click(field('循环播放：播完停留'))
  assertPatch('loop', { playback: { ...playback, loop: { hold: 2 } } })
  value(find('.rp-inline-num'), '-3')
  assertPatch('hold', { playback: { ...playback, loop: { hold: 0 } } })
  click(find('input[type=checkbox]'))
  assertPatch('loop', { playback: { ...playback, loop: undefined } })
  value(field('开始时间 s'), '3.5')
  assertPatch('start', { playback: { ...playback, loop: undefined, start: 3.5 } })
  value(field('开始时间 s'), '-1')
  assertPatch('start', { playback: { ...playback, loop: undefined, start: undefined } })
  click(named('SVG 文字'))
  assertPatch('textMode', { textMode: 'svg-text' })
})

it('switches gradient and grid controls without overwriting the canvas or other stops', () => {
  const { props: { canvas } } = fixture()
  const block = fixture()
  block.props.canvas = { ...canvas, background: { ...canvas.background, value: '#112233,#445566,#778899', type: 'gradient' } }
  mount(block)
  value(field('中'), '#cf0201')
  const bg = { ...block.props.canvas.background, value: '#112233,#cf0201,#778899' }
  assertPatch('bg', { canvas: { ...canvas, background: bg } })
  click(named('纯色'))
  assertPatch('bg', { canvas: { ...canvas, background: { ...bg, type: 'color', value: '#112233' } } })
  click(named('渐变'))
  value(field('下'), '#102938')
  value(field('间距'), '2')
  expect(h.updateProps.mock.lastCall![1]).toMatchObject({ canvas: { background: { value: '#112233,#102938', grid: { size: 10 } } } })
  value(field('网格色'), '#fff001')
  expect(h.updateProps.mock.lastCall![1]).toMatchObject({ canvas: { background: { grid: { size: 10, color: '#fff001' } } } })
  click(field('蓝图网格'))
  expect(h.updateProps.mock.lastCall![1]).toMatchObject({ canvas: { background: { grid: undefined } } })
  click(field('蓝图网格'))
  expect(h.updateProps.mock.lastCall![1]).toMatchObject({ canvas: { background: { grid: { size: 50, color: '#123a66' } } } })
})

it('preserves cursor peer names and colors, and defaults cleared budget fields', () => {
  const block = fixture()
  mount(block)
  click(find('[data-testid="rp-show-cursors"]'))
  click(named('3'))
  value(field('光标名字（逗号分隔，可留空）'), '甲,  乙，')
  assertPatch('names', { cursors: { ...block.props.cursors, show: !block.props.cursors.show, count: 3, names: ['甲','乙',''] } })
  value(field('乙'), '#123abc')
  assertPatch('palette', { theme: { ...block.props.theme, cursorPalette: block.props.theme.cursorPalette.map((x,i) => i === 1 ? '#123abc' : x) } })
  value(field('强调色'), '#04f0cc')
  expect(h.updateProps.mock.lastCall![1]).toMatchObject({ theme: { accent: '#04f0cc', cursorPalette: expect.arrayContaining(['#123abc']) } })
  value(field('光标名字（逗号分隔，可留空）'), ' ， ')
  expect(h.updateProps.mock.lastCall![1]).toMatchObject({ cursors: { names: undefined, count: 3 } })
  value(field('单场景 KB'), '39')
  value(field('整体 KB'), '280')
  value(field('单场景 KB'), '')
  assertPatch('budget', { budget: { sceneKB: 80, totalKB: 280 } })
  value(field('整体 KB'), '')
  assertPatch('budget', { budget: { sceneKB: 80, totalKB: 400 } })
})

it('adds and removes scenes without mutating their siblings or removing the last one', () => {
  const block = fixture()
  mount(block)
  click(find('[data-testid="rp-add-scene"]'))
  expect(scenes().slice(0,2)).toEqual(block.props.scenes)
  expect(scenes()[2].items.map(x => x.type)).toEqual(['title','text'])
  expect(named('场景 3').className).toBe('on')
  click(named('自由定位'))
  click(field('依次出现（上一个完成后才开始，适合逐段打字的正文）'))
  click(named('聚拢绕圈后散开'))
  value(field('场景高度'), '340')
  expect(scenes()[2]).toMatchObject({ layout: 'absolute', overlap: 1, finale: 'swarm', height: 340 })
  click(named('删除此场景'))
  assertPatch('remove-scene', { scenes: block.props.scenes })
  expect(named('场景 2').className).toBe('on')
  click(named('删除此场景'))
  expect(host.querySelector('.rp-scenes')?.textContent).not.toContain('场景 2')
  expect(host.textContent).not.toContain('删除此场景')
})

it('routes DnD completion only to valid changed positions within the selected scene', () => {
  const block = fixture()
  mount(block)
  const drag = (from: string, over: string | null) => act(() => h.drag!({ active: { id: from }, over: over ? { id: over } : null }))
  drag('title', null)
  drag('title', 'title')
  drag('title', 'quote')
  drag('quote', 'title')
  expect(h.updateProps).not.toHaveBeenCalled()
  drag('stat','title')
  expect(scenes()[0].items.map(x => x.id)).toEqual(['stat','title','photo','shape','divider'])
  expect(scenes()[1]).toEqual(block.props.scenes[1])
  expect(h.updateProps.mock.lastCall![2]).toBe('replay-a:scene0:order')
})

it('edits each item without contaminating the other items or their source snapshot', () => {
  const block = fixture()
  mount(block)
  value(find('[data-testid="rp-content"]', row(0)), '新 **标题**\n第二行')
  expect(item(0).content).toBe('新 **标题**\n第二行')
  value(find('[data-testid="rp-preset"]', row(0)), 'pop')
  expect(item(0).enter).toBe('pop')
  value(find('[data-testid="rp-preset"]', row(0)), '')
  expect(item(0).enter).toBeUndefined()
  click(named('圆环', row(2)))
  expect(item(2).content).toBe('ring')
  value(find('[data-testid="rp-content"]', row(3)), '75.5%')
  value(find('input[placeholder="说明文字"]', row(3)), '')
  expect(item(3)).toMatchObject({ content: '75.5%', label: undefined })
  expect(row(4).querySelector('[data-testid="rp-content"]')).toBeNull()
  click(find('[title="删除元素"]', row(0)))
  click(find('[data-testid="rp-add-text"]'))
  expect(scenes()[0].items.map(x => x.type)).toEqual(['image','shape','stat','divider','text'])
  expect(scenes()[1]).toEqual(block.props.scenes[1])
  expect(block.props.scenes[0].items[0].content).toBe('标题原文')
})

it('updates optional item geometry, style and cursor fields, and unsets them explicitly', () => {
  mount()
  click(named('更多', row(0)))
  expect(row(0).textContent).not.toContain('W')
  click(named('自由定位'))
  value(field('W', row(0)), '310')
  expect(item(0).frame).toEqual({ x: 56, y: 88, w: 310 })
  value(field('延迟 s', row(0)), '0.75')
  value(field('光标', row(0)), 'type')
  value(field('由谁', row(0)), '0')
  expect(item(0)).toMatchObject({ delay: 0.75, cursor: { action: 'type', who: 0 } })
  value(field('由谁', row(0)), '')
  expect(item(0).cursor).toEqual({ action: 'type', who: undefined })
  value(field('文字色', row(0)), '#123abc')
  value(field('底色', row(0)), '#223abc')
  value(field('描边', row(0)), '#323abc')
  value(field('字号', row(0)), '32')
  value(field('字号', row(0)), '')
  expect(item(0).style).toEqual({ color: '#123abc', fill: '#223abc', stroke: '#323abc' })
  click(named('恢复默认样式', row(0)))
  expect(item(0).style).toBeUndefined()
  click(named('收起', row(0)))
  expect(row(0).querySelector('.rp-more')).toBeNull()
})

it('loads assets lazily, commits the selected asset once, and reopens the cached picker without mutating the source', async () => {
  const block = fixture()
  mount(block)
  expect(h.assets).not.toHaveBeenCalled()
  let complete!: (assets: Asset[]) => void
  h.assets.mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
  click(find('[data-testid="rp-pick-image"]', row(1)))
  expect(row(1).textContent).toContain('加载中…')
  await act(async () => complete([photo]))
  const image = find<HTMLImageElement>('img[alt="本地图"]', row(1))
  expect(image.getAttribute('src')).toBe('/media/fixture.jpg?fit=1:1&w=120')
  click(image)
  expect(row(1).querySelector('.rp-asset-grid')).toBeNull()
  expect(item(1).image).toEqual({ src: '/media/fixture.jpg', assetId: 'asset-1', alt: '本地图', width: 64, height: 32 })
  expect(h.updateProps).toHaveBeenCalledOnce()
  click(find('[data-testid="rp-pick-image"]', row(1)))
  expect(h.assets).toHaveBeenCalledOnce()
  click(named('移除', row(1)))
  expect(item(1).image).toBeUndefined()
  expect(block.props.scenes[0].items[1].image).toBeUndefined()
})

it('closes a pending picker without editing, and later shows the empty response without a second request', async () => {
  mount()
  let resolveAssets!: (assets: Asset[]) => void
  h.assets.mockReturnValueOnce(new Promise(resolve => { resolveAssets = resolve }))
  click(find('[data-testid="rp-pick-image"]', row(1)))
  click(named('收起', row(1)))
  await act(async () => resolveAssets([]))
  expect(row(1).querySelector('.rp-asset-grid')).toBeNull()
  expect(h.updateProps).not.toHaveBeenCalled()
  click(find('[data-testid="rp-pick-image"]', row(1)))
  expect(row(1).textContent).toContain('素材库是空的')
  expect(h.assets).toHaveBeenCalledOnce()
})

it('settles an asset error without writing to the replay or showing a perpetual busy indicator', async () => {
  mount()
  h.assets.mockRejectedValueOnce(Error('fixture offline'))
  await act(async () => find('[data-testid="rp-pick-image"]', row(1)).click())
  expect(row(1).textContent).not.toContain('加载中…')
  expect(row(1).querySelectorAll('.rp-asset-grid img')).toHaveLength(0)
  expect(h.updateProps).not.toHaveBeenCalled()
  click(named('收起', row(1)))
  expect(row(1).querySelector('.rp-asset-grid')).toBeNull()
})

it('shares an in-flight asset read when the same picker is reopened before the response', async () => {
  mount()
  let first!: (assets: Asset[]) => void
  let second!: (assets: Asset[]) => void
  h.assets.mockImplementationOnce(() => new Promise<Asset[]>(resolve => { first = resolve }))
    .mockImplementationOnce(() => new Promise<Asset[]>(resolve => { second = resolve }))
  click(find('[data-testid="rp-pick-image"]', row(1)))
  click(named('收起', row(1)))
  click(find('[data-testid="rp-pick-image"]', row(1)))
  await act(async () => { first([photo]); second?.([]) })
  expect(h.assets).toHaveBeenCalledOnce()
  expect(find<HTMLImageElement>('img[alt="本地图"]', row(1)).alt).toBe('本地图')
  expect(h.updateProps).not.toHaveBeenCalled()
})

it('distinguishes read failures from empty libraries and retries following explicit close and reopen', async () => {
  mount()
  h.assets.mockRejectedValueOnce(Error('fixture offline')).mockResolvedValueOnce([photo])
  await act(async () => find('[data-testid="rp-pick-image"]', row(1)).click())
  const failed = row(1).textContent
  click(named('收起', row(1)))
  await act(async () => find('[data-testid="rp-pick-image"]', row(1)).click())
  expect.soft(failed).not.toContain('素材库是空的')
  expect.soft(failed).toContain('加载素材失败')
  expect.soft(h.assets).toHaveBeenCalledTimes(2)
  expect(row(1).querySelector('img[alt="本地图"]')).not.toBeNull()
  expect(h.updateProps).not.toHaveBeenCalled()
})

it('does not leak an old picker response into a newly mounted replay block', async () => {
  mount()
  let resolveOld!: (assets: Asset[]) => void
  h.assets.mockImplementationOnce(() => new Promise<Asset[]>(resolve => { resolveOld = resolve }))
    .mockResolvedValueOnce([{ ...photo, id: 'new', name: '新文档素材' }])
  click(find('[data-testid="rp-pick-image"]', row(1)))
  mount({ ...fixture(), id: 'replay-b' })
  await act(async () => find('[data-testid="rp-pick-image"]', row(1)).click())
  await act(async () => resolveOld([photo]))
  expect(row(1).querySelector('img[alt="本地图"]')).toBeNull()
  expect(find<HTMLImageElement>('img[alt="新文档素材"]', row(1)).alt).toBe('新文档素材')
  expect(h.assets).toHaveBeenCalledTimes(2)
  expect(h.updateProps).not.toHaveBeenCalled()
})

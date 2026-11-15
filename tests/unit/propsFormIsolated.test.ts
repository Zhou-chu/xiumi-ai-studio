// @vitest-environment jsdom
import { act, createElement, StrictMode, useLayoutEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { richToPlain, textToRich } from '../../src/core/richtext'
import type { Block, RichText } from '../../src/core/types'
import type { Asset } from '../../src/editor/api'
import { PropsForm } from '../../src/editor/PropsForm'

const h = vi.hoisted(() => ({
  update: vi.fn(), assets: vi.fn(), ratio: vi.fn(), notify: vi.fn(),
  replace: null as ((block: Block) => void) | null,
  state: null as unknown as { doc: { themeId: string; blocks: Block[] }; updateProps: (...args: unknown[]) => void; notify: (...args: unknown[]) => void },
}))
vi.mock('../../src/editor/store', () => ({
  useStore: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), { getState: () => h.state }),
}))
vi.mock('../../src/editor/api', () => ({ api: { assets: h.assets } }))
vi.mock('../../src/editor/Canvas', () => ({ shownRatio: h.ratio }))
vi.mock('../../src/editor/CoverTitleAlignment', () => ({
  CoverTitleAlignment: ({ onChange }: { onChange: (align: string) => void }) =>
    createElement('button', { 'data-testid': 'title-alignment-boundary', onClick: () => onChange('center') }, 'Alignment child'),
}))
vi.mock('../../src/editor/ReplayPanel', () => ({
  ReplayPanel: ({ block }: { block: Block }) => createElement('span', { 'data-testid': 'replay-boundary' }, block.id),
}))
vi.mock('../../src/editor/ColorPicker', () => ({
  ColorPicker: ({ onPick, testId }: { onPick: (color: string) => void; testId: string }) =>
    createElement('button', { 'data-testid': testId, onClick: () => onPick('#007733') }, 'Color child'),
}))

const asset = (name: string): Asset => ({ id: name, file: name + '.jpg', name, width: 240, height: 160, size: 50, createdAt: 0 })
let host: HTMLDivElement
let root: Root

// Simulate the parent applying the scoped patch immediately, not the real store.
function ControlledForm({ initial }: { initial: Block }) {
  const [block,setBlock] = useState(initial)
  useLayoutEffect(() => {
    h.replace = setBlock
    h.update.mockImplementation((id: string, props: object) => {
      setBlock(current => current.id === id ? { ...current, props: { ...current.props, ...props } } as Block : current)
    })
    return () => { h.replace = null }
  }, [])
  return createElement(PropsForm, { key: block.id, block })
}
const mount = async (block: Block, strict = false) => {
  h.state.doc = { ...h.state.doc, blocks: [block] }
  const form = createElement(ControlledForm, { key: block.id, initial: block })
  await act(async () => root.render(strict ? createElement(StrictMode, null, form) : form))
}
const replace = (block: Block) => act(() => h.replace!(block))
const query = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const press = async (target: HTMLElement) => {
  expect(target).toBeTruthy()
  await act(async () => target.click())
}
const change = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  expect(element).toBeTruthy()
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
})
const patch = () => h.update.mock.lastCall![1]
const photoBlock = () => createBlock('html', { html: '<p>照片段落</p><img src="/media/before.jpg" style="width:160px">', label: '照片' })
const photoChoice = () => query<HTMLElement>('.gallery-edit .g-item')
const backgroundChoice = () => query<HTMLElement>('[data-testid="bg-photo-0"]')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  h.update.mockReset()
  h.assets.mockReset().mockImplementation(() => { throw Error('Unexpected asset request') })
  h.ratio.mockReset().mockReturnValue(1.5)
  h.notify.mockReset()
  h.state = { doc: { themeId: 'minimal-magazine', blocks: [] }, updateProps: h.update, notify: h.notify }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals()
})

it.each(['paragraph','card','imageText'] as const)('preserves line breaks and surrounding spaces while editing the %s controlled draft', async type => {
  const block = createBlock(type)
  await mount(block)
  const textarea = () => query<HTMLTextAreaElement>('textarea')
  const text = '  Lead  \n\nTail \n'
  change(textarea(), text)
  expect(h.update).toHaveBeenCalledExactlyOnceWith(block.id, expect.objectContaining({ content: expect.any(Object) }), block.id + ':content')
  expect(richToPlain(patch().content as RichText, { preserveWhitespace: true })).toBe(text)
  expect(textarea().value).toBe(text)
  replace({ ...block, props: { ...block.props, content: textToRich('External edit') } } as Block)
  expect(textarea().value).toBe('External edit')
})

it('retains bold content when choosing paragraph alignment', async () => {
  const block = createBlock('paragraph', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Marked', marks: [{ type: 'bold' }] }] }] } })
  await mount(block)
  await press(button('右对齐'))
  expect(patch()).toMatchObject({ align: 'right', content: { content: [{ attrs: { textAlign: 'right' }, content: [{ text: 'Marked', marks: [{ type: 'bold' }] }] }] } })
})

it('keeps table draft blank lines but saves normalized headers and nonempty cells', async () => {
  const block = createBlock('table', { headers: ['old'], rows: [['row']] })
  await mount(block)
  const text = '  A | B \n\n one | two \n'
  change(query('textarea'), text)
  expect(h.update).toHaveBeenCalledExactlyOnceWith(block.id, { headers: ['A','B'], rows: [['one','two']] }, block.id + ':table')
  expect(query<HTMLTextAreaElement>('textarea').value).toBe(text)
  replace({ ...block, props: { ...block.props, headers: ['History'], rows: [] } })
  expect(query<HTMLTextAreaElement>('textarea').value).toBe('History')
})

it('only patches the edited timeline cell and leaves sibling objects untouched', async () => {
  const items = [{ time: 'T1', title: 'First', desc: 'D1' }, { time: 'T2', title: 'Second', desc: 'D2' }]
  const block = createBlock('timeline', { items })
  await mount(block)
  change(query('.row-edit input[placeholder="环节"]'), 'Changed')
  expect(h.update).toHaveBeenCalledExactlyOnceWith(block.id, { items: [{ ...items[0], title: 'Changed' }, items[1]] }, block.id + ':items0n')
  expect(items[0].title).toBe('First')
  expect(patch().items[1]).toBe(items[1])
})

it('updates gallery order and applies removal to the currently controlled order', async () => {
  const images = [{ src: '/media/a.jpg' }, { src: '/media/b.jpg' }]
  const block = createBlock('gallery', { images })
  await mount(block)
  expect(query<HTMLButtonElement>('.g-item button').disabled).toBe(true)
  await press(host.querySelectorAll<HTMLElement>('.g-item')[1].querySelector('button')!)
  expect(patch()).toEqual({ images: [images[1],images[0]] })
  await press(query('.g-item button:last-child'))
  expect(patch()).toEqual({ images: [images[0]] })
  expect(images.map(im => im.src)).toEqual(['/media/a.jpg','/media/b.jpg'])
})

it('increasing the photo slot count keeps captions without changing the original inputs', async () => {
  const pics = [{ caption: 'A' },{ caption: 'B' }]
  const block = createBlock('photos', { count: 2, layout: 'even', pics })
  await mount(block)
  await press(host.querySelectorAll('.seg')[0].querySelectorAll('button')[2])
  expect(h.update).toHaveBeenCalledExactlyOnceWith(block.id, { count: 4, pics: [...pics,{ caption: '' },{ caption: '' }] }, block.id + ':count')
  expect(pics).toHaveLength(2)
})

it('refuses whitespace-only slot replacement and keeps sibling text and images through meaningful edit', async () => {
  const block = createBlock('html',{ html: '<h2>Title</h2><p style="color:#333333">Body</p><img src="/media/a.jpg">' })
  await mount(block)
  const area = () => query<HTMLTextAreaElement>('[data-testid="slot-t1"] textarea')
  change(area(),'  ')
  expect(h.update).not.toHaveBeenCalled()
  change(area(),'  Meaningful \n\nTail ')
  expect(patch().html).toContain('Title'); expect(patch().html).toContain('Meaningful'); expect(patch().html).toContain('/media/a.jpg')
  expect(h.update.mock.lastCall![2]).toBe(block.id + ':slot-t1')
  expect(area().value).toBe('  Meaningful \n\nTail ')
  await press(query('[data-testid="align-t1-center"]'))
  expect(patch().html).toContain('text-align: center')
  expect(query('[data-testid="align-t1-center"]').getAttribute('aria-pressed')).toBe('true')
})

it('choosing a slot color delegates a scoped HTML patch and keeps other slots intact', async () => {
  const block = createBlock('html', { html: '<h2 style="color:#660000">Title</h2><p>Body</p>' })
  await mount(block)
  await press(query('[data-testid="color-t1"]'))
  expect(patch().html).toContain('#007733')
  expect(patch().html).toContain('#660000')
  expect(h.update.mock.lastCall![2]).toBe(block.id + ':color-t1')
})

it('does not apply HTML source while typing, then sanitizes its explicit apply', async () => {
  const block = createBlock('html',{ html: '<p>Body</p>' })
  await mount(block)
  await press(button('编辑 HTML 源码'))
  change(query('textarea.code'),'<p>Safe</p><script>discard-me</script>')
  expect(h.update).not.toHaveBeenCalled()
  await press(button('应用（自动清洗不安全内容）'))
  expect(h.update).toHaveBeenCalledExactlyOnceWith(block.id,{ html: '<p>Safe</p>' }, block.id + ':html-src')
  expect(query<HTMLTextAreaElement>('textarea.code').value).toBe('<p>Safe</p>')
})

it('loads a photo choice only when requested and preserves the original picture ratio via geometry boundary', async () => {
  const block = photoBlock()
  const frame = document.createElement('div')
  frame.dataset.blockId = block.id
  const content = document.createElement('div'); content.className = 'block-html'
  const image = document.createElement('img'); content.append(image); frame.append(content)
  const canvas = document.createElement('div'); canvas.dataset.testid = 'canvas'; canvas.append(frame); document.body.append(canvas)
  try {
    h.assets.mockResolvedValueOnce([asset('library')])
    await mount(block)
    expect(h.assets).not.toHaveBeenCalled()
    await press(photoChoice())
    expect(h.assets).toHaveBeenCalledOnce()
    await press(query('.picker .asset'))
    expect(h.ratio).toHaveBeenCalledExactlyOnceWith(image)
    expect(patch().html).toContain('/media/library.jpg')
    expect(patch().html).toContain('照片段落')
    expect(patch().html).not.toContain('/media/before.jpg')
    expect(query('.picker')).toBeNull()
    expect(block.props.html).toContain('/media/before.jpg')
  } finally { canvas.remove() }
})

it('replaces repeated local background locations without touching the sibling text', async () => {
  const block = createBlock('html', { html: '<section style="background-image:url(/media/old-bg.jpg)"></section><section style="background-image:url(/media/old-bg.jpg)"></section><p>保留文字</p>' })
  h.assets.mockResolvedValueOnce([asset('bg')])
  await mount(block)
  expect(query('.g-count').textContent).toContain('2')
  await press(backgroundChoice())
  await press(query('[data-testid="bg-asset"]'))
  expect(patch().html.match(/\/media\/bg\.jpg/g)).toHaveLength(2)
  expect(patch().html).toContain('保留文字')
  expect(query('.picker')).toBeNull()
})

it('does not offer background image replacement for a text-bearing decorative surface', async () => {
  await mount(createBlock('html', { html: '<section style="background-image:url(/media/decor.jpg)">保留文字</section>' }))
  expect(backgroundChoice()).toBeNull()
  expect(h.assets).not.toHaveBeenCalled()
  expect(h.update).not.toHaveBeenCalled()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

it('reports loading instead of an empty asset library before the request completes', async () => {
  const pending = deferred<Asset[]>()
  h.assets.mockReturnValueOnce(pending.promise)
  await mount(photoBlock())
  await press(photoChoice())
  expect(query('.picker').textContent).toContain('正在加载素材')
  expect(query('.picker .empty')).toBeNull()
  await act(async () => pending.resolve([]))
  expect(query('.picker .empty').textContent).toContain('素材库为空')
  expect(h.update).not.toHaveBeenCalled()
})

it('distinguishes a failed asset request and retries once on fast repeated activation', async () => {
  h.assets.mockRejectedValueOnce(new Error('模拟素材离线'))
  await mount(photoBlock())
  await press(photoChoice())
  expect(query('.picker').textContent).toContain('模拟素材离线')
  expect(query('.picker .empty')).toBeNull()
  expect(h.notify).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('模拟素材离线'), 'error')
  const pending = deferred<Asset[]>()
  h.assets.mockReturnValueOnce(pending.promise)
  const retry = button('重试加载素材')
  act(() => { retry.click(); retry.click() })
  expect(h.assets).toHaveBeenCalledTimes(2)
  expect(query('.picker').textContent).toContain('正在加载素材')
  await act(async () => pending.resolve([asset('recovered')]))
  expect(query('.picker img').getAttribute('alt')).toBe('recovered')
  expect(h.update).not.toHaveBeenCalled()
})

it('does not show an old background request after the selector was closed and reopened', async () => {
  const old = deferred<Asset[]>(), fresh = deferred<Asset[]>()
  h.assets.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  await mount(createBlock('html', { html: '<section style="background-image:url(/media/old-bg.jpg)"></section>' }))
  await press(backgroundChoice())
  await press(backgroundChoice())
  expect(query('.picker')).toBeNull()
  await press(backgroundChoice())
  await act(async () => old.resolve([asset('old-response')]))
  expect(host.querySelector('img[alt="old-response"]')).toBeNull()
  await act(async () => fresh.resolve([asset('latest-response')]))
  expect(query('.picker img').getAttribute('alt')).toBe('latest-response')
})

it('does not inherit assets or notify from an obsolete picker after switching modules', async () => {
  const old = deferred<Asset[]>(), fresh = deferred<Asset[]>()
  h.assets.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  await mount(photoBlock())
  await press(photoChoice())
  await mount(photoBlock())
  await press(photoChoice())
  await act(async () => old.reject(new Error('stale asset failure')))
  expect(h.notify).not.toHaveBeenCalled()
  await act(async () => fresh.resolve([asset('fresh')]))
  expect(query('.picker img').getAttribute('alt')).toBe('fresh')
  expect(h.update).not.toHaveBeenCalled()
})

it('locates the canvas frame by exact ID and never throws when replacing a selected photo for a quoted ID', async () => {
  const block = { ...photoBlock(), id: 'photo" [\\:中文' }
  const frame = document.createElement('div')
  frame.dataset.blockId = block.id
  const content = document.createElement('div'); content.className = 'block-html'
  const image = document.createElement('img'); content.append(image); frame.append(content)
  const canvas = document.createElement('div'); canvas.dataset.testid = 'canvas'; canvas.append(frame); document.body.append(canvas)
  const child = document.createElement('div'); child.dataset.blockId = 'nested-child'
  const decoy = document.createElement('img'); child.append(decoy); content.prepend(child)
  const outside = canvas.cloneNode(true)
  if (outside instanceof HTMLElement) { outside.removeAttribute('data-testid'); document.body.prepend(outside) }
  const errors: unknown[] = []
  const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault() }
  window.addEventListener('error', onError)
  try {
    h.assets.mockResolvedValueOnce([asset('replacement')])
    await mount(block)
    await press(photoChoice())
    await press(query('.picker .asset'))
    expect(errors).toEqual([])
    expect(h.ratio).toHaveBeenCalledExactlyOnceWith(image)
    expect(patch().html).toContain('/media/replacement.jpg')
    expect(h.update.mock.lastCall![0]).toBe(block.id)
  } finally { canvas.remove(); outside.parentNode?.removeChild(outside); window.removeEventListener('error', onError) }
})

it('shares one asset request between inline and background selectors and preserves cached nonempty assets', async () => {
  const pending = deferred<Asset[]>()
  h.assets.mockReturnValueOnce(pending.promise)
  await mount(createBlock('html', { html: '<img src="/media/photo.jpg"><section style="background-image:url(/media/background.jpg)"></section>' }))
  await press(photoChoice())
  await press(backgroundChoice())
  expect(h.assets).toHaveBeenCalledOnce()
  await act(async () => pending.resolve([asset('shared')]))
  expect(host.querySelectorAll('.picker img[alt="shared"]')).toHaveLength(2)
  await press(photoChoice())
  await press(backgroundChoice())
  expect(query('.picker')).toBeNull()
  await press(photoChoice())
  expect(query('.picker img').getAttribute('alt')).toBe('shared')
  expect(h.assets).toHaveBeenCalledOnce()
})

it('does not display or notify a late failure after StrictMode picker unmount', async () => {
  const pending = deferred<Asset[]>()
  h.assets.mockReturnValueOnce(pending.promise)
  await mount(photoBlock(), true)
  await press(photoChoice())
  expect(h.assets).toHaveBeenCalledOnce()
  await act(async () => root.render(null))
  await act(async () => pending.reject(new Error('obsolete failure')))
  expect(h.notify).not.toHaveBeenCalled()
  expect(h.update).not.toHaveBeenCalled()
  expect(query('.picker')).toBeNull()
})

const labeled = (label: string) => [...host.querySelectorAll('label.field')].find(field => field.querySelector('span')?.textContent === label)!

it('scopes cover text, alignment, variant and image removal to the same block with distinct undo keys', async () => {
  const block = createBlock('cover', { image: { src: '/media/cover.jpg' } })
  await mount(block)
  change(labeled('标题').querySelector('textarea')!, '新的封面\n标题')
  expect(h.update).toHaveBeenLastCalledWith(block.id, { title: '新的封面\n标题' }, block.id + ':title')
  await press(query('[data-testid="title-alignment-boundary"]'))
  expect(h.update).toHaveBeenLastCalledWith(block.id, { titleAlign: 'center' }, block.id + ':titleAlign')
  await press(button('极简'))
  expect(h.update).toHaveBeenLastCalledWith(block.id, { variant: 'minimal' }, block.id + ':variant')
  await press(button('移除'))
  expect(h.update).toHaveBeenLastCalledWith(block.id, { image: undefined }, block.id + ':image')
  expect(host.textContent).toContain('在左侧「素材」中点击图片即可设置')
  expect(block.props.image?.src).toBe('/media/cover.jpg')
})
it('updates timeline time and description then deletes and appends using the latest controlled items', async () => {
  const original = [{ time: '08:00', title: '第一项', desc: '原说明' }, { time: '09:00', title: '第二项', desc: '次说明' }]
  const block = createBlock('timeline', { items: original })
  await mount(block)
  change(query('input[placeholder="时间"]'), '08:30')
  expect(h.update.mock.lastCall![2]).toBe(block.id + ':items0t')
  change(query('input[placeholder="说明"]'), '修改说明')
  expect(patch().items).toEqual([{ ...original[0], time: '08:30', desc: '修改说明' }, original[1]])
  expect(h.update.mock.lastCall![2]).toBe(block.id + ':items0d')
  await press(query('.row-edit button'))
  expect(patch()).toEqual({ items: [original[1]] })
  await press(button('＋ 添加节点'))
  expect(patch()).toEqual({ items: [original[1], { time: '', title: '新环节', desc: '' }] })
  expect(original[0]).toEqual({ time: '08:00', title: '第一项', desc: '原说明' })
})
it('sets gallery column count without converting the numeric choice or rewriting images', async () => {
  const images = [{ src: '/media/a.jpg' }, { src: 'https://example.invalid/fixture.jpg' }]
  const block = createBlock('gallery', { images })
  await mount(block); await press(button('3 列'))
  expect(h.update).toHaveBeenCalledExactlyOnceWith(block.id, { columns: 3 }, block.id + ':columns')
  expect(host.querySelectorAll('.g-item img')).toHaveLength(2)
  expect(host.querySelectorAll('img')[1].getAttribute('src')).toBe(images[1].src)
})
it('preserves carousel slot identity and captions through edit, reorder, clear, removal and append', async () => {
  const pics = [{ image: { src: '/media/one.jpg?existing=1' }, caption: '原图注1' }, { image: { src: '/media/two.jpg' }, caption: '原图注2' }]
  const original = structuredClone(pics)
  const block = createBlock('carousel', { pics })
  await mount(block)
  expect(query<HTMLImageElement>('.pic-row img').getAttribute('src')).toBe('/media/one.jpg?fit=1:1&w=120')
  change(query('.pic-row input'), '新图注')
  expect(h.update.mock.lastCall![2]).toBe(block.id + ':pic0')
  await press(host.querySelectorAll('.pic-row')[1].querySelector('button[title="前移"]')!)
  expect(patch().pics.map((p: { caption: string }) => p.caption)).toEqual(['原图注2', '新图注'])
  await press(query('button[title="清空图片（保留图片位）"]'))
  expect(patch().pics).toEqual([{ image: undefined, caption: '原图注2' }, { ...pics[0], caption: '新图注' }])
  expect(query('.pic-empty').textContent).toBe('图片 1')
  await press(query('button[title="删除这个图片位"]'))
  expect(patch().pics).toEqual([{ ...pics[0], caption: '新图注' }])
  await press(button('＋ 添加图片位'))
  expect(patch().pics).toEqual([{ ...pics[0], caption: '新图注' }, { caption: '' }])
  await press(button('整张')); expect(patch()).toEqual({ variant: 'full' })
  await press(button('16:9')); expect(patch()).toEqual({ ratio: '16:9' })
  expect(pics).toEqual(original)
})
it('keeps fixed photo slots non-removable and updates layout, crop ratio and count explicitly', async () => {
  const pics = [{ caption: '甲' }, { caption: '乙' }, { caption: '丙' }]
  const block = createBlock('photos', { count: 3, layout: 'even', pics })
  await mount(block)
  expect(host.querySelector('button[title="删除这个图片位"]')).toBeNull()
  expect(button('＋ 添加图片位')).toBeUndefined()
  await press(button('1:1')); expect(patch()).toEqual({ ratio: '1:1' })
  await press(button('上一下二')); expect(patch()).toEqual({ layout: 'feature' })
  expect(button('1:1')).toBeUndefined()
  await press(button('双图'))
  expect(patch()).toEqual({ count: 2, pics: pics.slice(0, 2) })
  expect(pics).toHaveLength(3)
})
it('switches the frame label semantics and keeps image removal separate from label editing', async () => {
  const block = createBlock('frame', { image: { src: '/media/frame.jpg' }, variant: 'flag', label: 'BERLIN' })
  await mount(block); await press(button('车票'))
  expect(patch()).toEqual({ variant: 'ticket' })
  change(labeled('票根文字（如 MÜNCHEN → BERLIN）').querySelector('input')!, 'MÜNCHEN → BERLIN')
  expect(h.update).toHaveBeenLastCalledWith(block.id, { label: 'MÜNCHEN → BERLIN' }, block.id + ':label')
  await press(button('移除')); expect(patch()).toEqual({ image: undefined })
})

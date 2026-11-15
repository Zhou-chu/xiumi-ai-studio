// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Doc } from '../../src/core/types'
import type { ResizeTarget } from '../../src/editor/imageResizeTarget'
import { ImageResize } from '../../src/editor/ImageResize'

interface State { doc: Doc; selectedId: string | null; selectedIds: string[]; editingId: string | null; pickingId: string | null; commit: (doc: Doc) => void; notify: (message: string) => void }
const doubles = vi.hoisted(() => ({
  state: {} as State, notify: vi.fn(), commit: vi.fn(),
  listeners: new Set<(next: State, previous: State) => void>(),
  resolve: vi.fn<(image: HTMLImageElement, doc: Doc) => ResizeTarget | null>(),
  resize: vi.fn<(doc: Doc, pos: { blockId: string; index: number }, percent: number) => Doc>(),
}))
vi.mock('../../src/editor/store', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: (next: State, previous: State) => void) => {
    doubles.listeners.add(listener)
    return () => { doubles.listeners.delete(listener) }
  }
  return { useStore: Object.assign((selector: (state: State) => unknown) => useSyncExternalStore(subscribe, () => selector(doubles.state)), {
    getState: () => doubles.state, subscribe,
  }) }
})
vi.mock('../../src/editor/imageResizeTarget', () => ({
  resolveResizeTarget: doubles.resolve, resizePhoto: doubles.resize,
}))
const setState = (updates: Partial<State>) => {
  const old = doubles.state
  doubles.state = { ...old, ...updates }
  for (const listen of [...doubles.listeners]) listen(doubles.state, old)
}
let host: HTMLDivElement, article: HTMLDivElement, root: Root, image: HTMLImageElement, mounted: boolean
let frames: Map<number, FrameRequestCallback>
const rect = (x: number, y: number, w: number, h: number) => new DOMRect(x, y, w, h)
const flush = () => act(() => { const queued = [...frames.values()]; frames.clear(); queued.forEach(f => f(0)) })
const handle = () => host.querySelector<HTMLButtonElement>('[data-testid=image-resize-handle]')!
const pick = () => { act(() => image.click()); flush() }
function pointer(type: string, x = 0, id = 1, target = handle()) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x })
  Object.defineProperty(event, 'pointerId', { value: id })
  target.dispatchEvent(event)
}
function key(value: string, shiftKey = false, target = handle()) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }))
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  frames = new Map()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { frames.set(++id, f); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  doubles.listeners.clear()
  const block = { id: 'image', type: 'image' as const, props: { caption: '', variant: 'full' as const, image: { src: '/media/fixture.jpg' } } }
  const doc: Doc = { id: 'doc', title: '', author: '', digest: '', themeId: 'minimal-magazine', blocks: [block], createdAt: 1, updatedAt: 1 }
  doubles.state = { doc, selectedId: block.id, selectedIds: [block.id], editingId: null, pickingId: null, commit: doubles.commit, notify: doubles.notify }
  article = document.createElement('div')
  article.innerHTML = '<div class="canvas-scroll"><article class="article"><div data-block-id="image"><div class="block-html"><img src="/media/fixture.jpg" style="color:red;width:50%"></div></div></article></div>'
  host = document.createElement('div')
  document.body.append(article, host)
  image = article.querySelector('img')!
  doubles.resolve.mockImplementation((candidate, current) => candidate === image && current === doc ? { img: candidate, pos: { blockId: block.id, index: 0 }, block, docId: doc.id } : null)
  doubles.resize.mockImplementation(() => { throw Error('Unexpected resizePhoto call') })
  doubles.commit.mockImplementation(() => { throw Error('Unexpected commit call') })
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect(20, 20, 200, 100))
  vi.spyOn(image.parentElement!, 'getBoundingClientRect').mockReturnValue(rect(20, 20, 400, 200))
  vi.spyOn(article.querySelector('.canvas-scroll')!, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 500, 500))
  root = createRoot(host)
  act(() => root.render(createElement(ImageResize)))
  mounted = true
})
afterEach(() => {
  if (mounted) act(() => root.unmount())
  host.remove(); article.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function startDrag() {
  pick()
  Object.defineProperty(handle(), 'setPointerCapture', { value: vi.fn() })
  act(() => pointer('pointerdown', 20))
  act(() => pointer('pointermove', 120))
  expect(image.style.width).toBe('75%')
}
it('drags provisionally and delegates just one final change for the owning pointer', () => {
  const { doc } = doubles.state
  const next = { ...doc, blocks: [...doc.blocks] }
  doubles.resize.mockReturnValueOnce(next)
  doubles.commit.mockImplementationOnce(() => undefined)
  startDrag()
  expect(doubles.commit).not.toHaveBeenCalled()
  act(() => pointer('pointerup', 120, 2))
  expect(image.style.width).toBe('75%')
  act(() => { pointer('pointerup', 120); pointer('pointerup', 120) })
  expect(doubles.resize).toHaveBeenCalledExactlyOnceWith(doc, { blockId: 'image', index: 0, docId: 'doc' }, 75)
  expect(doubles.commit).toHaveBeenCalledExactlyOnceWith(next)
  expect(image.getAttribute('style')).toBe('color:red;width:50%')
})
it.each(['Escape', 'pointercancel', 'unmount'] as const)('restores exact transient styles without committing on %s', mode => {
  startDrag()
  if (mode === 'unmount') { act(() => root.unmount()); mounted = false }
  else if (mode === 'Escape') act(() => key('Escape'))
  else act(() => pointer('pointercancel'))
  expect(image.getAttribute('style')).toBe('color:red;width:50%')
  expect(doubles.resize).not.toHaveBeenCalled()
  expect(doubles.commit).not.toHaveBeenCalled()
  if (mode === 'unmount') { expect(frames.size).toBe(0); expect(doubles.listeners.size).toBe(0) }
})
it('requires fresh controls after a same-act selection ABA, then permits a fresh keyboard change', () => {
  pick()
  const button = handle()
  act(() => {
    setState({ selectedIds: ['image', 'other'] })
    setState({ selectedIds: ['image'] })
    key('End', false, button)
  })
  expect(doubles.resize).not.toHaveBeenCalled()
  doubles.resize.mockReturnValueOnce(doubles.state.doc)
  act(() => key('ArrowUp', true))
  expect(doubles.resize).toHaveBeenCalledExactlyOnceWith(doubles.state.doc, { blockId: 'image', index: 0, docId: 'doc' }, 60)
  expect(doubles.commit).not.toHaveBeenCalled()
})
it.each([['ArrowLeft',false,49],['ArrowDown',true,40],['Home',false,10],['End',false,100]] as const)('routes %s shift=%s to the exact bounded width', (value,shift,expected)=>{
  pick();doubles.resize.mockReturnValue(doubles.state.doc)
  act(()=>key(value,shift))
  expect(doubles.resize).toHaveBeenCalledExactlyOnceWith(doubles.state.doc,{blockId:'image',index:0,docId:'doc'},expected)
  expect(doubles.commit).not.toHaveBeenCalled()
})
it('ignores unrelated keys, nonprimary pointer and invalid parent size without capturing or changing an image',()=>{
  pick();const capture=vi.fn();Object.defineProperty(handle(),'setPointerCapture',{value:capture})
  act(()=>key('PageDown'))
  act(()=>{const event=new MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:2});Object.defineProperty(event,'pointerId',{value:1});handle().dispatchEvent(event)})
  vi.mocked(image.parentElement!.getBoundingClientRect).mockReturnValue(rect(0,0,0,100))
  act(()=>{pointer('pointerdown');pointer('pointermove',120);pointer('pointerup',120)})
  expect(capture).not.toHaveBeenCalled();expect(doubles.resize).not.toHaveBeenCalled();expect(doubles.commit).not.toHaveBeenCalled()
  expect(image.getAttribute('style')).toBe('color:red;width:50%')
})
it('ignores nonowning moves and no-motion release, then restores an originally absent style after lost capture',()=>{
  image.removeAttribute('style');pick();Object.defineProperty(handle(),'setPointerCapture',{value:vi.fn()})
  act(()=>pointer('pointerdown',20));act(()=>pointer('pointermove',120,2))
  expect(image.hasAttribute('style')).toBe(false)
  act(()=>pointer('pointerup',20));expect(doubles.resize).not.toHaveBeenCalled()
  act(()=>pointer('pointerdown',20));act(()=>pointer('pointermove',120));expect(image.style.width).toBe('75%')
  act(()=>pointer('lostpointercapture'));expect(image.hasAttribute('style')).toBe(false)
  expect(doubles.commit).not.toHaveBeenCalled()
})
it('rejects a detached measured image on key input without delegating a resize',()=>{
  pick();const button=handle();image.remove();act(()=>key('End',false,button))
  expect(doubles.notify).toHaveBeenCalledExactlyOnceWith('图片所在模块已变化，请重新选择后调整')
  expect(doubles.resize).not.toHaveBeenCalled();expect(doubles.commit).not.toHaveBeenCalled()
})
it('clears target on outside clicks, and refuses an unresolved photo explicitly',()=>{
  pick();act(()=>document.body.click());flush();expect(handle()).toBeNull()
  doubles.resolve.mockReturnValue(null);pick()
  expect(handle()).toBeNull();expect(doubles.notify).toHaveBeenCalledWith(expect.stringContaining('位置无法安全确认'))
  expect(doubles.resize).not.toHaveBeenCalled()
})
it.each([
  [rect(10,10,20,20),rect(0,0,100,100),'30px','30px'],
  [rect(80,80,20,20),rect(0,0,100,100),'36px','36px'],
  [rect(-10,-10,80,80),rect(0,0,100,100),'26px','26px'],
] as const)('keeps a measured handle inside canvas bounds using synthetic geometry %#',(imageRect,canvasRect,left,top)=>{
  vi.mocked(image.getBoundingClientRect).mockReturnValue(imageRect)
  vi.mocked(article.querySelector('.canvas-scroll')!.getBoundingClientRect).mockReturnValue(canvasRect)
  pick();expect(handle().style.left).toBe(left);expect(handle().style.top).toBe(top)
  flush();expect(handle().style.left).toBe(left)
  expect(doubles.commit).not.toHaveBeenCalled()
})
it('hides resize controls when the visible canvas cannot accommodate the minimum handle',()=>{
  vi.mocked(article.querySelector('.canvas-scroll')!.getBoundingClientRect).mockReturnValue(rect(0,0,40,40))
  pick();expect(handle()).toBeNull();expect(doubles.resize).not.toHaveBeenCalled()
})
it('rebinds only its own authoritative committed document and preserves the next keyboard step',()=>{
  pick();const old=doubles.state.doc, block={...old.blocks[0]},next={...old,blocks:[block]}
  doubles.resize.mockReturnValueOnce(next)
  const actual={...next,updatedAt:99}
  doubles.resolve.mockImplementation((candidate,current)=>candidate===image&&(current===old||current===actual)?{img:image,pos:{blockId:'image',index:0},block:current.blocks[0],docId:current.id}:null)
  doubles.commit.mockImplementationOnce(()=>setState({doc:actual}))
  act(()=>key('ArrowRight'))
  expect(doubles.commit).toHaveBeenCalledExactlyOnceWith(next)
  expect(host.textContent).toContain('51%')
  doubles.resize.mockReturnValueOnce(actual)
  act(()=>key('ArrowRight'))
  expect(doubles.resize).toHaveBeenLastCalledWith(actual,{blockId:'image',index:0,docId:'doc'},52)
  expect(doubles.commit).toHaveBeenCalledOnce()
})

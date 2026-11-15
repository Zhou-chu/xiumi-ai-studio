// @vitest-environment jsdom
import { act, createElement as el } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Workspace } from '../../src/editor/Workspace'

const key = 'xiumi-panel-widths'
let root: Root, host: HTMLDivElement
let measure: ResizeObserverCallback | undefined
let viewport: number
let narrow: boolean
const observe = vi.fn(), disconnect = vi.fn()
const width = () => host.querySelector<HTMLElement>('main')!
const handle = (side: 'left' | 'right') => host.querySelector<HTMLElement>('[data-testid="resizer-' + side + '"]')!
const press = (target: HTMLElement, key: string, shiftKey = false) => {
  const e = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  act(() => target.dispatchEvent(e))
  return e
}
const pointer = (target: HTMLElement, type: string, clientX = 0, pointerId = 7, isPrimary = true, button = 0) => {
  const e = new MouseEvent(type, { clientX, button, bubbles: true, cancelable: true })
  Object.defineProperties(e, { pointerId: { value: pointerId }, isPrimary: { value: isPrimary } })
  act(() => target.dispatchEvent(e))
  return e
}
const shown = (side: string) => width().style.getPropertyValue('--' + side + '-w')
const stored = () => JSON.parse(localStorage.getItem(key) ?? '{}')
const mount = () => act(() => root.render(el(Workspace, { children: [
  el('aside', { className: 'panel left', key: 'left' }, el('input', { 'aria-label': '左侧焦点' })),
  el('article', { className: 'canvas', key: 'canvas' }, '文稿'),
  el('aside', { className: 'panel right', key: 'right' }, el('input', { 'aria-label': '右侧焦点' })),
] })))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { measure = callback }
    observe = observe
    disconnect = disconnect
  })
  narrow = false
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: narrow })))
  observe.mockClear(); disconnect.mockClear()
  viewport = 1400; measure = undefined
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewport)
  localStorage.removeItem(key)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  try { act(() => root.unmount()); expect(document.body.classList.contains('resizing')).toBe(false) }
  finally { host.remove(); localStorage.removeItem(key); vi.restoreAllMocks(); vi.unstubAllGlobals() }
})

it('switches mobile panels and reveals the focused sidebar on window resize', () => {
  mount()
  const buttons = [...host.querySelectorAll('nav button')]
  expect(buttons.map(b => b.textContent)).toEqual(['资源', '画布', '属性'])
  expect(buttons.map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
  act(() => (buttons[2] as HTMLButtonElement).click())
  expect(width().dataset.workspaceView).toBe('right')
  act(() => { host.querySelector<HTMLInputElement>('input[aria-label="左侧焦点"]')!.focus(); window.dispatchEvent(new Event('resize')) })
  expect(width().dataset.workspaceView).toBe('left')
  act(() => { host.querySelector<HTMLInputElement>('input[aria-label="右侧焦点"]')!.focus(); window.dispatchEvent(new Event('resize')) })
  expect(width().dataset.workspaceView).toBe('right')
  expect(observe).toHaveBeenCalledExactlyOnceWith(width())
  act(() => root.render(null))
  expect(disconnect).toHaveBeenCalledOnce()
})
it('validates remembered widths and clamps display under resize without overwriting preference', () => {
  localStorage.setItem(key, '{"left":900,"right":420,"ignored":20}')
  mount()
  expect(shown('left')).toBe('560px')
  expect(shown('right')).toBe('420px')
  viewport = 970
  act(() => measure?.([], {} as ResizeObserver))
  expect(shown('left')).toBe('200px')
  expect(shown('right')).toBe('410px')
  expect(stored()).toEqual({ left: 900, right: 420, ignored: 20 })
})
it('handles corrupt or wrong-type storage and derives independent narrow defaults', () => {
  localStorage.setItem(key, '{')
  mount(); expect(shown('left')).toBe(''); expect(shown('right')).toBe('')
  act(() => root.render(null))
  localStorage.setItem(key, '{"left":650,"right":"300"}')
  viewport = 970; narrow = true
  mount()
  expect(shown('left')).toBe('330px')
  expect(shown('right')).toBe('')
})
it('resizes keyboard-focused separators in opposite directions, with shift acceleration and double-click reset', () => {
  localStorage.setItem(key, '{"left":280,"right":320}')
  mount()
  expect(handle('left').getAttribute('aria-orientation')).toBe('vertical')
  expect(press(handle('left'), 'ArrowRight').defaultPrevented).toBe(true)
  expect(stored()).toEqual({ left: 296, right: 320 })
  expect(press(handle('right'), 'ArrowRight', true).defaultPrevented).toBe(true)
  expect(stored()).toEqual({ left: 296, right: 272 })
  expect(press(handle('right'), 'Home').defaultPrevented).toBe(false)
  act(() => handle('left').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(stored()).toEqual({ right: 272 })
  expect(shown('left')).toBe('')
})
it('uses pointer displacement and persists only on release, without moving the opposite handle', () => {
  localStorage.setItem(key, '{"left":280,"right":320}')
  mount()
  const left = handle('left'), right = handle('right')
  const setCapture = vi.fn(), releaseCapture = vi.fn(() => {
    const e = new MouseEvent('lostpointercapture', { bubbles: true })
    Object.defineProperty(e, 'pointerId', { value: 7 })
    left.dispatchEvent(e)
  })
  Object.assign(left, { setPointerCapture: setCapture, releasePointerCapture: releaseCapture })
  expect(pointer(left, 'pointerdown', 125).defaultPrevented).toBe(true)
  expect(setCapture).toHaveBeenCalledExactlyOnceWith(7)
  expect(document.body.classList.contains('resizing')).toBe(true)
  pointer(right, 'pointermove', 185)
  expect(shown('right')).toBe('320px')
  pointer(left, 'pointermove', 185)
  expect(shown('left')).toBe('340px')
  expect(stored()).toEqual({ left: 280, right: 320 })
  pointer(left, 'pointerup', 185)
  expect(releaseCapture).toHaveBeenCalledExactlyOnceWith(7)
  expect(document.body.classList.contains('resizing')).toBe(false)
  expect(stored()).toEqual({ left: 340, right: 320 })
})
it('keeps keyboard resizing functional when browser persistence is unavailable', () => {
  localStorage.setItem(key, '{"left":280,"right":320}')
  mount()
  const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
  expect(press(handle('left'), 'ArrowRight').defaultPrevented).toBe(true)
  expect(save).toHaveBeenCalledWith(key, '{"left":296,"right":320}')
  expect(shown('left')).toBe('296px')
  expect(stored().left).toBe(280)
})
it.each(['pointercancel', 'lostpointercapture'])('rolls back an uncommitted preview after %s', (ended) => {
  localStorage.setItem(key, '{"left":280,"right":320}')
  mount()
  const left = handle('left')
  Object.assign(left, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  pointer(left, 'pointerdown', 100)
  pointer(left, 'pointermove', 180)
  expect(shown('left')).toBe('360px')
  pointer(left, ended, 180)
  expect(shown('left')).toBe('280px')
  expect(document.body.classList.contains('resizing')).toBe(false)
  expect(left.classList.contains('on')).toBe(false)
  expect(stored()).toEqual({ left: 280, right: 320 })
  pointer(left, 'pointermove', 250)
  expect(shown('left')).toBe('280px')
})
it('does not let a second pointer or the opposite separator commit an active drag', () => {
  localStorage.setItem(key, '{"left":280,"right":320}')
  mount()
  const left = handle('left'), right = handle('right')
  const release = vi.fn()
  Object.assign(left, { setPointerCapture: vi.fn(), releasePointerCapture: release })
  const oppositeCapture = vi.fn()
  Object.assign(right, { setPointerCapture: oppositeCapture, releasePointerCapture: vi.fn() })
  pointer(left, 'pointerdown', 120)
  pointer(right, 'pointerdown', 740, 8)
  pointer(left, 'pointermove', 220, 8)
  pointer(left, 'pointerup', 220, 8)
  expect(oppositeCapture).not.toHaveBeenCalled()
  expect(release).not.toHaveBeenCalled()
  expect(shown('left')).toBe('280px')
  expect(document.body.classList.contains('resizing')).toBe(true)
  pointer(left, 'pointermove', 160)
  pointer(left, 'pointerup', 160)
  expect(release).toHaveBeenCalledExactlyOnceWith(7)
  expect(stored()).toEqual({ left: 320, right: 320 })
})

it('ignores non-primary and non-left starts and never persists a drag via keyboard or reset mid-preview', () => {
  localStorage.setItem(key, '{"right":320}')
  mount()
  const left = handle('left'), right = handle('right')
  const capture = vi.fn()
  Object.assign(left, { setPointerCapture: capture, releasePointerCapture: vi.fn() })
  pointer(left, 'pointerdown', 100, 7, false)
  pointer(left, 'pointerdown', 100, 7, true, 2)
  expect(capture).not.toHaveBeenCalled()
  expect(document.body.classList.contains('resizing')).toBe(false)
  pointer(left, 'pointerdown', 100)
  pointer(left, 'pointermove', 170)
  expect(shown('left')).toBe('270px')
  expect(press(left, 'ArrowRight').defaultPrevented).toBe(true)
  expect(press(right, 'ArrowRight').defaultPrevented).toBe(true)
  act(() => right.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(shown('left')).toBe('270px')
  expect(shown('right')).toBe('320px')
  expect(stored()).toEqual({ right: 320 })
  pointer(left, 'pointercancel')
  expect(shown('left')).toBe('')
  expect(press(right, 'ArrowRight').defaultPrevented).toBe(true)
  expect(stored()).toEqual({ right: 304 })
})

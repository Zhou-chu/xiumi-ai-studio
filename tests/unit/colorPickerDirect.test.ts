// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ColorPicker, COMMON_COLORS } from '../../src/editor/ColorPicker'

let host: HTMLDivElement
let root: Root
let editorFixture: HTMLTextAreaElement | undefined
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); editorFixture?.remove(); editorFixture = undefined; vi.restoreAllMocks() })
const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const pop = () => host.querySelector('[data-testid="color-picker-pop"]')
const click = (node: HTMLElement) => act(() => node.click())
function render(props: Parameters<typeof ColorPicker>[0]) { act(() => root.render(createElement(ColorPicker, props))) }

it('renders normalized current color, nonempty groups and common choices with explicit alignment', () => {
  const pick = vi.fn()
  render({ value: 'rgb(192, 57, 43)', alignRight: true, onPick: pick, groups: [
    { label: '空组', colors: [] }, { label: '主题', colors: [{ color: '#123456', label: '品牌' }] },
  ] })
  expect(button('文字颜色').getAttribute('aria-expanded')).toBe('false')
  expect(pop()).toBeNull()
  click(button('文字颜色'))
  expect(pop()?.classList.contains('right')).toBe(true)
  expect([...host.querySelectorAll('.color-group small')].map(x => x.textContent)).toEqual(['主题', '常用色'])
  expect(host.querySelectorAll('.color-swatch')).toHaveLength(COMMON_COLORS.length + 1)
  expect(button('红色').classList.contains('on')).toBe(true)
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('#c0392b')
  click(button('品牌'))
  expect(pick).toHaveBeenCalledExactlyOnceWith('#123456')
  expect(pop()).toBeNull()
})
it('preserves editor focus on mouse down and commits only on activation', () => {
  const editor = document.createElement('textarea'); editorFixture = editor; document.body.append(editor); editor.focus()
  const pick = vi.fn(); render({ onPick: pick })
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  act(() => button('文字颜色').dispatchEvent(down))
  expect(down.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(editor)
  expect(pop()).toBeNull(); expect(pick).not.toHaveBeenCalled()
  click(button('文字颜色'))
  const swatchDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  act(() => button('蓝色').dispatchEvent(swatchDown))
  expect(swatchDown.defaultPrevented).toBe(true)
  expect(pick).not.toHaveBeenCalled()
  click(button('蓝色'))
  expect(pick).toHaveBeenCalledExactlyOnceWith('#2e86de')
  editor.remove()
})
it('supports explicit reset semantics and a null reset instead of inventing an inherited color', () => {
  const pick = vi.fn(); render({ value: null, onPick: pick, resetLabel: '跟随模板' })
  click(button('文字颜色'))
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('#333333')
  const reset = host.querySelector<HTMLButtonElement>('[data-testid="color-picker-reset"]')!
  expect(reset.textContent).toBe('跟随模板')
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  act(() => reset.dispatchEvent(down)); expect(down.defaultPrevented).toBe(true)
  click(reset); expect(pick).toHaveBeenCalledExactlyOnceWith(null); expect(pop()).toBeNull()
})
it('commits a native custom-color change once, ignores drag input, and uses the latest callback', () => {
  const old = vi.fn(), latest = vi.fn(); render({ onPick: old })
  click(button('文字颜色'))
  const input = host.querySelector<HTMLInputElement>('input')!
  input.value = '#abcdef'
  act(() => input.dispatchEvent(new Event('input', { bubbles: true })))
  expect(old).not.toHaveBeenCalled(); expect(pop()).not.toBeNull()
  render({ onPick: latest })
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(old).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledExactlyOnceWith('#abcdef')
  expect(pop()).toBeNull()
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
  expect(latest).toHaveBeenCalledTimes(1)
})
it('captures Escape before editor handlers, ignores other keys and removes capture after closing', () => {
  const pick = vi.fn(), downstream = vi.fn()
  window.addEventListener('keydown', downstream)
  try {
    render({ onPick: pick }); click(button('文字颜色'))
    const other = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    act(() => document.body.dispatchEvent(other))
    expect(other.defaultPrevented).toBe(false); expect(pop()).not.toBeNull()
    downstream.mockClear()
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => document.body.dispatchEvent(esc))
    expect(esc.defaultPrevented).toBe(true); expect(downstream).not.toHaveBeenCalled(); expect(pop()).toBeNull()
    const closed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => document.body.dispatchEvent(closed))
    expect(closed.defaultPrevented).toBe(false); expect(downstream).toHaveBeenCalledTimes(1)
    expect(pick).not.toHaveBeenCalled()
  } finally { window.removeEventListener('keydown', downstream) }
})
it('keeps the popover for internal mouse down, dismisses outside and detaches native listeners on unmount', () => {
  const pick = vi.fn(); render({ onPick: pick }); click(button('文字颜色'))
  act(() => pop()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(pop()).not.toBeNull()
  act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(pop()).toBeNull(); expect(pick).not.toHaveBeenCalled()
  click(button('文字颜色')); const input = host.querySelector<HTMLInputElement>('input')!
  act(() => root.render(null))
  const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => { input.dispatchEvent(new Event('change')); document.body.dispatchEvent(esc) })
  expect(esc.defaultPrevented).toBe(false); expect(pick).not.toHaveBeenCalled()
})

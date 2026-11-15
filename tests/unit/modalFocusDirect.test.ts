// @vitest-environment jsdom
import { act, createElement as el, Fragment, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Modal } from '../../src/editor/Modal'
let host: HTMLDivElement, trigger: HTMLButtonElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  trigger = document.createElement('button'); trigger.textContent = 'Open'; document.body.append(trigger); trigger.focus()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); trigger.remove(); vi.unstubAllGlobals() })
const mount = (close: () => void, children: ReactNode = el('input', { 'aria-label': 'field' })) => act(() => root.render(el(Modal, { title: '测试弹窗', onClose: close, children, width: 640 })))
const key = (name: string, shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true })
  act(() => document.activeElement!.dispatchEvent(event)); return event
}
it('labels the dialog, focuses its first control and returns to the connected opening control on unmount', () => {
  mount(vi.fn())
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.getAttribute('aria-modal')).toBe('true'); expect(dialog.getAttribute('aria-label')).toBe('测试弹窗')
  expect(dialog.style.width).toBe('640px')
  expect(document.activeElement).toBe(host.querySelector('button.close'))
  act(() => root.render(null)); expect(document.activeElement).toBe(trigger)
})
it('ignores content mousedown and closes on backdrop mousedown or close activation only', () => {
  const close = vi.fn(); mount(close)
  act(() => host.querySelector('.modal-body')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(close).not.toHaveBeenCalled()
  act(() => host.querySelector('.modal-mask')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(close).toHaveBeenCalledTimes(1)
  act(() => host.querySelector<HTMLButtonElement>('button.close')!.click())
  expect(close).toHaveBeenCalledTimes(2)
})
it('wraps Tab using visible enabled descendants and pulls an escaped focus back into the dialog', () => {
  mount(vi.fn(), el(Fragment, null,
    el('button', { disabled: true }, 'disabled'), el('button', { hidden: true }, 'hidden'),
    el('section', { hidden: true }, el('button', null, 'hidden-parent')),
    el('input', { 'aria-label': 'last' }),
  ))
  const first = host.querySelector<HTMLButtonElement>('button.close')!, last = host.querySelector<HTMLInputElement>('input')!
  expect(key('Tab', true).defaultPrevented).toBe(true); expect(document.activeElement).toBe(last)
  expect(key('Tab').defaultPrevented).toBe(true); expect(document.activeElement).toBe(first)
  expect(key('Tab').defaultPrevented).toBe(false)
  trigger.focus(); expect(key('Tab').defaultPrevented).toBe(true); expect(document.activeElement).toBe(first)
  trigger.focus(); expect(key('Tab', true).defaultPrevented).toBe(true); expect(document.activeElement).toBe(last)
})
it('uses the latest close callback without reattaching and does not consume unrelated keys', () => {
  const old = vi.fn(), current = vi.fn(); mount(old); mount(current)
  expect(key('ArrowLeft').defaultPrevented).toBe(false)
  expect(key('Escape').defaultPrevented).toBe(true)
  expect(current).toHaveBeenCalledExactlyOnceWith(); expect(old).not.toHaveBeenCalled()
})
it('lets an expanded picker own the first Escape and resumes modal handling after it closes', () => {
  const close = vi.fn(); mount(close, el('div', { 'data-model-picker-open': '' }, 'picker boundary'))
  expect(key('Escape').defaultPrevented).toBe(false); expect(close).not.toHaveBeenCalled()
  mount(close)
  expect(key('Escape').defaultPrevented).toBe(true); expect(close).toHaveBeenCalledTimes(1)
})
it('only the top dialog handles Escape and excludes nested dialog controls from parent tab wrapping', () => {
  const parent = vi.fn(), child = vi.fn()
  act(() => root.render(el(Modal, { title: 'parent', onClose: parent, children: el(Modal, { title: 'child', onClose: child, children: el('input', { 'aria-label': 'nested-last' }) }) })))
  const dialogs = host.querySelectorAll('[role="dialog"]'), nestedFirst = dialogs[1].querySelector<HTMLButtonElement>('button')!, nestedLast = dialogs[1].querySelector<HTMLInputElement>('input')!
  nestedLast.focus()
  expect(key('Tab').defaultPrevented).toBe(true); expect(document.activeElement).toBe(nestedFirst)
  key('Escape'); expect(child).toHaveBeenCalledTimes(1); expect(parent).not.toHaveBeenCalled()
})
it('removes keyboard handling on unmount even when the opening element has been removed', () => {
  const close = vi.fn(); mount(close); trigger.remove()
  act(() => root.render(null))
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => document.body.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false); expect(close).not.toHaveBeenCalled()
})

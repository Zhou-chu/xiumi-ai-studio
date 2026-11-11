// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { Help } from '../../src/editor/Help'
let root: Root, host: HTMLDivElement
beforeEach(() => {
 Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers()
 host = document.createElement('div'); document.body.append(host); root = createRoot(host)
 act(() => root.render(createElement(Help, { title: '参考风格学习', children: '功能解释' })))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const visible = () => !!document.querySelector('[role="tooltip"]')
const mouse = (type: string) => act(() => host.querySelector('.help')!.dispatchEvent(new MouseEvent(type, { bubbles: true })))
it('hides descriptions by default and cancels fleeting hover', () => {
 expect(visible()).toBe(false); mouse('mouseover'); act(() => vi.advanceTimersByTime(649)); expect(visible()).toBe(false)
 mouse('mouseout'); act(() => vi.advanceTimersByTime(700)); expect(visible()).toBe(false)
})
it('opens after sustained hover, keeps annotation hoverable and closes on exit', () => {
 mouse('mouseover'); act(() => vi.advanceTimersByTime(650)); expect(visible()).toBe(true)
 mouse('mouseout'); act(() => vi.advanceTimersByTime(200)); expect(visible()).toBe(false)
})
it('supports touch/click toggling and Escape without firing parent actions', () => {
 const button = host.querySelector('button')!; act(() => button.click()); expect(visible()).toBe(true)
 expect(button.getAttribute('aria-describedby')).toBe(document.querySelector('[role="tooltip"]')!.id)
 act(() => window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))); expect(visible()).toBe(false)
 act(() => button.click()); expect(visible()).toBe(true); act(() => button.click()); expect(visible()).toBe(false)
})
it('dismisses on outside pointer and cancels timers when unmounted', () => {
 act(() => host.querySelector('button')!.click()); act(() => document.body.dispatchEvent(new Event('pointerdown', {bubbles:true}))); expect(visible()).toBe(false)
 mouse('mouseover'); act(() => root.render(null)); act(() => vi.advanceTimersByTime(1000)); expect(visible()).toBe(false)
})

it('keyboard focus exposes the annotation until focus leaves', () => {
 const button = host.querySelector('button')!
 act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
 act(() => button.focus()); expect(visible()).toBe(true)
 mouse('mouseout'); act(() => vi.advanceTimersByTime(700)); expect(visible()).toBe(true)
 act(() => button.blur()); expect(visible()).toBe(false)
})

it('dismisses a dialog annotation before dismissing the dialog', async () => {
 const { Modal } = await import('../../src/editor/Modal')
 const close = vi.fn()
 act(() => root.render(createElement(Modal, { title: '预览', onClose: close, children: createElement(Help, { title: '说明', children: '批注' }) })))
 act(() => host.querySelector('.help-trigger')!.dispatchEvent(new MouseEvent('click', {bubbles:true})))
 expect(visible()).toBe(true)
 act(() => window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true})))
 expect(visible()).toBe(false); expect(close).not.toHaveBeenCalled()
 act(() => window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true})))
 expect(close).toHaveBeenCalledTimes(1)
})

it('renders annotations outside transformed editor ancestors and dismisses on parent scroll', () => {
 act(() => host.querySelector('button')!.click())
 expect(document.querySelector('[role="tooltip"]')!.parentElement).toBe(document.body)
 act(() => window.dispatchEvent(new Event('scroll')))
 expect(document.querySelector('[role="tooltip"]')).toBeNull()
})

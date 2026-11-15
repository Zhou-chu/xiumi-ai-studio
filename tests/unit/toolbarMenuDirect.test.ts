// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ToolbarMenu } from '../../src/editor/ToolbarMenu'

let root: Root, host: HTMLDivElement
const el = <T extends HTMLElement=HTMLElement>(selector: string) => host.querySelector<T>(selector)!
const click = (node: HTMLElement) => act(() => node.click())
const more = () => el<HTMLButtonElement>('[data-testid="toolbar-more"]')
const opened = () => more().getAttribute('aria-expanded')
const esc = () => act(() => window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})))
const targets = vi.fn()
function render(showDialog=false) {
  act(() => root.render(createElement('div',null,
    createElement(ToolbarMenu, null,
      createElement('button',{id:'secondary',onClick:targets},createElement('span',null,'下载')),
      createElement('button',{className:'help-trigger',id:'info'},'说明')),
    showDialog ? createElement('section',{role:'dialog'},'外部受控弹窗') : null,
  )))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  targets.mockClear()
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('toggles a stable controls relationship without remounting secondary actions', () => {
  render()
  const action=el('#secondary'), id=more().getAttribute('aria-controls')
  expect(action.parentElement?.id).toBe(id)
  expect(opened()).toBe('false')
  click(more()); expect(opened()).toBe('true')
  expect(el('#secondary')).toBe(action)
  click(more()); expect(opened()).toBe('false')
  expect(el('#secondary')).toBe(action)
})
it('keeps help open but returns focus to the visible trigger after an ordinary action', () => {
  render();click(more())
  click(el('#info'));expect(opened()).toBe('true')
  el('#secondary').focus()
  click(el('#secondary span'))
  expect(targets).toHaveBeenCalledOnce()
  expect(opened()).toBe('false')
  expect(document.activeElement).toBe(more())
})
it('keeps internal pointer events open and dismisses for an external pointer only', () => {
  render();click(more())
  act(() => el('#secondary').dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})))
  expect(opened()).toBe('true')
  act(() => document.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})))
  expect(opened()).toBe('false')
  expect(targets).not.toHaveBeenCalled()
})
it('gives an open dialog Escape ownership then returns focus when closing the menu itself', () => {
  render(true);click(more())
  el('#secondary').focus()
  esc()
  expect(opened()).toBe('true')
  expect(document.activeElement).toBe(el('#secondary'))
  render(false)
  act(() => window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})))
  expect(opened()).toBe('true')
  esc()
  expect(opened()).toBe('false')
  expect(document.activeElement).toBe(more())
})

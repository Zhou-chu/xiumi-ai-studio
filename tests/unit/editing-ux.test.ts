// @vitest-environment jsdom
import { act, createElement } from 'react'

import { createRoot, type Root } from 'react-dom/client'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { Modal } from '../../src/editor/Modal'

let root: Root

let host: HTMLDivElement
let originalChildren: Set<Element>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  originalChildren = new Set(document.body.children)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  try { act(() => root.unmount()) }
  finally {
    for (const node of [...document.body.children]) if (!originalChildren.has(node)) node.remove()
    vi.unstubAllGlobals()
  }
})

it('focuses dialog on opening and restores trigger after dismissal', () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  act(() => root.render(createElement(Modal, { title: '测试', onClose() {}, children: createElement('button', null, '最后') })))
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭')
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
  act(() => root.render(null))
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

it('Escape closes only the top dialog', () => {
  const closed: string[] = []
  act(() => root.render(createElement(Modal, { title: '父', onClose: () => closed.push('父'), children:
    createElement(Modal, { title: '子', onClose: () => closed.push('子'), children: '内容' }) })))
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(closed).toEqual(['子'])
})

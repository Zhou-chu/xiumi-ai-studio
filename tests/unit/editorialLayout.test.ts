// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Workspace } from '../../src/editor/Workspace'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('switches the visible dark workspace without remounting edits or losing scroll', () => {
  act(() => root.render(createElement(Workspace, null,
    createElement('aside', { className: 'panel left' }, createElement('input', { defaultValue: 'draft' })),
    createElement('section', { className: 'canvas-wrap' }, 'article'),
    createElement('aside', { className: 'panel right' }, 'properties'))))
  const resource = host.querySelector<HTMLButtonElement>('[data-testid="workspace-left"]')
  expect(resource).not.toBeNull()
  const input = host.querySelector('input')!
  input.value = 'unsaved edit'
  const left = host.querySelector<HTMLElement>('.panel.left')!
  left.scrollTop = 45
  act(() => resource!.click())
  expect(host.querySelector('main')!.dataset.workspaceView).toBe('left')
  expect(resource!.getAttribute('aria-pressed')).toBe('true')
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="workspace-canvas"]')!.click())
  expect(host.querySelector('main')!.dataset.workspaceView).toBe('canvas')
  expect(host.querySelector('input')).toBe(input)
  expect(input.value).toBe('unsaved edit')
  expect(left.scrollTop).toBe(45)
})

it('exposes secondary toolbar controls with an accessible toggle and Escape returns focus', async () => {
  const { Toolbar } = await import('../../src/editor/Toolbar')
  act(() => root.render(createElement(Toolbar)))
  const toggle = host.querySelector<HTMLButtonElement>('[data-testid="toolbar-more"]')
  expect(toggle).not.toBeNull()
  expect(toggle!.getAttribute('aria-expanded')).toBe('false')
  act(() => toggle!.click())
  expect(toggle!.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelector('[data-testid="open-ai-settings"]')).not.toBeNull()
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(toggle!.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(toggle)
})

it('reveals the focused mounted panel when entering a collapsed viewport', () => {
  act(() => root.render(createElement(Workspace, null,
    createElement('aside', { className: 'panel left' }, createElement('input', { defaultValue: 'draft' })),
    createElement('section', { className: 'canvas-wrap' }, 'article'),
    createElement('aside', { className: 'panel right' }, 'properties'))))
  const input = host.querySelector('input')!
  input.focus()
  const computed = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ display: 'flex' }) as CSSStyleDeclaration)
  act(() => window.dispatchEvent(new Event('resize')))
  expect(host.querySelector('main')!.dataset.workspaceView).toBe('left')
  expect(document.activeElement).toBe(input)
  computed.mockRestore()
})

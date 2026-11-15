// @vitest-environment jsdom
import { act, createElement, StrictMode, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Doc } from '../../src/core/types'
import { useSelectionScope } from '../../src/editor/useSelectionScope'

const store = vi.hoisted(() => ({
  state: {} as { doc: Doc; selectedIds: string[] },
  listeners: new Set<() => void>(),
}))
vi.mock('../../src/editor/store', () => ({ useStore: {
  getState: () => store.state,
  subscribe: (listener: () => void) => {
    store.listeners.add(listener)
    return () => store.listeners.delete(listener)
  },
} }))
const a = { ...createBlock('heading', { title: 'first' }), id: 'a' }
const b = { ...createBlock('quote'), id: 'b' }
const fixture: Doc = {
  id: 'fixture', revision: 'old', title: '', author: '', digest: '', themeId: 'minimal-magazine',
  blocks: [createBlock('box', { children: [a, b] })], createdAt: 1, updatedAt: 1,
}
type Scope = ReturnType<typeof useSelectionScope>
let root: Root, host: HTMLDivElement, value: Scope
const fetchGuard = vi.fn(() => { throw Error('Unexpected selection scope IO') })
function Harness({ onSetup }: { onSetup?: (scope: Scope) => void }) {
  value = useSelectionScope()
  useLayoutEffect(() => { onSetup?.(value) }, [onSetup])
  return createElement('output', null, value.scope)
}
function update(next: Partial<typeof store.state>) {
  store.state = { ...store.state, ...next }
  for (const listener of store.listeners) listener()
}
function mount(ids: string[] = ['a'], onSetup?: (scope: Scope) => void) {
  store.state = { doc: fixture, selectedIds: ids }
  act(() => root.render(onSetup ? createElement(StrictMode, null, createElement(Harness, { onSetup })) : createElement(Harness)))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchGuard.mockClear(); vi.stubGlobal('fetch', fetchGuard)
  store.listeners.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  expect(store.listeners.size).toBe(0)
  expect(fetchGuard).not.toHaveBeenCalled(); vi.unstubAllGlobals()
})
it('never selects selection scope without a selection and invalidates an explicit choice token', () => {
  mount([])
  expect(host.textContent).toBe('document')
  const before = value.captureScope()
  expect(value.isScopeCurrent(before)).toBe(true)
  act(() => value.setScope('selection'))
  expect(host.textContent).toBe('document')
  expect(value.isScopeCurrent(before)).toBe(false)
  expect(value.scopeIdentity).toBe(value.captureScope())
})
it('preserves a manual override and current token across equivalent selection order and ordinary document edits', () => {
  mount(['a','b'])
  expect(host.textContent).toBe('selection')
  act(() => value.setScope('document'))
  const manual = value.captureScope()
  act(() => update({ selectedIds: ['b','a'], doc: { ...fixture, title: 'normal edit', revision: 'new' } }))
  expect(host.textContent).toBe('document')
  expect(value.isScopeCurrent(manual)).toBe(true)
  expect(value.scopeIdentity).toBe(manual)
})
it('observes a batched selection A -> B -> A and resets the old manual override', () => {
  mount()
  act(() => value.setScope('document'))
  const old = value.captureScope()
  act(() => { update({ selectedIds: ['b'] }); update({ selectedIds: ['a'] }) })
  expect(host.textContent).toBe('selection')
  expect(value.isScopeCurrent(old)).toBe(false)
  expect(value.isScopeCurrent(value.captureScope())).toBe(true)
})
it('derives document scope on clearing and selection scope with a newly selected member', () => {
  mount(['a','b'])
  const prior = value.captureScope()
  act(() => update({ selectedIds: [] }))
  expect(host.textContent).toBe('document')
  expect(value.isScopeCurrent(prior)).toBe(false)
  act(() => update({ selectedIds: ['a'] }))
  expect(host.textContent).toBe('selection')
})
it('invalidates a documented replacement on matching member IDs or an in-place block type change', () => {
  mount()
  act(() => value.setScope('document'))
  const prior = value.captureScope()
  act(() => update({ doc: { ...fixture, id: 'new-document' } }))
  expect(host.textContent).toBe('selection')
  expect(value.isScopeCurrent(prior)).toBe(false)
  act(() => value.setScope('document'))
  const afterReplacement = value.captureScope()
  const changed = { ...b, id: 'a' }
  act(() => update({ doc: { ...store.state.doc, blocks: [changed] } }))
  expect(host.textContent).toBe('selection')
  expect(value.isScopeCurrent(afterReplacement)).toBe(false)
})
it('invalidates captured tokens across StrictMode effect replay and final unmount', () => {
  const setups: { token: string; isCurrent: Scope['isScopeCurrent'] }[] = []
  mount(['a'], ({ captureScope, isScopeCurrent }) => setups.push({ token: captureScope(), isCurrent: isScopeCurrent }))
  expect(setups).toHaveLength(2)
  expect(setups[0].isCurrent(setups[0].token)).toBe(false)
  expect(setups[1].isCurrent(setups[1].token)).toBe(true)
  expect(store.listeners.size).toBe(1)
  act(() => root.render(null))
  expect(setups[1].isCurrent(setups[1].token)).toBe(false)
  expect(store.listeners.size).toBe(0)
})

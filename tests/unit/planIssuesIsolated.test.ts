// @vitest-environment jsdom
import { act, createElement, useState, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlanIssues } from '../../src/editor/PlanIssues'
import type { Crowd, PlanCheck } from '../../src/core/photoPlan'

const empty: PlanCheck = { levels: null, unmatched: [], crowded: [], noLayout: [] }
const calls = { onFlatten: vi.fn(), onAiFlatten: vi.fn(), onClearAnchor: vi.fn(), onContinue: vi.fn(), onCancel: vi.fn() }
let host: HTMLDivElement, root: Root
let decisions: Record<string, Crowd>, singles: Set<string>
const io = vi.fn(() => { throw Error('Unexpected plan decision IO') })
type Fixture = Partial<Pick<ComponentProps<typeof PlanIssues>, 'check' | 'aiOn' | 'busy' | 'crowd' | 'singlesFor'>>
function mount(input: Fixture = {}) {
  function Controlled() {
    const [crowd, setCrowd] = useState(input.crowd ?? {})
    const [singlesFor, setSinglesFor] = useState(input.singlesFor ?? new Set<string>())
    decisions = crowd; singles = singlesFor
    return createElement(PlanIssues, { check: input.check ?? empty, aiOn: input.aiOn ?? false, busy: input.busy ?? '', crowd, singlesFor, setCrowd, setSinglesFor, ...calls })
  }
  act(() => root.render(createElement(Controlled)))
}
function el<T extends HTMLElement = HTMLElement>(id: string) {
  return host.querySelector<T>(`[data-testid="${id}"]`)!
}
const next = () => el<HTMLButtonElement>('plan-continue')
const click = (element: HTMLElement) => act(() => element.click())
function setValue(element: HTMLSelectElement | HTMLInputElement, value: string) {
  const select = element instanceof HTMLSelectElement
  act(() => {
    Object.getOwnPropertyDescriptor(select ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true }))
  })
}
const two: PlanCheck['crowded'][number] = {
  after: 'line', anchor: '活动最后大家合影留念。'.repeat(4), section: '结尾', photos: [0, 2], layouts: ['img2lr', 'img2tb'],
}
beforeEach(() => {
  for (const spy of Object.values(calls)) spy.mockReset()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  io.mockClear(); vi.stubGlobal('fetch', io)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); expect(io).not.toHaveBeenCalled(); vi.unstubAllGlobals()
})
it('offers distinct readiness and cancellation when no plan decision remains', () => {
  mount()
  expect(host.textContent).toContain('问题都已处理，可以继续排版。')
  expect(next().disabled).toBe(false)
  click(next())
  click([...host.querySelectorAll('button')].find((button) => button.textContent === '返回修改')!)
  expect(calls.onContinue).toHaveBeenCalledTimes(1)
  expect(calls.onCancel).toHaveBeenCalledTimes(1)
})
it('shows the heading shortage and routes manual/AI choices independently', () => {
  mount({ aiOn: true, check: { ...empty, levels: { copy: 2, kit: 0 } } })
  expect(el('issue-levels').textContent).toContain('没有标题模块')
  expect(el('flatten-levels').textContent).toContain('改为加粗正文')
  expect(next().disabled).toBe(true)
  click(el('flatten-levels')); click(el('ai-flatten')); click(next())
  expect(calls.onFlatten).toHaveBeenCalledTimes(1)
  expect(calls.onAiFlatten).toHaveBeenCalledTimes(1)
  expect(calls.onContinue).not.toHaveBeenCalled()
})
it('reports active progress and blocks AI/continue while retaining the manual choice', () => {
  mount({ aiOn: true, busy: '正在处理…', check: { ...empty, levels: { copy: 3, kit: 2 } } })
  expect(next().textContent).toBe('正在处理…')
  expect(next().disabled).toBe(true)
  expect(el<HTMLButtonElement>('ai-flatten').disabled).toBe(true)
  click(el('ai-flatten')); click(next())
  expect(calls.onAiFlatten).not.toHaveBeenCalled()
  expect(calls.onContinue).not.toHaveBeenCalled()
  expect(el<HTMLButtonElement>('flatten-levels').disabled).toBe(false)
})
it('reports original anchor and one-based photo ordinals, clearing only its own unit', () => {
  mount({ check: { ...empty, unmatched: [{ key: 'missing-a', anchor: '找不到的句子', grouped: true, photos: [1, 4] }] } })
  expect(el('issue-unmatched').textContent).toContain('照片 2、5')
  expect(el('issue-unmatched').textContent).toContain('找不到的句子')
  click(el('issue-unmatched').querySelector('button')!)
  expect(calls.onClearAnchor).toHaveBeenCalledExactlyOnceWith('missing-a')
  expect(next().disabled).toBe(true)
})
it('defaults to the first compatible photo-group layout and keeps an explicit alternative', () => {
  mount({ check: { ...empty, crowded: [two] } })
  expect(el('issue-crowded').textContent).toContain(two.anchor.slice(0, 30) + '…')
  expect(next().disabled).toBe(true)
  click(el('crowd-group'))
  expect(decisions).toEqual({ line: { mode: 'group', layout: 'img2lr' } })
  setValue(el<HTMLSelectElement>('crowd-layout'), 'img2tb')
  expect(decisions).toEqual({ line: { mode: 'group', layout: 'img2tb' } })
  expect(next().disabled).toBe(false)
  click(el('crowd-singles'))
  expect(decisions).toEqual({ line: { mode: 'singles' } })
  expect(el('crowd-layout')).toBeNull()
})
it('does not enable continuation for a layout missing from the current kit', () => {
  mount({ check: { ...empty, crowded: [{ ...two, layouts: [] }] }, crowd: { line: { mode: 'group', layout: 'img2lr' } } })
  expect(el<HTMLInputElement>('crowd-group').disabled).toBe(true)
  expect(el<HTMLInputElement>('crowd-ai').disabled).toBe(true)
  expect(next().disabled).toBe(true)
  click(el('crowd-group')); expect(next().disabled).toBe(true)
  click(el('crowd-singles')); expect(next().disabled).toBe(false)
})
it('requires meaningful AI instructions without initiating a provider call', () => {
  mount({ aiOn: true, check: { ...empty, crowded: [two] } })
  click(el('crowd-ai'))
  expect(decisions.line).toEqual({ mode: 'ai', request: '' })
  expect(next().disabled).toBe(true)
  const field = el<HTMLInputElement>('crowd-request')
  setValue(field, '   '); expect(next().disabled).toBe(true)
  setValue(field, '前两张并排'); expect(next().disabled).toBe(false)
  expect(decisions.line).toEqual({ mode: 'ai', request: '前两张并排' })
  click(next())
  expect(calls.onContinue).toHaveBeenCalledTimes(1)
  expect(calls.onAiFlatten).not.toHaveBeenCalled()
})
it('requires every unsupported group to opt into singles and allows revoking either decision', () => {
  const initial = new Set<string>()
  mount({ singlesFor: initial, check: { ...empty, noLayout: [
    { key: 'a', grouped: true, photos: [0, 1] }, { key: 'b', grouped: true, photos: [2, 3, 4] },
  ] } })
  const [a,b] = [...host.querySelectorAll<HTMLInputElement>('[data-testid="issue-nolayout"] input')]
  click(a); expect(next().disabled).toBe(true)
  click(b); expect(next().disabled).toBe(false); expect([...singles]).toEqual(['a','b'])
  click(a); expect(next().disabled).toBe(true); expect([...singles]).toEqual(['b'])
  expect(initial.size).toBe(0)
})

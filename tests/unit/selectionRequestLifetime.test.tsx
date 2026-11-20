// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { api } from '../../src/editor/api'
import { RightPanel } from '../../src/editor/RightPanel'
import { emptyDoc, useStore } from '../../src/editor/store'
import { instructionSuggestions } from '../../src/editor/suggestionQueue'

let root: Root, host: HTMLDivElement
const state = () => useStore.getState()
const button = (text: string) => [...host.querySelectorAll('button')].find(el => el.textContent === text)!
const click = (el: HTMLElement) => act(async () => el.click())
const card = (id: string) => ({ ...createBlock('card', { title: `Title ${id}` }), id })

beforeEach(async () => {
  localStorage.setItem('xiumi:auto-input-suggestions', 'off')
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(api, 'aiStatus').mockResolvedValue({ enabled: true, name: 'Test model', model: 'fixture', provider: 'openai', profileId: 'fixture' })
  vi.spyOn(api, 'aiEdit').mockResolvedValue({ summary: 'unused', ops: [] })
  vi.spyOn(api, 'aiSuggestInstruction').mockResolvedValue({ suggestion: 'Mock suggestion' })
  // Run the fetch callback without the production throttling clock; no external I/O.
  vi.spyOn(instructionSuggestions, 'get').mockImplementation(async (_key, fetch, signal) => signal.aborted ? '' : (await fetch()).suggestion)
  state().load({ ...emptyDoc(), blocks: [card('a'), card('b')] }); state().select('a')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<RightPanel />))
  await click(host.querySelector<HTMLButtonElement>('[data-testid="tab-ai"]')!)
})

afterEach(async () => {
  vi.useRealTimers()
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  localStorage.clear()
})

it('ignores a late edit if the selection switched away and back inside one React batch', async () => {
  let finish!: (value: Awaited<ReturnType<typeof api.aiEdit>>) => void
  vi.mocked(api.aiEdit).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await act(async () => {
    const input = host.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '修改标题')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(button('生成修改建议'))
  expect(api.aiEdit).toHaveBeenCalledOnce()
  await act(async () => { state().select('b'); state().select('a') })
  expect(state().selectedIds).toEqual(['a'])
  await act(async () => finish({ summary: 'stale A', ops: [{ op: 'update', id: 'a', props: { title: 'Stale title' } }] }))
  expect(state().proposal).toBeNull()
})

it('does not start a queued suggestion while the local collection dialog is open', async () => {
  vi.useFakeTimers()
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
  await click(host.querySelector<HTMLButtonElement>('[data-testid="collect-article-images"]')!)
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('收集文中图片')
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(api.aiSuggestInstruction).not.toHaveBeenCalled()
})

it('aborts an in-flight suggestion on open and permits a new suggestion only after close', async () => {
  vi.useFakeTimers()
  let finish!: (value: Awaited<ReturnType<typeof api.aiSuggestInstruction>>) => void
  vi.mocked(api.aiSuggestInstruction).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(api.aiSuggestInstruction).toHaveBeenCalledOnce()
  const sent = vi.mocked(api.aiSuggestInstruction).mock.calls[0][3]!
  await click(host.querySelector<HTMLButtonElement>('[data-testid="collect-article-images"]')!)
  expect(sent.aborted).toBe(true)
  await act(async () => finish({ suggestion: 'Obsolete suggestion' }))
  expect(host.querySelector('textarea')!.placeholder).not.toBe('Obsolete suggestion')
  await click(host.querySelector<HTMLButtonElement>('[role="dialog"] button.close')!)
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(api.aiSuggestInstruction).toHaveBeenCalledTimes(2)
  expect(host.querySelector('textarea')!.placeholder).toBe('Mock suggestion')
})

// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
import { AiSettingsModal } from '../../src/editor/AiSettingsModal'

vi.mock('../../src/editor/api', () => ({ api: { aiSettings: vi.fn(), aiModels: vi.fn() } }))
let root: Root
let host: HTMLDivElement
const profiles = [
  { id: 'a', name: 'A', provider: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: '', model: 'old-model', jsonMode: true },
  { id: 'b', name: 'B', provider: 'openai', baseUrl: 'https://other.invalid/v1', apiKey: '', model: '', jsonMode: true },
]
beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(api.aiSettings).mockResolvedValue({ activeId: 'a', profiles: profiles as any })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(AiSettingsModal, { onClose() {} })))
  act(() => host.querySelector<HTMLElement>('.ai-item')!.click())
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const fetchButton = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('获取模型列表'))!
const list = () => host.querySelector<HTMLSelectElement>('select[aria-label="可用模型"]')

it('shows fetched IDs in a visible selectable list without editing the existing model name', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'new-model', contextWindow: 128000 }, { id: 'other-model' }])
  await act(async () => fetchButton().click())
  expect(list()).not.toBeNull()
  expect(list()!.size).toBeGreaterThan(1)
  expect([...list()!.options].map((o) => o.value)).toContain('new-model')
  act(() => { list()!.value = 'new-model'; list()!.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(host.querySelector<HTMLInputElement>('input[placeholder^="例如 deepseek-chat"]')!.value).toBe('new-model')
  expect(host.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('128000')
})

it('reports an empty list instead of rendering an invisible menu', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([])
  await act(async () => fetchButton().click())
  expect(host.querySelector('[role="status"]')!.textContent).toContain('服务未返回模型')
  expect(list()).toBeNull()
})

it('renders request failures visibly and permits a retry', async () => {
  vi.mocked(api.aiModels).mockRejectedValueOnce(new Error('模拟服务错误'))
  await act(async () => fetchButton().click())
  expect(host.querySelector('[role="status"]')!.textContent).toContain('模拟服务错误')
  expect(fetchButton().disabled).toBe(false)
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'retry-model' }])
  await act(async () => fetchButton().click())
  expect(list()!.options[1].value).toBe('retry-model')
})

it('ignores late results after switching profiles', async () => {
  let resolve!: (models: { id: string }[]) => void
  vi.mocked(api.aiModels).mockReturnValue(new Promise((r) => { resolve = r }))
  await act(async () => fetchButton().click())
  expect(host.textContent).toContain('正在获取模型')
  act(() => host.querySelectorAll<HTMLElement>('.ai-item')[1].click())
  await act(async () => resolve([{ id: 'stale-model' }]))
  expect(list()).toBeNull()
  expect(host.textContent).not.toContain('stale-model')
})

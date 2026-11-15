// @vitest-environment jsdom
import { act, createElement, StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiSettingsModal } from '../../src/editor/AiSettingsModal'
import type { AiProfile, api } from '../../src/editor/api'

type TestResult = Awaited<ReturnType<typeof api.testAi>>
type ModelResult = Awaited<ReturnType<typeof api.aiModels>>
type EffortResult = Awaited<ReturnType<typeof api.probeEffort>>
type SettingsResult = Awaited<ReturnType<typeof api.aiSettings>>
const h = vi.hoisted(() => ({
  settings: vi.fn(), save: vi.fn(), models: vi.fn(), connection: vi.fn(), effort: vi.fn(), notify: vi.fn(), notifyOverride: null as (() => void) | null,
}))
vi.mock('../../src/editor/api', () => ({ api: {
  aiSettings: h.settings, saveAiSettings: h.save, aiModels: h.models, testAi: h.connection, probeEffort: h.effort,
} }))
vi.mock('../../src/editor/store', () => ({ useStore: (select: (state: { notify: (message: string, kind?: string) => void }) => unknown) => select({ notify: h.notifyOverride ?? h.notify }) }))
vi.mock('../../src/editor/Modal', () => ({
  Modal: ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) =>
    createElement('section', { 'aria-label': title },
      createElement('button', { 'data-testid': 'close-boundary', onClick: onClose }, 'Close boundary'), children),
}))
vi.mock('../../src/editor/ModelPicker', () => ({
  ModelPicker: ({ models, value, disabled, onSelect }: { models: ModelResult; value: string; disabled?: boolean; onSelect: (id: string) => void }) =>
    createElement('div', { 'data-testid': 'picker-boundary', 'data-value': value },
      models.map(m => createElement('button', { key: m.id, disabled, onClick: () => onSelect(m.id) }, m.id))),
}))

const first: AiProfile = { id: 'p-one', name: 'Primary profile', provider: 'openai', baseUrl: 'https://one.invalid/v1', apiKey: '', model: 'model-one', jsonMode: true, contextWindow: 64000, maxOutputTokens: 4096, efforts: ['low', 'high'], reasoningEffort: 'high' }
const second: AiProfile = { ...first, id: 'p-two', name: 'Other profile', baseUrl: 'https://two.invalid/v1', model: 'model-two' }
const settings = (): SettingsResult => ({ activeId: first.id, profiles: [{ ...first }, { ...second }] })
let host: HTMLDivElement
let root: Root
let close: ReturnType<typeof vi.fn<() => void>>
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  close = vi.fn()
  for (const fn of [h.settings, h.save, h.models, h.connection, h.effort]) {
    fn.mockReset().mockImplementation(() => { throw Error('Unexpected API call') })
  }
  h.notify.mockReset()
  h.notifyOverride = null
  h.settings.mockResolvedValueOnce(settings())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals()
})
const input = (id: string) => host.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!
const button = (name: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === name)!
const profile = (name: string) => Array.from(host.querySelectorAll<HTMLElement>('.ai-item')).find(x => x.querySelector('b')?.textContent === name)!
const change = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(field, value)
  field.dispatchEvent(new Event('input',{ bubbles: true }))
})
const mount = async (select = true) => {
  await act(async () => root.render(createElement(AiSettingsModal, { onClose: close })))
  if (select) act(() => profile(first.name).click())
}
const settle = async <T,>(request: ReturnType<typeof deferred<T>>, value: T) => {
  await act(async () => request.resolve(value))
}
const press = async (name: string) => { await act(async () => button(name).click()) }
const modelNote = () => host.querySelector('[data-testid="ai-model-note"]')?.textContent
const choose = async (name: string) => { await act(async () => profile(name).click()) }

describe('loading and saving settings', () => {
  it('gates creation/save until settings load; does not invoke providers while opening', async () => {
    const pending = deferred<SettingsResult>()
    h.settings.mockReset().mockReturnValueOnce(pending.promise)
    await mount(false)
    expect(host.querySelector<HTMLSelectElement>('select')?.disabled).toBe(true)
    expect(button('保存').disabled).toBe(true)
    await settle(pending, settings())
    expect(host.querySelector<HTMLSelectElement>('select')?.disabled).toBe(false)
    expect(button('保存').disabled).toBe(false)
    expect(h.models).not.toHaveBeenCalled()
    expect(h.connection).not.toHaveBeenCalled()
  })

  it('shows startup failure without enabling save or inventing loaded state', async () => {
    h.settings.mockReset().mockRejectedValueOnce(new Error('离线模拟'))
    await mount(false)
    expect(h.notify).toHaveBeenCalledExactlyOnceWith('离线模拟','error')
    expect(button('保存').disabled).toBe(true)
    expect(host.querySelector('.ai-item')).toBeNull()
  })

  it('blocks invalid extra JSON, then saves editable profiles without writing read-only env settings', async () => {
    h.settings.mockReset().mockResolvedValueOnce({ activeId: first.id, profiles: [first,{ ...second, readonly: true }] })
    await mount()
    const extra = host.querySelector<HTMLTextAreaElement>('textarea')!
    change(extra, '[]')
    expect(button('保存').disabled).toBe(true)
    expect(h.save).not.toHaveBeenCalled()
    change(extra, '{"temperature":2,"custom_setting":true}')
    expect(host.querySelector('[data-testid="ai-extra-ignored"]')?.textContent).toContain('temperature')
    expect(host.querySelector('[data-testid="ai-extra-ignored"]')?.textContent).not.toContain('custom_setting')
    const saved = { activeId: first.id, profiles: [{ ...first, extraBody: '{"temperature":2,"custom_setting":true}' }] }
    h.save.mockResolvedValueOnce(saved)
    const changed = vi.fn()
    window.addEventListener('ai-settings-changed', changed)
    try {
      await press('保存')
      expect(h.save).toHaveBeenCalledExactlyOnceWith(saved)
      expect(h.notify).toHaveBeenCalledExactlyOnceWith('AI 模型设置已保存')
      expect(changed).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
    } finally { window.removeEventListener('ai-settings-changed', changed) }
  })

  it('reports save failure without emitting success or closing, and enables retry', async () => {
    await mount()
    h.save.mockRejectedValueOnce(new Error('保存失败'))
    await press('保存')
    expect(h.notify).toHaveBeenCalledExactlyOnceWith('保存失败','error')
    expect(close).not.toHaveBeenCalled()
    expect(button('保存').disabled).toBe(false)
  })
})

describe('model discovery and tuning', () => {
  it('delegates actual discovered models, but picking is required before changing model and tuning', async () => {
    await mount()
    h.models.mockResolvedValueOnce([{ id: 'model-new', contextWindow: 128000, maxOutput: 8192, efforts: ['medium'] }])
    await press('从服务商获取模型列表')
    expect(modelNote()).toContain('已获取 1 个模型')
    expect(host.querySelector('[data-testid="picker-boundary"]')?.getAttribute('data-value')).toBe('model-one')
    expect(input('ai-model').value).toBe('model-one')
    await press('model-new')
    expect(input('ai-model').value).toBe('model-new')
    expect(input('ai-context').value).toBe('128000')
    expect(input('ai-max-output').value).toBe('8192')
    expect(input('ai-effort').value).toBe('')
    change(input('ai-effort'),'medium')
    change(input('ai-model'),'manual-model')
    expect(input('ai-context').value).toBe('128000')
    expect(input('ai-max-output').value).toBe('8192')
    expect(input('ai-effort').value).toBe('medium')
  })

  it.each(['empty', 'failed'] as const)('distinguishes %s discovery from success and allows retry', async outcome => {
    await mount()
    if (outcome === 'empty') h.models.mockResolvedValueOnce([])
    else h.models.mockRejectedValueOnce(new Error('服务失败'))
    await press('从服务商获取模型列表')
    expect(modelNote()).toContain(outcome === 'empty' ? '服务未返回模型' : '服务失败')
    expect(modelNote()).toContain('手动填写')
    expect(host.querySelector('[data-testid="picker-boundary"]')).toBeNull()
    h.models.mockResolvedValueOnce([{ id: 'retry-model' }])
    await press('从服务商获取模型列表')
    expect(button('retry-model')).toBeDefined()
  })

  it('preserves manual limits while editing an incomplete URL and rotating a same-origin key', async () => {
    await mount()
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!
    change(key, 'synthetic-initial')
    for (const value of ['https://', 'https://one.invalid/v2']) change(input('ai-base-url'), value)
    change(key, 'synthetic-rotated')
    h.models.mockResolvedValueOnce([{ id: first.model, contextWindow: 128000, maxOutput: 16000, efforts: ['low'] }])
    await press('从服务商获取模型列表')
    expect(h.models).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ apiKey: 'synthetic-rotated', baseUrl: 'https://one.invalid/v2' }))
    expect(input('ai-context').value).toBe('64000')
    expect(input('ai-max-output').value).toBe('4096')
    expect(input('ai-effort').value).toBe('high')
  })

  it('does not send an existing credential to a new service, and clears its service-specific tuning', async () => {
    await mount()
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!
    change(key, 'synthetic-initial')
    change(input('ai-base-url'), 'https://new.invalid/v1')
    await press('从服务商获取模型列表')
    expect(h.models).not.toHaveBeenCalled()
    expect(key.value).toBe('')
    expect(input('ai-context').value).toBe('')
    expect(input('ai-max-output').value).toBe('')
    expect(input('ai-effort').value).toBe('')
    expect(modelNote() ?? '').toContain('重新输入 API Key')
    await choose(second.name)
    expect(modelNote()).toBeUndefined()
    await choose(first.name)
    expect(modelNote() ?? '').toContain('重新输入 API Key')
    change(key, 'synthetic-appropriate')
    expect(modelNote()).toBeUndefined()
    h.models.mockResolvedValueOnce([])
    await press('从服务商获取模型列表')
    expect(h.models).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ apiKey: 'synthetic-appropriate', baseUrl: 'https://new.invalid/v1' }))
  })

  it('ignores the older profile generation while a newer list is still pending', async () => {
    await mount()
    const old = deferred<ModelResult>(), fresh = deferred<ModelResult>()
    h.models.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    await press('从服务商获取模型列表')
    await choose(second.name)
    await press('从服务商获取模型列表')
    await settle(old, [{ id: 'old-stale' }])
    expect(input('ai-load-models').disabled).toBe(true)
    expect(button('old-stale')).toBeUndefined()
    await settle(fresh, [{ id: 'fresh-match' }])
    expect(button('fresh-match')).toBeDefined()
    expect(input('ai-load-models').disabled).toBe(false)
  })
})

describe('connection and effort feedback', () => {
  it.each(['success', 'malformed', 'error'] as const)('accurately describes %s connection outcomes', async outcome => {
    await mount()
    if (outcome === 'error') h.connection.mockRejectedValueOnce(new Error('上游拒绝'))
    else h.connection.mockResolvedValueOnce({ ok: outcome === 'success', ms: 1234, reply: { value: 'wire-response' } })
    await press('测试连接')
    expect(h.connection).toHaveBeenCalledExactlyOnceWith(first)
    expect(host.textContent).toContain({ success: '连接成功（1.2 秒）', malformed: '已响应但格式异常：{"value":"wire-response"}', error: '✕ 上游拒绝' }[outcome])
    if (outcome !== 'success') expect(host.textContent).not.toContain('连接成功')
  })

  it.each(['switch', 'close'] as const)('discards both late connection success and probe failure after %s', async action => {
    await mount()
    const connection = deferred<TestResult>(), probe = deferred<EffortResult>()
    h.connection.mockReturnValueOnce(connection.promise); h.effort.mockReturnValueOnce(probe.promise)
    await press('测试连接'); await press('检测支持的强度')
    expect(host.textContent).toContain('测试中…')
    if (action === 'switch') await choose(second.name)
    else act(() => host.querySelector<HTMLButtonElement>('[data-testid="close-boundary"]')!.click())
    await act(async () => { connection.resolve({ ok: true, ms: 10, reply: null }); probe.reject(new Error('old-effort')) })
    expect(host.textContent).not.toContain('连接成功')
    expect(host.textContent).not.toContain('old-effort')
    expect(close).toHaveBeenCalledTimes(action === 'close' ? 1 : 0)
  })

  it('notifies that accepting even invalid effort cannot confirm support and preserves chosen effort', async () => {
    await mount()
    h.effort.mockResolvedValueOnce({ ignored: true, supported: ['low'], rejected: [] })
    await press('检测支持的强度')
    expect(host.querySelector('[data-testid="ai-effort-note"]')?.textContent).toContain('无法判断哪些真正生效')
    expect(input('ai-effort').value).toBe('high')
  })

  it('shows accepted/rejected effort values, removing only an effort the provider rejects', async () => {
    await mount()
    h.effort.mockResolvedValueOnce({ ignored: false, supported: ['low'], rejected: [{ effort: 'high' }] })
    await press('检测支持的强度')
    expect(host.querySelector('[data-testid="ai-effort-note"]')?.textContent).toBe('接受：low；被拒绝：high')
    expect(input('ai-effort').value).toBe('')
  })
})

it('does not send another connection request while one is pending', async () => {
  await mount()
  const pending = deferred<TestResult>()
  h.connection.mockReturnValue(pending.promise)
  const testConnection = button('测试连接')
  act(() => { testConnection.click(); testConnection.click() })
  expect(testConnection.disabled).toBe(true)
  await press('测试连接')
  expect(h.connection).toHaveBeenCalledTimes(1)
  await settle(pending, { ok: true, ms: 25, reply: null })
  expect(host.textContent).toContain('连接成功')
})

it('reports the new endpoint connection result when testing itself clears obsolete tuning', async () => {
  await mount()
  change(input('ai-base-url'), 'http://localhost:11434/v1')
  const pending = deferred<TestResult>()
  h.connection.mockReturnValueOnce(pending.promise)
  await press('测试连接')
  expect(h.connection).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ baseUrl: 'http://localhost:11434/v1', maxOutputTokens: 0 }))
  await settle(pending, { ok: true, ms: 25, reply: null })
  expect(host.textContent).toContain('连接成功')
})

it('an older request cannot release or replace the pending test for a newly selected profile', async () => {
  await mount()
  const old = deferred<TestResult>(), fresh = deferred<TestResult>()
  h.connection.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  await press('测试连接')
  await choose(second.name)
  await press('测试连接')
  await settle(old, { ok: false, ms: 5, reply: 'obsolete' })
  expect(button('测试连接').disabled).toBe(true)
  expect(host.textContent).not.toContain('obsolete')
  await press('测试连接')
  expect(h.connection).toHaveBeenCalledTimes(2)
  await settle(fresh, { ok: true, ms: 100, reply: null })
  expect(button('测试连接').disabled).toBe(false)
  expect(host.textContent).toContain('连接成功（0.1 秒）')
})

it('invalidates in-flight work when a settings reload publishes replacement profiles', async () => {
  await mount()
  const pending = deferred<TestResult>()
  h.connection.mockReturnValueOnce(pending.promise)
  await press('测试连接')
  const replacement = { ...first, model: 'reloaded-model' }
  h.settings.mockResolvedValueOnce({ activeId: first.id, profiles: [replacement] })
  h.notifyOverride = vi.fn<() => void>()
  await act(async () => root.render(createElement(AiSettingsModal, { onClose: close })))
  expect(input('ai-model').value).toBe('reloaded-model')
  await settle(pending, { ok: false, ms: 10, reply: 'obsolete-reload' })
  expect(host.textContent).not.toContain('obsolete-reload')
  expect(button('测试连接').disabled).toBe(false)
})

it('successfully saving settings invalidates an in-flight test before late feedback can render', async () => {
  await mount()
  const pending = deferred<TestResult>()
  h.connection.mockReturnValueOnce(pending.promise)
  await press('测试连接')
  h.save.mockResolvedValueOnce(settings())
  await press('保存')
  expect(close).toHaveBeenCalledOnce()
  await settle(pending, { ok: false, ms: 10, reply: 'obsolete-save' })
  expect(host.textContent).not.toContain('obsolete-save')
})

it('supports a new connection test after StrictMode effects replay and a harmless onClose replacement', async () => {
  h.settings.mockReset().mockResolvedValue(settings())
  const render = async (onClose: () => void) => {
    await act(async () => root.render(createElement(StrictMode, null, createElement(AiSettingsModal, { onClose }))))
  }
  await render(close)
  await choose(first.name)
  const pending = deferred<TestResult>()
  h.connection.mockReturnValueOnce(pending.promise)
  await press('测试连接')
  await render(() => {})
  expect(button('测试连接').disabled).toBe(true)
  await settle(pending, { ok: true, ms: 100, reply: null })
  expect(host.textContent).toContain('连接成功（0.1 秒）')
})

it('does not send multiple effort probes from two clicks before React commits the disabled button', async () => {
  await mount()
  const pending = deferred<EffortResult>()
  h.effort.mockReturnValue(pending.promise)
  const buttonControl = button('检测支持的强度')
  act(() => { buttonControl.click(); buttonControl.click() })
  expect(h.effort).toHaveBeenCalledTimes(1)
  await settle(pending, { ignored: false, supported: ['high'], rejected: [] })
  expect(host.querySelector('[data-testid="ai-effort-note"]')?.textContent).toBe('接受：high')
})

it('keeps the endpoint key warning until a deliberate empty credential is checked', async () => {
  await mount()
  const key = host.querySelector<HTMLInputElement>('input[type="password"]')!
  change(key, 'synthetic-original')
  change(input('ai-base-url'), 'http://localhost:11434/v1')
  await press('从服务商获取模型列表')
  expect(modelNote() ?? '').toContain('重新输入 API Key')
  expect(h.models).not.toHaveBeenCalled()
  change(key, ' ')
  change(key, '')
  expect(modelNote() ?? '').toContain('重新输入 API Key')
  h.models.mockResolvedValueOnce([])
  await press('从服务商获取模型列表')
  expect(h.models).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ baseUrl: 'http://localhost:11434/v1', apiKey: '' }))
  expect(modelNote() ?? '').toContain('服务未返回模型')
  expect(modelNote() ?? '').not.toContain('重新输入 API Key')
})

it('completing a connection test never clears an independent effort probe lock', async () => {
  await mount()
  const connection = deferred<TestResult>(), probe = deferred<EffortResult>()
  h.connection.mockReturnValueOnce(connection.promise)
  h.effort.mockReturnValueOnce(probe.promise)
  await press('测试连接')
  await press('检测支持的强度')
  await settle(connection, { ok: true, ms: 10, reply: null })
  expect(button('测试连接').disabled).toBe(false)
  expect(button('检测中…').disabled).toBe(true)
  await settle(probe, { ignored: false, supported: ['high'], rejected: [] })
  expect(button('检测支持的强度').disabled).toBe(false)
})

it.each([
  ['测试连接', '检测支持的强度'],
  ['检测支持的强度', '测试连接'],
])('uses reset endpoint tuning when %s then %s start before render', async (firstAction, secondAction) => {
  await mount()
  change(input('ai-base-url'), 'http://localhost:11434/v1')
  const connection = deferred<TestResult>(), probe = deferred<EffortResult>()
  h.connection.mockReturnValueOnce(connection.promise)
  h.effort.mockReturnValueOnce(probe.promise)
  act(() => { button(firstAction).click(); button(secondAction).click() })
  const neutral = expect.objectContaining({ baseUrl: 'http://localhost:11434/v1', maxOutputTokens: 0, contextWindow: 0, reasoningEffort: '' })
  expect(h.connection).toHaveBeenCalledExactlyOnceWith(neutral)
  expect(h.effort).toHaveBeenCalledExactlyOnceWith(neutral)
  await settle(connection, { ok: true, ms: 10, reply: null })
  await settle(probe, { ignored: false, supported: [], rejected: [] })
})

it('does not keep zeroing limits manually entered after the normalized draft commits', async () => {
  await mount()
  change(input('ai-base-url'), 'http://localhost:11434/v1')
  h.connection.mockResolvedValueOnce({ ok: true, ms: 100, reply: null })
  await press('测试连接')
  change(input('ai-context'), '32000')
  change(input('ai-max-output'), '2048')
  change(input('ai-effort'), 'low')
  h.connection.mockResolvedValueOnce({ ok: true, ms: 100, reply: null })
  await press('测试连接')
  expect(h.connection).toHaveBeenNthCalledWith(2, expect.objectContaining({ contextWindow: 32000, maxOutputTokens: 2048, reasoningEffort: 'low' }))
})

it('keeps both action payloads tuned on a same-origin path edit', async () => {
  await mount()
  change(input('ai-base-url'), 'https://one.invalid/custom/v1')
  h.connection.mockResolvedValueOnce({ ok: true, ms: 10, reply: null })
  h.effort.mockResolvedValueOnce({ ignored: false, supported: ['high'], rejected: [] })
  await act(async () => { button('测试连接').click(); button('检测支持的强度').click() })
  const sameOrigin = expect.objectContaining({ baseUrl: 'https://one.invalid/custom/v1', contextWindow: 64000, maxOutputTokens: 4096, reasoningEffort: 'high' })
  expect(h.connection).toHaveBeenCalledExactlyOnceWith(sameOrigin)
  expect(h.effort).toHaveBeenCalledExactlyOnceWith(sameOrigin)
})

describe('profile controls and read-only configuration',()=>{
  it('adds a custom profile from an empty configuration and saves explicitly entered tuning and JSON preference',async()=>{
    h.settings.mockReset().mockResolvedValueOnce({activeId:'',profiles:[]})
    await mount(false)
    const add=host.querySelector<HTMLSelectElement>('[data-testid="ai-add-preset"]')!
    act(()=>{add.value='custom';add.dispatchEvent(new Event('change',{bubbles:true}))})
    expect(host.querySelector('.ai-form')).toBeTruthy()
    const name=host.querySelector<HTMLInputElement>('.ai-form label.field input')!
    change(name,'合成服务');change(input('ai-base-url'),'http://127.0.0.1:12345/v1');change(input('ai-model'),'synthetic-model')
    change(input('ai-context'),'120000');change(input('ai-max-output'),'16000')
    await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    h.save.mockImplementationOnce(async value=>value)
    await press('保存')
    const payload=h.save.mock.calls[0][0] as SettingsResult
    expect(payload.profiles).toHaveLength(1)
    expect(payload.activeId).toBe(payload.profiles[0].id)
    expect(payload.profiles[0]).toMatchObject({name:'合成服务',baseUrl:'http://127.0.0.1:12345/v1',model:'synthetic-model',contextWindow:120000,maxOutputTokens:16000,jsonMode:false,apiKey:''})
    expect(h.models).not.toHaveBeenCalled();expect(h.connection).not.toHaveBeenCalled()
  })

  it('selects an active profile independently of the edited row and deletes only the explicitly edited profile',async()=>{
    await mount()
    const radio=profile(second.name).querySelector<HTMLInputElement>('input[type="radio"]')!
    await act(async()=>radio.click())
    expect(input('ai-model').value).toBe(first.model)
    await press('删除')
    expect(profile(first.name)).toBeUndefined();expect(profile(second.name)).toBeTruthy()
    expect(host.querySelector('.ai-form')?.textContent).toContain('从左侧选择一项')
    h.save.mockImplementationOnce(async value=>value)
    await press('保存')
    expect(h.save).toHaveBeenCalledExactlyOnceWith({activeId:second.id,profiles:[second]})
  })

  it.each(['not a URL','ftp://files.invalid/v1','https://name:password@example.invalid/v1'])('blocks all request actions and save for an invalid endpoint %s',async endpoint=>{
    await mount();change(input('ai-base-url'),endpoint)
    expect(input('ai-load-models').disabled).toBe(true)
    expect(input('ai-probe-effort').disabled).toBe(true)
    expect(button('测试连接').disabled).toBe(true);expect(button('保存').disabled).toBe(true)
    expect(h.models).not.toHaveBeenCalled();expect(h.effort).not.toHaveBeenCalled();expect(h.connection).not.toHaveBeenCalled()
  })

  it('keeps env-owned fields noneditable while allowing an explicit diagnostic without writing the profile',async()=>{
    h.settings.mockReset().mockResolvedValueOnce({activeId:first.id,profiles:[{...first,readonly:true,hasKey:true}]})
    await mount()
    expect(host.textContent).toContain('只能在 .env 中修改')
    for(const id of ['ai-base-url','ai-model','ai-context','ai-max-output','ai-effort','ai-extra-body'])expect(input(id).disabled).toBe(true)
    expect(button('删除')).toBeUndefined()
    h.effort.mockResolvedValueOnce({ignored:false,supported:['low'],rejected:[{effort:'high',error:'unsupported'}]})
    await press('检测支持的强度')
    expect(input('ai-effort').value).toBe('high')
    expect(host.querySelector('[data-testid="ai-effort-note"]')?.textContent).toContain('接受：low；被拒绝：high')
    h.save.mockImplementationOnce(async value=>value)
    await press('保存')
    expect(h.save).toHaveBeenCalledExactlyOnceWith({activeId:first.id,profiles:[]})
  })
})

it('auto-discovers only after a complete credential edit leaves the credential controls, not when moving to an action button',async()=>{
  await mount()
  const key=host.querySelector<HTMLInputElement>('input[type="password"]')!
  change(input('ai-base-url'),'https://one.invalid/v2')
  const blur=async(field:HTMLInputElement,target:Element)=>act(async()=>{field.dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:target}))})
  await blur(input('ai-base-url'),input('ai-model'))
  expect(h.models).not.toHaveBeenCalled()
  change(key,'synthetic-only')
  await blur(key,button('测试连接'));expect(h.models).not.toHaveBeenCalled()
  h.models.mockResolvedValueOnce([])
  await blur(key,input('ai-model'))
  expect(h.models).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({apiKey:'synthetic-only',baseUrl:'https://one.invalid/v2'}))
  await blur(key,input('ai-model'));expect(h.models).toHaveBeenCalledOnce()
})

it('allows automatic discovery on a completed localhost endpoint without inventing credentials',async()=>{
  await mount();change(input('ai-base-url'),'http://127.0.0.1:11434/v1')
  h.models.mockResolvedValueOnce([])
  await act(async()=>{input('ai-base-url').dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:input('ai-model')}))})
  expect(h.models).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({apiKey:'',contextWindow:0,maxOutputTokens:0,reasoningEffort:''}))
})

it('clears endpoint credentials and tuning when the interface type changes but preserves manually entered values thereafter',async()=>{
  await mount();change(host.querySelector<HTMLInputElement>('input[type="password"]')!,'synthetic-original')
  await press('Anthropic Claude')
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
  expect(input('ai-context').value).toBe('');expect(input('ai-max-output').value).toBe('')
  h.connection.mockResolvedValueOnce({ok:true,ms:1,reply:null})
  await press('测试连接')
  expect(h.connection).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({provider:'anthropic',apiKey:'',hasKey:false,contextWindow:0,maxOutputTokens:0}))
  await press('OpenAI 兼容');change(input('ai-context'),'1000');change(input('ai-max-output'),'')
  h.connection.mockResolvedValueOnce({ok:true,ms:1,reply:null});await press('测试连接')
  expect(h.connection).toHaveBeenLastCalledWith(expect.objectContaining({provider:'openai',contextWindow:1000,maxOutputTokens:0}))
})

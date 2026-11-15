// @vitest-environment jsdom
import { act, createElement, StrictMode, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { getTheme } from '../../src/core/themes'
import type { Doc, Theme } from '../../src/core/types'
import type { AiStatus, api } from '../../src/editor/api'
import { RightPanel } from '../../src/editor/RightPanel'
import type { Proposal as ProposalState } from '../../src/editor/store'

type EditResult = Awaited<ReturnType<typeof api.aiEdit>>
type Scope = 'selection' | 'document'
type PanelState = {
  themes: Theme[]; commit:(...args:unknown[])=>void;refreshThemes:()=>void; doc: Doc; selectedIds: string[]; proposal: ProposalState | null; proposalVersion: number
  propose: (...args: unknown[]) => void; resolveProposal: (...args: unknown[]) => void
  clearProposal: () => void; notify: (...args: unknown[]) => void
  setDocFields: (...args: unknown[]) => void; removeSelected: () => void; select: (...args: unknown[]) => void
}
const h = vi.hoisted(() => ({
  fetchReference:vi.fn(),analyze:vi.fn(),themeFrom:vi.fn(),variant:vi.fn(),saveTheme:vi.fn(),registerTheme:vi.fn(),status: vi.fn(), edit: vi.fn(), suggest: vi.fn(), context: vi.fn(), queue: vi.fn(), preference: vi.fn(), savePreference: vi.fn(),
  collect: vi.fn(), quick: vi.fn(), preview: vi.fn(), compile: vi.fn(), setScope: vi.fn(),
  generation: 0, manualScope: null as Scope | null, mounted: false,
  state: null as unknown as PanelState, listeners: new Set<(s: PanelState, previous: PanelState) => void>(),
}))
vi.mock('../../src/editor/store', () => ({
  useStore: Object.assign((selector: (state: PanelState) => unknown) => selector(useSyncExternalStore(
    notify => { h.listeners.add(notify); return () => { h.listeners.delete(notify) } }, () => h.state,
  )), {
    getState: () => h.state,
    subscribe: (listener: (s: PanelState, previous: PanelState) => void) => {
      h.listeners.add(listener); return () => h.listeners.delete(listener)
    },
  }),
  selectedBlock: (s: PanelState) => s.doc.blocks.find(b => b.id === s.selectedIds[0]),
}))
vi.mock('../../src/editor/useSelectionScope', async () => {
  const { useLayoutEffect } = await import('react')
  return { useSelectionScope: () => {
    useLayoutEffect(() => {
      h.mounted = true
      return () => { h.mounted = false; h.generation++ }
    }, [])
    return {
      scope: h.manualScope ?? (h.state.selectedIds.length ? 'selection' : 'document'),
      setScope: h.setScope, scopeIdentity: String(h.generation),
      captureScope: () => String(h.generation),
      isScopeCurrent: (token: string) => h.mounted && token === String(h.generation),
    }
  } }
})
vi.mock('../../src/editor/api', () => ({ api: { fetchReference:h.fetchReference,saveTheme:h.saveTheme,aiStatus: h.status, aiEdit: h.edit, aiSuggestInstruction: h.suggest } }))
vi.mock('../../src/core/quickActions', () => ({ aiContext: h.context, QUICK_ACTIONS: [{ id: 'fixture', label: 'Fixture rule', run: h.quick }] }))
vi.mock('../../src/core/themes',async original=>({...await original<typeof import('../../src/core/themes')>(),registerTheme:h.registerTheme}))
vi.mock('../../src/editor/suggestionPreference', () => ({ readSuggestionPreference: h.preference, saveSuggestionPreference: h.savePreference }))
vi.mock('../../src/editor/suggestionQueue', () => ({ instructionSuggestions: { revision: 1, get: h.queue } }))
vi.mock('../../src/editor/ArticleImageImport', () => ({
  ArticleImageImport: (props: { doc: Doc; selection?: string | string[]; isCurrent: () => boolean; onClose: () => void }) => {
    h.collect(props)
    return createElement('button', { 'data-testid': 'close-collection-boundary', onClick: props.onClose }, 'Close child')
  },
}))
vi.mock('../../src/editor/SuggestionInput', () => ({
  SuggestionInput: (props: { value: string; disabled: boolean; suggestion: string; onChange: (value: string) => void }) =>
    createElement('textarea', { 'data-testid': 'instruction-boundary', value: props.value, disabled: props.disabled, placeholder: props.suggestion, onChange: (event: { target: HTMLTextAreaElement }) => props.onChange(event.target.value) }),
}))
vi.mock('../../src/editor/CoverDesigner', () => ({ CoverDesigner: () => createElement('p', {}, 'Cover boundary') }))
vi.mock('../../src/editor/PropsForm', () => ({ PropsForm: ({ block }: { block: { id: string } }) => createElement('p', { 'data-testid': 'props-boundary' }, block.id) }))
vi.mock('../../src/editor/Toolbar', () => ({
  PhonePreview: (props: { html: string; onClose: () => void }) =>
    createElement('button', { 'data-testid': 'preview-boundary', onClick: props.onClose }, props.html),
}))
vi.mock('../../src/core/styleExtract',()=>({analyzeStyle:h.analyze,themeFromReport:h.themeFrom}))
vi.mock('../../src/editor/UiIcon', () => ({ UiIcon: () => null }))
vi.mock('../../src/editor/proposalSafety', () => ({ previewProposal: h.preview }))
vi.mock('../../src/core/compiler', () => ({ compileDoc: h.compile, variantUrl: h.variant }))

let host: HTMLDivElement
let root: Root
const status: AiStatus = { enabled: true, name: 'Fixture provider', model: 'fixture-model', provider: 'openai', profileId: 'fixture-profile' }
const stubContext = { blocks: [{ id: 'context-block', type: 'card', text: 'Fixture summary' }] }
const block = (id: string) => ({ ...createBlock('card', { title: 'Article block ' + id }), id })
const freshDoc = (): Doc => ({ id: 'fixture-doc', title: 'Fixture document', author: '', digest: '', themeId: 'minimal-magazine', createdAt: 0, updatedAt: 0, blocks: [block('a'), block('b')] })
const newState = (): PanelState => ({
  themes:[],commit:vi.fn(),refreshThemes:vi.fn(),doc: freshDoc(), selectedIds: ['a'], proposal: null, proposalVersion: 7,
  propose: vi.fn(), resolveProposal: vi.fn(), clearProposal: vi.fn(), notify: vi.fn(),
  setDocFields: vi.fn(), removeSelected: vi.fn(), select: vi.fn(),
})
function deferred<T>() {
  let resolve!: (result: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const update = (next: Partial<PanelState>, scopeChanged = false) => {
  const previous = h.state
  if (scopeChanged) { h.generation++; h.manualScope = null }
  h.state = { ...h.state, ...next }
  for (const listener of h.listeners) listener(h.state, previous)
}
const testId = <T extends HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!
const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent === name)!
const control = () => host.querySelector<HTMLButtonElement>('.primary.wide')!
const field = () => testId<HTMLTextAreaElement>('instruction-boundary')
const press = async (el: HTMLButtonElement) => { await act(async () => el.click()) }
const enter = async (text: string) => { await act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), text)
  field().dispatchEvent(new Event('input', { bubbles: true }))
}) }
const tab = (name: string) => press(testId<HTMLButtonElement>('tab-' + name))
const mount = async () => {
  await act(async () => root.render(createElement(RightPanel)))
  await tab('ai')
}
const run = () => press(control())
const settingsEvent = async () => { await act(async () => window.dispatchEvent(new Event('ai-settings-changed'))) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  for (const fn of [h.fetchReference,h.analyze,h.themeFrom,h.variant,h.saveTheme,h.registerTheme,h.status,h.edit,h.suggest,h.queue,h.savePreference,h.quick,h.preview,h.compile,h.context]) {
    fn.mockReset().mockImplementation(() => { throw Error('Unexpected collaborator invocation') })
  }
  h.status.mockResolvedValueOnce(status)
  h.context.mockReturnValue(stubContext)
  h.preference.mockReset().mockReturnValue(false)
  h.savePreference.mockReset().mockReturnValue(undefined)
  h.collect.mockReset()
  h.setScope.mockReset().mockImplementation((scope: Scope) => { h.generation++; h.manualScope = scope; update({}) })
  h.generation = 0; h.manualScope = null; h.mounted = false; h.listeners.clear(); h.state = newState()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();vi.restoreAllMocks()
})

describe('proposal request choreography (scope and store boundaries)', () => {
  it.each(['single', 'multiple', 'whole'] as const)('passes the exact %s scope and proposal revision to collaborators', async scope => {
    if (scope === 'multiple') update({ selectedIds: ['a','b'] }, true)
    await mount()
    if (scope === 'whole') {
      const select = host.querySelector('select')!
      act(() => { select.value = 'document'; select.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(h.setScope).toHaveBeenCalledExactlyOnceWith('document')
    }
    const doc = h.state.doc
    const ops = [{ op: 'update', id: 'a', props: { title: 'Suggested' } }]
    h.edit.mockResolvedValueOnce({ summary: 'Filtered update', ops, selectionPolicy: 'filter', ignoredOps: 2 })
    await enter('修改排版'); await run()
    const selection = scope === 'single' ? 'a' : scope === 'multiple' ? ['a','b'] : undefined
    expect(h.context).toHaveBeenCalledExactlyOnceWith(doc, selection)
    expect(h.edit).toHaveBeenCalledExactlyOnceWith(stubContext, '修改排版', undefined, scope === 'whole' ? undefined : 'a', scope === 'multiple' ? ['a','b'] : undefined)
    expect(h.state.propose).toHaveBeenCalledExactlyOnceWith('Filtered update', ops, selection, { policy: 'filter', ignoredOps: 2, expectedVersion: 7 })
    expect(h.state.doc).toBe(doc)
  })

  it('does not send whitespace, and falls back safely for malformed editor responses', async () => {
    await mount()
    await enter('   '); await run(); expect(h.edit).not.toHaveBeenCalled()
    h.edit.mockResolvedValueOnce({ ops: 'not-an-array' })
    await enter('修改排版'); await run()
    expect(h.state.propose).toHaveBeenCalledExactlyOnceWith('AI 修改建议', [], 'a', { policy: undefined, ignoredOps: undefined, expectedVersion: 7 })
  })

  it('surfaces only a current provider error and reenables submission', async () => {
    await mount(); await enter('修改排版')
    const request = deferred<EditResult>(); h.edit.mockReturnValueOnce(request.promise)
    await run()
    expect(control().disabled).toBe(true)
    await act(async () => request.reject(new Error('当前请求失败')))
    expect(h.state.notify).toHaveBeenCalledExactlyOnceWith('当前请求失败','error')
    expect(control().disabled).toBe(false)
    expect(h.state.propose).not.toHaveBeenCalled()
  })

  it.each(['scope', 'unmount', 'document'] as const)('does not publish a result after %s invalidation', async outcome => {
    await mount(); await enter('修改排版')
    const request = deferred<EditResult>(); h.edit.mockReturnValueOnce(request.promise)
    await run()
    if (outcome === 'scope') act(() => update({ selectedIds: ['b'] }, true))
    if (outcome === 'unmount') await tab('style')
    if (outcome === 'document') act(() => update({ doc: { ...h.state.doc, title: 'New revision' } }))
    await act(async () => request.resolve({ summary: 'Obsolete', ops: [] }))
    expect(h.state.propose).not.toHaveBeenCalled()
    if (outcome === 'document') expect(h.state.notify).toHaveBeenCalledWith(expect.stringContaining('文档已'), 'error')
    else expect(h.state.notify).not.toHaveBeenCalled()
  })

  it('does not let an old scope error remove the current busy state or show a notification', async () => {
    await mount(); await enter('修改排版')
    const old = deferred<EditResult>(), current = deferred<EditResult>()
    h.edit.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await run()
    act(() => update({ selectedIds: ['b'] }, true))
    await run()
    await act(async () => old.reject(new Error('obsolete model error')))
    expect(h.state.notify).not.toHaveBeenCalled()
    expect(control().disabled).toBe(true)
    await act(async () => current.resolve({ summary: 'Current', ops: [] }))
    expect(h.state.propose).toHaveBeenCalledExactlyOnceWith('Current', [], 'b', { policy: undefined, ignoredOps: undefined, expectedVersion: 7 })
    expect(control().disabled).toBe(false)
  })
})

describe('local collection and opt-in suggestions', () => {
  it('recognizes a positive command offline, opens only a confirmation boundary, and keeps the captured selection', async () => {
    h.status.mockReset().mockResolvedValueOnce({ ...status, enabled: false })
    update({ selectedIds: ['a','b'] }, true)
    await mount()
    const doc = h.state.doc
    expect(control().disabled).toBe(true)
    await enter('帮我把原文中的图片加入我们自己的素材库')
    expect(control().textContent).toBe('收集图片到素材库')
    await run()
    expect(h.collect).toHaveBeenLastCalledWith(expect.objectContaining({ doc, selection: ['a','b'], isCurrent: expect.any(Function) }))
    expect(h.collect.mock.lastCall![0].isCurrent()).toBe(true)
    expect(h.edit).not.toHaveBeenCalled()
    expect(h.suggest).not.toHaveBeenCalled()
    expect(h.state.propose).not.toHaveBeenCalled()
    expect(h.state.doc).toBe(doc)
    await press(testId('close-collection-boundary'))
    expect(testId('close-collection-boundary')).toBeNull()
  })

  it.each(['不要把这些图片加入素材库', '请概括这篇文章'])('does not open the local image workflow for %s', async instruction => {
    h.status.mockReset().mockResolvedValueOnce({ ...status, enabled: false })
    await mount(); await enter(instruction); await run()
    expect(control().disabled).toBe(true)
    expect(h.collect).not.toHaveBeenCalled(); expect(h.edit).not.toHaveBeenCalled()
  })

  it('marks a captured collection stale across an edit-and-undo returning the same object', async () => {
    const original = h.state.doc
    await mount(); await press(testId('collect-article-images'))
    const current = h.collect.mock.lastCall![0].isCurrent
    expect(current()).toBe(true)
    act(() => { update({ doc: { ...original, title: 'Changed' } }); update({ doc: original }) })
    expect(current()).toBe(false)
    expect(h.edit).not.toHaveBeenCalled()
  })

  it('passes a signal for auto suggestions and aborts it on opening collection before displaying a late result', async () => {
    vi.useFakeTimers()
    const pending = deferred<string>()
    h.queue.mockReturnValueOnce(pending.promise)
    await mount()
    expect(h.queue).not.toHaveBeenCalled()
    await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
    expect(h.savePreference).toHaveBeenCalledExactlyOnceWith(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(h.queue).toHaveBeenCalledOnce()
    const signal: AbortSignal = h.queue.mock.calls[0][2]
    expect(signal.aborted).toBe(false)
    await press(testId('collect-article-images'))
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve('obsolete-suggestion'))
    expect(field().placeholder).not.toContain('obsolete-suggestion')
  })
})

it('delegates rule actions and settings navigation without invoking model editing', async () => {
  await mount()
  const settings = vi.fn()
  window.addEventListener('open-ai-settings', settings)
  try {
    await press(button('切换'))
    expect(settings).toHaveBeenCalledOnce()
    h.quick.mockReturnValueOnce({ summary: 'Rule proposal', ops: [] })
    await press(testId('qa-fixture'))
    expect(h.quick).toHaveBeenCalledExactlyOnceWith(h.state.doc)
    expect(h.state.propose).toHaveBeenCalledExactlyOnceWith('Rule proposal', [])
    expect(h.edit).not.toHaveBeenCalled()
  } finally { window.removeEventListener('open-ai-settings', settings) }
})

it('handles a rejected model status until settings changes refresh it', async () => {
  h.status.mockReset().mockRejectedValueOnce(new Error('status offline')).mockResolvedValueOnce(status)
  await mount()
  expect(control().disabled).toBe(true)
  await settingsEvent()
  expect(control().disabled).toBe(false)
  expect(host.textContent).toContain('fixture-model')
})

it('renders review progress and delegates preview and accept/reject without directly changing the document', async () => {
  const doc = h.state.doc
  const proposal: ProposalState = {
    summary: 'Review suggestion', base: doc, ignoredOps: 2, selectionPolicy: 'filter', errors: ['range warning'],
    items: [
      { op: { op: 'remove', id: 'a' }, status: 'pending' },
      { op: { op: 'remove', id: 'b' }, status: 'accepted' },
    ],
  }
  update({ proposal })
  await mount()
  expect(testId('review-progress').textContent).toBe('已接受 1 · 已拒绝 0 · 待审阅 1')
  expect(testId('proposal').textContent).toContain('已忽略 3 条无效操作')
  const preview = { ...doc, title: 'Preview title' }
  h.preview.mockReturnValueOnce(preview)
  h.compile.mockReturnValueOnce({ html: '<p>Phone preview</p>' })
  await press(button('预览效果'))
  expect(h.preview).toHaveBeenCalledExactlyOnceWith(proposal, doc)
  expect(h.compile).toHaveBeenCalledExactlyOnceWith(preview)
  expect(testId('preview-boundary').textContent).toContain('Phone preview')
  await press(testId('preview-boundary'))
  expect(testId('preview-boundary')).toBeNull()
  await press(testId('accept-all'))
  await press(button('全部拒绝'))
  expect(h.state.resolveProposal).toHaveBeenNthCalledWith(1, 'all', 'accepted', proposal)
  expect(h.state.resolveProposal).toHaveBeenNthCalledWith(2, 'all', 'rejected', proposal)
  await press(button('关闭'))
  expect(h.state.clearProposal).toHaveBeenCalledOnce()
  expect(h.state.doc).toBe(doc)
})

it('coalesces duplicate submission clicks dispatched before React commits the disabled state', async () => {
  await mount()
  await enter('修改排版')
  const pending = deferred<EditResult>()
  h.edit.mockReturnValue(pending.promise)
  const submit = control()
  act(() => { submit.click(); submit.click() })
  expect(h.edit).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve({ summary: 'One reply', ops: [] }))
  expect(h.state.propose).toHaveBeenCalledOnce()
})

it.each(['success', 'failure'] as const)('a stale status %s cannot override the newest model after two settings changes', async olderResult => {
  const older = deferred<AiStatus>(), middle = deferred<AiStatus>()
  h.status.mockReset().mockReturnValueOnce(older.promise).mockReturnValueOnce(middle.promise)
    .mockResolvedValueOnce({ ...status, model: 'New profile model' })
  await mount()
  await settingsEvent()
  await settingsEvent()
  expect(h.status).toHaveBeenCalledTimes(3)
  expect(host.textContent).toContain('New profile model')
  await act(async () => {
    if (olderResult === 'success') older.resolve({ ...status, model: 'Obsolete profile model' })
    else older.reject(new Error('Obsolete failure'))
    middle.resolve({ ...status, model: 'Middle profile model' })
  })
  expect(control().disabled).toBe(false)
  expect(host.textContent).toContain('New profile model')
  expect(host.textContent).not.toContain('Obsolete profile model')
  expect(host.textContent).not.toContain('Middle profile model')
})

it('StrictMode status replay and tab-unmount cannot resurrect an obsolete status listener', async () => {
  const first = deferred<AiStatus>(), last = deferred<AiStatus>()
  h.status.mockReset().mockReturnValueOnce(first.promise).mockResolvedValueOnce(status).mockReturnValueOnce(last.promise)
  await act(async () => root.render(createElement(StrictMode, null, createElement(RightPanel))))
  await tab('ai')
  expect(h.status).toHaveBeenCalledTimes(2)
  expect(host.textContent).toContain('fixture-model')
  await act(async () => first.resolve({ ...status, model: 'Stale strict replay' }))
  expect(host.textContent).not.toContain('Stale strict replay')
  await settingsEvent()
  await tab('style')
  await act(async () => last.resolve({ ...status, model: 'Late after unmount' }))
  await settingsEvent()
  expect(h.status).toHaveBeenCalledTimes(3)
  expect(host.textContent).not.toContain('Late after unmount')
})

it.each(['edit','switch'])('saving a theme never overwrites a later document %s',async change=>{
  vi.spyOn(window,'prompt').mockReturnValue('Saved theme')
  h.registerTheme.mockReturnValue(undefined)
  const pending=deferred<void>();h.saveTheme.mockReturnValue(pending.promise)
  await mount();await tab('theme');await press(button('保存为我的主题'))
  expect(h.saveTheme).toHaveBeenCalledOnce()
  const newer={...h.state.doc,title:'Unsaved newest title',...(change==='switch'?{id:'another-doc'}:{})}
  act(()=>update({doc:newer},change==='switch'))
  await act(async()=>pending.resolve())
  expect(h.state.commit).not.toHaveBeenCalled()
  expect(h.state.doc).toBe(newer)
  expect(h.registerTheme).toHaveBeenCalledOnce();expect(h.state.refreshThemes).toHaveBeenCalledOnce()
  expect(h.state.notify).toHaveBeenCalledWith(expect.stringContaining('未自动应用'))
})

const inputValue=async(el:HTMLInputElement|HTMLTextAreaElement,value:string)=>{await act(async()=>{
  const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value)
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))
})}
it('edits document metadata and displays only the cover receipt without mutating the draft directly',async()=>{
  update({selectedIds:[],doc:{...h.state.doc,cover:{src:'/media/cover.jpg'}}},true)
  h.variant.mockReturnValue('/synthetic-cover')
  await mount();await tab('style')
  const fields=host.querySelectorAll<HTMLInputElement>('.field input')
  await inputValue(fields[0],'New title');await inputValue(fields[1],'Writer');await inputValue(host.querySelector('textarea')!,'Summary')
  expect(h.state.setDocFields).toHaveBeenNthCalledWith(1,{title:'New title'},'title')
  expect(h.state.setDocFields).toHaveBeenNthCalledWith(2,{author:'Writer'},'author')
  expect(h.state.setDocFields).toHaveBeenNthCalledWith(3,{digest:'Summary'},'digest')
  expect(h.variant).toHaveBeenCalledWith('/media/cover.jpg','235:100',600)
  expect(host.querySelector('img')?.getAttribute('src')).toBe('/synthetic-cover')
  await press([...host.querySelectorAll('button')].find(x=>x.textContent?.includes('设计封面'))!)
  expect(host.textContent).toContain('Cover boundary')
})
it('updates theme tokens by field identity and clears overrides on explicit reset or preset selection',async()=>{
  const theme=getTheme('minimal-magazine')
  update({themes:[theme],doc:{...h.state.doc,themeOverrides:{fontSize:17,colors:{accent:'#123456'}} as Doc['themeOverrides']}})
  await mount();await tab('theme')
  await inputValue(host.querySelector<HTMLInputElement>('input[type=color]')!,'#112233')
  expect(h.state.commit).toHaveBeenLastCalledWith({...h.state.doc,themeOverrides:{fontSize:17,colors:{accent:'#123456',primary:'#112233'}}},'theme:c-primary')
  await inputValue(host.querySelector<HTMLInputElement>('input[type=range]')!,'16')
  expect(h.state.commit).toHaveBeenLastCalledWith({...h.state.doc,themeOverrides:{fontSize:16,colors:{accent:'#123456'}}},'theme:fontSize')
  await press(button('重置'));expect(h.state.commit).toHaveBeenLastCalledWith({...h.state.doc,themeOverrides:undefined})
  await press(testId('theme-'+theme.id));expect(h.state.commit).toHaveBeenLastCalledWith({...h.state.doc,themeId:theme.id,themeOverrides:undefined})
})
it('normalizes only supported variant-bearing blocks and leaves other content untouched',async()=>{
  const heading=createBlock('heading',{title:'Heading',variant:'bar'}),paragraph=createBlock('paragraph'),html=createBlock('html',{html:'<p>Keep</p>'})
  update({doc:{...h.state.doc,blocks:[heading,paragraph,html]}})
  await mount();await tab('theme');await press(button('全部模块样式跟随主题'))
  expect(h.state.commit).toHaveBeenCalledExactlyOnceWith({...h.state.doc,blocks:[{...heading,props:{...heading.props,variant:'auto'}},paragraph,html]})
})
it('canceling theme naming never saves and a successful unchanged draft applies the saved receipt',async()=>{
  const prompt=vi.spyOn(window,'prompt').mockReturnValueOnce(null).mockReturnValueOnce('Named theme')
  h.saveTheme.mockResolvedValue(undefined);h.registerTheme.mockReturnValue(undefined)
  await mount();await tab('theme');await press(button('保存为我的主题'));expect(h.saveTheme).not.toHaveBeenCalled()
  await press(button('保存为我的主题'))
  const saved=h.saveTheme.mock.calls[0][0]
  expect(saved).toMatchObject({name:'Named theme',description:'用户自定义主题'})
  expect(h.registerTheme).toHaveBeenCalledExactlyOnceWith(saved)
  expect(h.state.commit).toHaveBeenCalledExactlyOnceWith({...h.state.doc,themeId:saved.id,themeOverrides:undefined})
  expect(prompt).toHaveBeenCalledTimes(2);expect(h.state.notify).toHaveBeenCalledExactlyOnceWith('主题已保存')
})
it('gates reference fetching on authorization and reports rejected fetch or insufficient style evidence',async()=>{
  await mount();await tab('reference')
  const fetchButton=button('抓取并分析')
  expect(fetchButton.disabled).toBe(true)
  await inputValue(host.querySelector('input[type=text],input:not([type])')!,'https://fixture.invalid/article')
  expect(fetchButton.disabled).toBe(true)
  await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  h.fetchReference.mockRejectedValueOnce(Error('Reference unavailable'))
  await press(fetchButton);expect(h.state.notify).toHaveBeenLastCalledWith('Reference unavailable','error')
  h.fetchReference.mockResolvedValueOnce({html:'<p>Small sample</p>'});h.analyze.mockReturnValueOnce({sampleCount:2})
  await press(fetchButton);expect(h.analyze.mock.calls[0][0].textContent).toBe('Small sample')
  expect(h.state.notify).toHaveBeenLastCalledWith(expect.stringContaining('样式样本太少'),'error')
  expect(h.themeFrom).not.toHaveBeenCalled();expect(h.saveTheme).not.toHaveBeenCalled()
})
it('renders an analyzed reference receipt and persists its named theme without copying article content',async()=>{
  const report={sampleCount:4,colors:[{color:'#123456',count:3}],fontSizes:[{size:16},{size:24}],lineHeight:1.6,letterSpacing:0,paragraphSpacing:12,radius:2,traits:{borderLeft:1,pill:0,centered:2,images:1}}
  const draft={...getTheme('minimal-magazine'),id:'reference-theme'}
  h.analyze.mockReturnValue(report);h.themeFrom.mockReturnValue(draft);h.saveTheme.mockResolvedValue(undefined);h.registerTheme.mockReturnValue(undefined)
  vi.spyOn(window,'prompt').mockReturnValueOnce(null).mockReturnValueOnce('')
  await mount();await tab('reference')
  await inputValue(host.querySelector('textarea')!,'<p style="color:#123456">Reference text</p>')
  expect(button('分析粘贴内容').disabled).toBe(true)
  await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  await press(button('分析粘贴内容'))
  expect(h.analyze.mock.calls[0][0].textContent).toBe('Reference text')
  expect(h.themeFrom).toHaveBeenCalledWith(report,'参考风格主题')
  expect(host.textContent).toContain('提取结果（4 个样式样本）');expect(host.textContent).toContain('16px / 24px')
  const doc=h.state.doc
  await press(button('保存并应用为新主题'))
  expect(h.saveTheme).not.toHaveBeenCalled()
  expect(h.state.commit).not.toHaveBeenCalled()
  await press(button('保存并应用为新主题'))
  expect(h.saveTheme).toHaveBeenCalledExactlyOnceWith({...draft,name:'我的参考风格'})
  expect(h.state.commit).toHaveBeenCalledExactlyOnceWith({...doc,themeId:draft.id,themeOverrides:undefined})
  expect(h.state.doc).toBe(doc);expect(h.state.notify).toHaveBeenCalledWith('已创建并应用主题「我的参考风格」')
})
it('keeps a saved reference theme in the library without applying it to a newly selected document',async()=>{
  h.analyze.mockReturnValue({sampleCount:3,colors:[],fontSizes:[],lineHeight:1.6,letterSpacing:0,paragraphSpacing:12,radius:2,traits:{borderLeft:0,pill:0,centered:0,images:0}})
  const draft={...getTheme('minimal-magazine'),id:'saved-reference'},pending=deferred<void>()
  h.themeFrom.mockReturnValue(draft);h.saveTheme.mockReturnValue(pending.promise);h.registerTheme.mockReturnValue(undefined)
  vi.spyOn(window,'prompt').mockReturnValue('Reference saved')
  await mount();await tab('reference');await inputValue(host.querySelector('textarea')!,'<p>sample</p>')
  await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await press(button('分析粘贴内容'))
  await press(button('保存并应用为新主题'))
  const next={...h.state.doc,id:'new-document',title:'Do not modify'}
  act(()=>update({doc:next},true));await act(async()=>pending.resolve())
  expect(h.state.commit).not.toHaveBeenCalled();expect(h.state.doc).toBe(next)
  expect(h.registerTheme).toHaveBeenCalledExactlyOnceWith({...draft,name:'Reference saved'})
  expect(h.state.notify).toHaveBeenCalledWith(expect.stringContaining('未自动应用'))
})

it('prevents duplicate theme saves and keeps a closed panel from applying the late result',async()=>{
  h.registerTheme.mockReturnValue(undefined)
  const pending=deferred<void>()
  h.saveTheme.mockReturnValue(pending.promise)
  vi.spyOn(window,'prompt').mockReturnValue('Deferred theme')
  await mount();await tab('theme')
  const action=button('保存为我的主题')
  await act(async()=>{action.click();action.click()})
  expect(h.saveTheme).toHaveBeenCalledTimes(1)
  expect(action.disabled).toBe(true)
  await tab('style')
  await act(async()=>pending.resolve())
  expect(h.registerTheme).toHaveBeenCalledTimes(1)
  expect(h.state.refreshThemes).toHaveBeenCalledTimes(1)
  expect(h.state.commit).not.toHaveBeenCalled()
})

it('reports reference theme persistence failure and leaves the same draft available to retry',async()=>{
  h.registerTheme.mockReturnValue(undefined)
  const report={sampleCount:3,colors:[],fontSizes:[],traits:{}}
  h.analyze.mockReturnValue(report)
  h.themeFrom.mockReturnValue({...getTheme('minimal-magazine'),id:'retry-reference'})
  h.saveTheme.mockRejectedValueOnce(new Error('Theme storage unavailable')).mockResolvedValueOnce(undefined)
  vi.spyOn(window,'prompt').mockReturnValue('Reference retry')
  await mount();await tab('reference')
  await inputValue(host.querySelector('textarea')!,'<p>sample</p>')
  await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  await press(button('分析粘贴内容'))
  const action=button('保存并应用为新主题')
  await press(action)
  expect(h.state.notify).toHaveBeenCalledWith('Theme storage unavailable','error')
  expect(h.state.commit).not.toHaveBeenCalled()
  expect(action.disabled).toBe(false)
  await press(action)
  expect(h.saveTheme).toHaveBeenCalledTimes(2)
  expect(h.state.commit).toHaveBeenCalledTimes(1)
})

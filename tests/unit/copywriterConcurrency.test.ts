// @vitest-environment jsdom
import { act, createElement, type ReactNode, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ api: vi.fn(), notify: vi.fn() }))
vi.mock('../../src/editor/api', () => ({ api: { aiCopywrite: (input: unknown) => h.api(input) } }))
vi.mock('../../src/editor/store', () => ({ useStore: (f: (state: { notify: typeof h.notify }) => unknown) => f({ notify: h.notify }) }))
vi.mock('../../src/editor/Modal', () => ({ Modal: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => createElement('section', null, createElement('button', { 'data-testid': 'close-modal', onClick: onClose }, 'Close'), children) }))
import { Copywriter } from '../../src/editor/Copywriter'
let root: Root, host: HTMLDivElement, props: ComponentProps<typeof Copywriter>
const by = (id: string) => host.querySelector(`[data-testid="${id}"]`)
const click = async (e: Element | null) => { expect(e).toBeTruthy(); await act(async () => (e as HTMLElement).click()) }
const change = async (e: Element | null, value: string) => {
  expect(e).toBeTruthy()
  await act(async () => {
    const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(e, value)
    e!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const mount = () => act(async () => root.render(createElement(Copywriter, props)))
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  props = { onClose: vi.fn(), onImport: vi.fn(), levels: 2, hasText: false }
  h.api.mockRejectedValue(Error('Unexpected aiCopywrite call'))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const deferred = () => { let resolve!: (x: string) => void, reject!: (e: Error) => void; const promise = new Promise<string>((a, b) => { resolve = a; reject = b }); return { resolve, reject, promise } }
it('same-tick duplicate generation starts one request only', async () => {
  const d = deferred(); h.api.mockReturnValue(d.promise)
  await mount(); await change(by('cw-brief'), 'Brief')
  await act(async () => { (by('cw-generate') as HTMLElement).click(); (by('cw-generate') as HTMLElement).click() })
  await act(async () => d.resolve('# Result'))
  expect(h.api).toHaveBeenCalledOnce()
})
it.each(['close', 'unmount'])('ignores late failure after %s rather than showing an unrelated error', async mode => {
  const d = deferred(); h.api.mockReturnValue(d.promise)
  props.onClose = () => root.render(null)
  await mount(); await change(by('cw-brief'), 'Brief'); await click(by('cw-generate'))
  if (mode === 'close') await click(by('close-modal')); else await act(async () => root.render(null))
  await act(async () => d.reject(Error('late model failure')))
  expect(h.notify).not.toHaveBeenCalled()
})
it('does not replace a manual edit made during pending generation', async () => {
  const d = deferred(); h.api.mockReturnValue(d.promise)
  await mount(); await change(by('cw-brief'), 'Brief'); await click(by('cw-generate'))
  await change(by('cw-result'), '# User correction')
  await act(async () => d.resolve('# Late model result'))
  expect((by('cw-result') as HTMLTextAreaElement).value).toBe('# User correction')
})
it.each(['resolve', 'reject'] as const)('import unmounts the modal; a late %s must not affect wizard text or notify', async mode => {
  const d = deferred(); h.api.mockReturnValueOnce(d.promise)
  // ImportWizard setText/setWriting(false): retain imported parent value and remove Copywriter.
  const imported = vi.fn()
  props.onImport = imported
  props.onClose = () => root.render(null)
  await mount(); await change(by('cw-brief'), 'Brief'); await change(by('cw-result'), '# User draft')
  await click(by('cw-rewrite')); await click(by('cw-import'))
  expect(imported).toHaveBeenCalledExactlyOnceWith('# User draft')
  expect(by('cw-result')).toBeNull()
  await act(async () => { if (mode === 'resolve') d.resolve('# Late result'); else d.reject(Error('late model failure')) })
  expect(imported).toHaveBeenCalledExactlyOnceWith('# User draft')
  expect(h.notify).not.toHaveBeenCalled()
})
it('manual heading correction while generation is pending is retained with explicit feedback', async () => {
  const d = deferred(); h.api.mockReturnValue(d.promise)
  props.levels = 1; await mount(); await change(by('cw-brief'), 'Brief')
  await change(by('cw-result'), '# Title\n\n## Section\n\n### Deep\n\nText')
  await click(by('cw-rewrite')); await click(by('cw-check')!.querySelector('button'))
  const edited = (by('cw-result') as HTMLTextAreaElement).value
  await act(async () => d.resolve('# Late result'))
  expect((by('cw-result') as HTMLTextAreaElement).value).toBe(edited)
  expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('保留'))
  expect((by('cw-generate') as HTMLButtonElement).disabled).toBe(false)
})
it('a declined replace confirmation leaves the pending rewrite valid', async () => {
  const d = deferred(); h.api.mockReturnValueOnce(d.promise)
  props.hasText = true
  vi.mocked(window.confirm).mockReturnValueOnce(false)
  await mount(); await change(by('cw-brief'), 'Brief'); await change(by('cw-result'), '# Original')
  await click(by('cw-rewrite')); await click(by('cw-import'))
  expect(props.onImport).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
  await act(async () => d.resolve('# Revised'))
  expect((by('cw-result') as HTMLTextAreaElement).value).toBe('# Revised')
})
it('counts A to B to A as manual editing and retains the draft and instructions', async () => {
  const d = deferred(); h.api.mockReturnValueOnce(d.promise)
  await mount(); await change(by('cw-brief'), 'Brief'); await change(by('cw-result'), '# Original')
  await change(by('cw-revise'), 'Keep the facts')
  await click(by('cw-rewrite'))
  await change(by('cw-result'), '# Edit'); await change(by('cw-result'), '# Original')
  await act(async () => d.resolve('# Late'))
  expect((by('cw-result') as HTMLTextAreaElement).value).toBe('# Original')
  expect((by('cw-revise') as HTMLInputElement).value).toBe('Keep the facts')
  expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('保留'))
})
it('a previous instance cannot notify or release a newly reopened request', async () => {
  const oldRequest = deferred(), newRequest = deferred()
  h.api.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
  props.onClose = () => root.render(null)
  await mount(); await change(by('cw-brief'), 'Old'); await click(by('cw-generate'))
  await click(by('close-modal')); expect(by('cw-result')).toBeNull()
  await mount(); await change(by('cw-brief'), 'New'); await click(by('cw-generate'))
  await act(async () => oldRequest.reject(Error('stale request')))
  expect(h.notify).not.toHaveBeenCalled()
  expect((by('cw-generate') as HTMLButtonElement).disabled).toBe(true)
  await act(async () => newRequest.resolve('# New article'))
  expect((by('cw-result') as HTMLTextAreaElement).value).toBe('# New article')
})

it.each([
  ['new instructions', ['Try a shorter conclusion'], 'Try a shorter conclusion'],
  ['A to B to A', ['Try a shorter conclusion', 'Keep the facts'], 'Keep the facts'],
  ['unchanged instructions', [], ''],
] as const)('accepts the requested draft and retains only newer revision input: %s', async (_mode, edits, expected) => {
  const d = deferred()
  h.api.mockReturnValueOnce(d.promise)
  await mount()
  await change(by('cw-brief'), 'Brief')
  await change(by('cw-result'), '# Original')
  await change(by('cw-revise'), 'Keep the facts')
  await click(by('cw-rewrite'))
  expect(h.api).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ previous: '# Original', revise: 'Keep the facts' }))
  for (const edit of edits) await change(by('cw-revise'), edit)
  await act(async () => d.resolve('# Revised'))
  expect((by('cw-result') as HTMLTextAreaElement).value).toBe('# Revised')
  expect((by('cw-revise') as HTMLInputElement).value).toBe(expected)
  expect((by('cw-rewrite') as HTMLButtonElement).disabled).toBe(false)
})

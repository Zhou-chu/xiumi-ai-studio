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
it('requires brief and sends selected style, length, levels and requirements', async () => {
  h.api.mockResolvedValueOnce('# Title\n\n## Section\n\nBody text')
  await mount(); expect((by('cw-generate') as HTMLButtonElement).disabled).toBe(true)
  await change(by('cw-brief'), 'Event details'); await change(by('cw-style'), ' Custom voice ')
  await change(host.querySelector('.cw-form > label:last-of-type input'), 'Must mention volunteers')
  await click(by('cw-levels-3')); await click(host.querySelectorAll('.cw-form .seg')[1].querySelectorAll('button')[0])
  await click(by('cw-generate'))
  expect(h.api).toHaveBeenCalledExactlyOnceWith({ brief: 'Event details', style: 'Custom voice', length: '800–1200', levels: 3, extra: 'Must mention volunteers' })
  expect((by('cw-result') as HTMLTextAreaElement).value).toContain('# Title')
  expect(by('cw-check')).toBeTruthy()
})
it('preset selection clears custom style and revision sends current edited text plus instruction', async () => {
  h.api.mockResolvedValueOnce('# Title\n\n## Section\n\nBody text')
  h.api.mockResolvedValueOnce('# Title\n\n## Section\n\nBody text')
  await mount(); await change(by('cw-brief'), 'Brief'); await change(by('cw-style'), 'Custom')
  await click(host.querySelector('.cw-form .seg button'))
  expect((by('cw-style') as HTMLInputElement).value).toBe('')
  await click(by('cw-generate'))
  expect(h.api.mock.calls[0][0].style).toContain('新闻通讯')
  await change(by('cw-result'), '# Edited\n\nBody'); await change(by('cw-revise'), 'Shorter')
  await click(by('cw-rewrite'))
  expect(h.api.mock.calls[1][0]).toMatchObject({ previous: '# Edited\n\nBody', revise: 'Shorter' })
  expect((by('cw-revise') as HTMLInputElement).value).toBe('')
})
it('reports empty or failed output without erasing existing text', async () => {
  await mount(); await change(by('cw-brief'), 'Brief'); await change(by('cw-result'), '# Keep\n\nBody')
  h.api.mockResolvedValueOnce(''); await click(by('cw-generate'))
  expect(h.notify).toHaveBeenCalledWith(expect.any(String), 'error')
  expect((by('cw-result') as HTMLTextAreaElement).value).toBe('# Keep\n\nBody')
  h.api.mockRejectedValueOnce(Error('offline')); await click(by('cw-generate'))
  expect(h.notify).toHaveBeenCalledWith('offline', 'error')
  expect((by('cw-generate') as HTMLButtonElement).disabled).toBe(false)
})
it('requires replacement confirmation and imports exact edited result before closing', async () => {
  props.hasText = true; await mount(); await change(by('cw-result'), '# Manual\n\nBody')
  vi.mocked(window.confirm).mockReturnValueOnce(false)
  await click(by('cw-import')); expect(props.onImport).not.toHaveBeenCalled()
  await click(by('cw-import')); expect(props.onImport).toHaveBeenCalledExactlyOnceWith('# Manual\n\nBody')
  expect(props.onClose).toHaveBeenCalledOnce()
})
it('shows copy problems and converts over-deep headings without external requests', async () => {
  props.levels = 1; await mount()
  await change(by('cw-result'), '# Title\n\n## Section\n\n### Too deep\n\n值得一提的是【待补充】')
  expect(by('cw-check')?.textContent).toContain('待补充')
  await click(by('cw-check')!.querySelector('button'))
  expect((by('cw-result') as HTMLTextAreaElement).value).not.toContain('### Too deep')
  expect(h.api).not.toHaveBeenCalled()
})
it.each([0, 8])('uses bounded initial heading level for kit %i', async levels => {
  props.levels = levels; await mount()
  expect(by(`cw-levels-${levels ? 3 : 2}`)?.classList.contains('on')).toBe(true)
})

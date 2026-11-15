// @vitest-environment jsdom
import { act, createElement, type ReactNode, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ collect: vi.fn(), api: vi.fn() }))
vi.mock('../../src/editor/api', () => ({ api: { importArticleImages: (urls: string[]) => h.api(urls) } }))
vi.mock('../../src/core/articleImages', () => ({ collectArticleImages: (doc: unknown, selection: unknown) => h.collect(doc, selection) }))
vi.mock('../../src/editor/Modal', () => ({ Modal: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => createElement('section', null, createElement('button', { 'data-testid': 'modal-close', onClick: onClose }, 'Close'), children) }))
import { ArticleImageImport } from '../../src/editor/ArticleImageImport'
let root: Root, host: HTMLDivElement, props: ComponentProps<typeof ArticleImageImport>
const click = async (e: Element | null) => { expect(e).toBeTruthy(); await act(async () => (e as HTMLElement).click()) }
const start = () => host.querySelector('.primary')
const checks = () => host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
const mount = () => act(async () => root.render(createElement(ArticleImageImport, props)))
const deferred = () => { let resolve!: (x: unknown) => void; const promise = new Promise<unknown>(r => resolve = r); return { resolve, promise } }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  props = { doc: { id: 'd', title: '', author: '', digest: '', themeId: 'minimal-magazine', createdAt: 1, updatedAt: 1, blocks: [] }, isCurrent: vi.fn(() => true), onClose: vi.fn() }
  h.collect.mockReturnValue(['https://img.test/a', 'https://img.test/b'])
  h.api.mockRejectedValue(Error('Unexpected importArticleImages call'))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('snapshots document, scope and URLs once; empty selection disables submission', async () => {
  props.selection = ['b']; await mount()
  expect(h.collect).toHaveBeenCalledWith(props.doc, ['b'])
  await click(checks()[0]); await click(checks()[1]); expect((start() as HTMLButtonElement).disabled).toBe(true)
  await click(checks()[1]); expect((start() as HTMLButtonElement).disabled).toBe(false)
  props = { ...props, selection: undefined, doc: { ...props.doc, id: 'other' } }; await mount()
  expect(h.collect).toHaveBeenCalledOnce()
  h.api.mockResolvedValueOnce([{ url: 'https://img.test/b', status: 'imported' }]); await click(start()); expect(h.api).toHaveBeenCalledExactlyOnceWith(['https://img.test/b'])
})
it('empty collected range renders guidance and no API action', async () => {
  h.collect.mockReturnValue([]); await mount(); await click(start())
  expect(checks()).toHaveLength(0); expect(h.api).not.toHaveBeenCalled()
  expect(host.querySelectorAll('[role=status]')).toHaveLength(2)
})
it('rejects an obsolete snapshot reported by its caller without requesting any image', async () => {
  await mount(); vi.mocked(props.isCurrent).mockReturnValue(false); await click(start())
  expect(host.querySelector('[role=alert]')).toBeTruthy(); expect(h.api).not.toHaveBeenCalled()
})
it('tracks imported/existing results, publishes asset refresh and disables successful selections', async () => {
  h.api.mockResolvedValueOnce([{ url: 'https://img.test/a', status: 'imported' }]).mockResolvedValueOnce([{ url: 'https://img.test/b', status: 'existing' }])
  const changed = vi.fn(); window.addEventListener('assets-changed', changed)
  try {
    await mount(); await click(start())
    expect(h.api.mock.calls).toEqual([[['https://img.test/a']], [['https://img.test/b']]])
    expect(changed).toHaveBeenCalledTimes(2)
    expect([...checks()].every(c => c.disabled)).toBe(true)
    expect((start() as HTMLButtonElement).disabled).toBe(true)
  } finally { window.removeEventListener('assets-changed', changed) }
})
it('retries failed or unconfirmed URLs only, retaining previous successful progress', async () => {
  h.api.mockResolvedValueOnce([{ url: 'https://img.test/a', status: 'imported' }]).mockRejectedValueOnce(Error('offline'))
  await mount(); await click(start())
  expect(checks()[0].disabled).toBe(true); expect(checks()[1].disabled).toBe(false)
  expect(host.textContent).toContain('失败或未确认 1 张')
  h.api.mockResolvedValueOnce([]); await click(start())
  expect(host.textContent).toContain('失败或未确认 1 张')
  h.api.mockResolvedValueOnce([{ url: 'https://img.test/b', status: 'imported' }]); await click(start())
  expect(h.api.mock.calls).toEqual([[['https://img.test/a']], [['https://img.test/b']], [['https://img.test/b']], [['https://img.test/b']]])
  expect((start() as HTMLButtonElement).disabled).toBe(true)
})
it('guards same-tick duplicate starts while keeping controls disabled during the request', async () => {
  const d = deferred(); h.api.mockReturnValueOnce(d.promise).mockResolvedValueOnce([{ url: 'https://img.test/b', status: 'imported' }])
  await mount(); await act(async () => { (start() as HTMLElement).click(); (start() as HTMLElement).click() })
  expect(h.api).toHaveBeenCalledOnce(); expect([...checks()].every(c => c.disabled)).toBe(true)
  await act(async () => d.resolve([{ url: 'https://img.test/a', status: 'imported' }]))
  expect(h.api).toHaveBeenCalledTimes(2)
})
it.each(['close', 'unmount'])('stops remaining downloads after %s but refreshes a successful in-flight save', async mode => {
  const d = deferred(); h.api.mockReturnValueOnce(d.promise)
  const changed = vi.fn(); window.addEventListener('assets-changed', changed)
  try {
    await mount(); await click(start())
    if (mode === 'close') await click(host.querySelector('[data-testid=modal-close]'))
    else await act(async () => root.render(null))
    await act(async () => d.resolve([{ url: 'https://img.test/a', status: 'imported' }]))
    expect(h.api).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce()
    if (mode === 'close') expect(props.onClose).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('assets-changed', changed) }
})
it('explicit failed result does not publish assets and the cancel action delegates close', async () => {
  h.api.mockImplementation(async ([url]) => [{ url, status: 'failed', error: 'Denied' }])
  const changed = vi.fn(); window.addEventListener('assets-changed', changed)
  try {
    await mount(); await click(start()); expect(changed).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Denied')
    await click(host.querySelector('.modal-actions button')); expect(props.onClose).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('assets-changed', changed) }
})

it('stops the remaining items when the caller invalidates the snapshot during a response', async () => {
  const d = deferred(); h.api.mockReturnValueOnce(d.promise)
  await mount(); await click(start()); vi.mocked(props.isCurrent).mockReturnValue(false)
  await act(async () => d.resolve([{ url: 'https://img.test/a', status: 'imported' }]))
  expect(h.api).toHaveBeenCalledExactlyOnceWith(['https://img.test/a'])
  expect(host.querySelector('[role=alert]')?.textContent).toContain('已停止剩余图片')
})
it('marks a previously managed playback glyph as existing without calling it a new asset', async () => {
  h.collect.mockReturnValueOnce(['https://img.test/a'])
  h.api.mockResolvedValueOnce([{ url: 'https://img.test/a', status: 'existing', kind: 'glyph' }])
  await mount(); await click(start())
  expect(host.textContent).toContain('已管理的回放字形资源')
  expect(host.textContent).toContain('新增 0 张，已存在 1 张')
})

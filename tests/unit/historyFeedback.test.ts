// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VersionsModal } from '../../src/editor/Toolbar'
import { api } from '../../src/editor/api'
import { emptyDoc, useStore } from '../../src/editor/store'
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  useStore.getState().load(emptyDoc())
  useStore.setState({ toast: null })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!
const render = async () => { await act(async () => root.render(createElement(VersionsModal, { onClose: vi.fn() }))) }
it('shows list failure instead of claiming no versions and supports retry', async () => {
  vi.spyOn(api, 'versions').mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
  await render()
  expect(document.body.textContent).toContain('暂时无法加载版本列表')
  expect(document.body.textContent).not.toContain('还没有保存过版本')
  await act(async () => button('重试').click())
  expect(document.body.textContent).toContain('还没有保存过版本')
  expect(document.body.textContent).not.toContain('暂时无法加载版本列表')
})
it('shows failed snapshot save, preserves edits, and allows retry', async () => {
  vi.spyOn(api, 'versions').mockResolvedValue([])
  vi.spyOn(window, 'prompt').mockReturnValue('snapshot')
  vi.spyOn(api, 'saveVersion').mockRejectedValueOnce(new Error('disk full')).mockResolvedValue({ id: 'v1', label: 'snapshot', createdAt: 1, blockCount: 1 })
  await render()
  const original = useStore.getState().doc
  await act(async () => button('保存当前为新版本').click())
  expect(useStore.getState().toast).toMatchObject({ text: '版本保存失败，当前文稿未改变，请重试。', kind: 'error' })
  expect(useStore.getState().doc).toBe(original)
  await act(async () => button('保存当前为新版本').click())
  expect(useStore.getState().toast).toMatchObject({ text: '版本已保存', kind: 'ok' })
  expect(useStore.getState().doc).toBe(original)
})
it('shows failed restoration and keeps the current document', async () => {
  vi.spyOn(api, 'versions').mockResolvedValue([{ id: 'v1', label: 'snapshot', createdAt: 1, blockCount: 1 }])
  vi.spyOn(api, 'version').mockRejectedValue(new Error('offline'))
  await render()
  const original = useStore.getState().doc
  await act(async () => button('恢复').click())
  expect(useStore.getState().toast).toMatchObject({ text: '版本恢复失败，当前文稿未改变，请重试。', kind: 'error' })
  expect(useStore.getState().doc).toBe(original)
})
it.each(['cancel', 'switch', 'edit'] as const)('ignores delayed restoration after %s', async (action) => {
  vi.spyOn(api, 'versions').mockResolvedValue([{ id: 'v1', label: 'snapshot', createdAt: 1, blockCount: 1 }])
  let finish!: (value: Awaited<ReturnType<typeof api.version>>) => void
  vi.spyOn(api, 'version').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render()
  const original = useStore.getState().doc
  await act(async () => button('恢复').click())
  await act(async () => {
    if (action === 'cancel') root.render(null)
    if (action === 'switch') useStore.getState().load({ ...emptyDoc(), title: 'New project' })
    if (action === 'edit') useStore.getState().commit({ ...original, title: 'New edits' })
  })
  const expected = useStore.getState().doc
  await act(async () => finish({ doc: { ...original, title: 'OLD SNAPSHOT' } }))
  expect(useStore.getState().doc).toBe(expected)
})
it('restores an unchanged document and keeps restoration undoable', async () => {
  vi.spyOn(api, 'versions').mockResolvedValue([{ id: 'v1', label: 'snapshot', createdAt: 1, blockCount: 1 }])
  const original = useStore.getState().doc
  vi.spyOn(api, 'version').mockResolvedValue({ doc: { ...original, title: 'Saved title' } })
  await render()
  await act(async () => button('恢复').click())
  expect(useStore.getState().doc.title).toBe('Saved title')
  await act(async () => useStore.getState().undo())
  expect(useStore.getState().doc).toEqual(original)
})

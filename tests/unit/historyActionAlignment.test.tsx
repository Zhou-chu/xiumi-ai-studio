// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Toolbar } from '../../src/editor/Toolbar'
import { api } from '../../src/editor/api'
import { emptyDoc, useStore } from '../../src/editor/store'
import { button, cleanup, click, host, mount, setup, state } from './libraryToolbarHarness'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

const entry = (id: string, label: string) => ({ id, label, createdAt: 1, blockCount: 1 })
const open = async () => {
  await mount(<Toolbar />)
  await click(button('历史版本'))
}

beforeEach(() => {
  setup()
  useStore.setState({ toast: null })
})
afterEach(cleanup)

it('reports an initial list failure safely instead of displaying a successful empty state', async () => {
  vi.spyOn(api, 'versions').mockRejectedValue(new Error('private-list-fixture'))
  await open()
  expect(state().toast?.kind).toBe('error')
  expect(state().toast?.text).toContain('加载版本列表失败')
  expect(state().toast?.text).not.toContain('private-list-fixture')
  expect(host.textContent).not.toContain('还没有保存过版本')
})

it('shows a genuine empty history without a list-failure warning', async () => {
  vi.spyOn(api, 'versions').mockResolvedValue([])
  await open()
  expect(host.textContent).toContain('还没有保存过版本')
  expect(state().toast).toBeNull()
})

it('loads the new project history and ignores a previous project’s late list failure', async () => {
  const old = deferred<Awaited<ReturnType<typeof api.versions>>>()
  const list = vi.spyOn(api, 'versions')
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([entry('new-v', 'Current project history')])
  await open()
  const next = { ...emptyDoc(), title: 'Another project' }
  await act(async () => state().load(next))
  const previousToast = state().toast
  await act(async () => old.reject(new Error('private stale list fixture')))
  expect(list).toHaveBeenLastCalledWith(next.id)
  expect(host.textContent).toContain('Current project history')
  expect(state().toast).toBe(previousToast)
})

it('does not use an earlier restore result when the user picked a newer version', async () => {
  const original = state().doc
  const first = deferred<Awaited<ReturnType<typeof api.version>>>()
  const second = deferred<Awaited<ReturnType<typeof api.version>>>()
  vi.spyOn(api, 'versions').mockResolvedValue([entry('v1', 'Earlier choice'), entry('v2', 'Latest choice')])
  const restore = vi.spyOn(api, 'version').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  await open()
  const choices = [...host.querySelectorAll('button')].filter(button => button.textContent?.trim() === '恢复')
  await click(choices[0])
  await click(choices[1])
  expect(restore.mock.calls).toEqual([[original.id, 'v1'], [original.id, 'v2']])
  await act(async () => first.resolve({ doc: { ...original, title: 'Earlier snapshot' } }))
  expect(state().doc).toBe(original)
  await act(async () => second.resolve({ doc: { ...original, title: 'Latest snapshot' } }))
  expect(state().doc.title).toBe('Latest snapshot')
})

it('does not report a stale restore error after the current draft changes', async () => {
  const pending = deferred<Awaited<ReturnType<typeof api.version>>>()
  vi.spyOn(api, 'versions').mockResolvedValue([entry('v1', 'Stored')])
  vi.spyOn(api, 'version').mockReturnValue(pending.promise)
  await open()
  await click(button('恢复'))
  await act(async () => state().setDocFields({ title: 'New edits' }))
  const current = state().doc
  const currentToast = state().toast
  await act(async () => pending.reject(new Error('private stale restore fixture')))
  expect(state().doc).toBe(current)
  expect(state().toast).toBe(currentToast)
})

it('keeps a saved version acknowledged when only its following list refresh fails', async () => {
  const pendingList = deferred<Awaited<ReturnType<typeof api.versions>>>()
  vi.spyOn(api, 'versions').mockResolvedValueOnce([]).mockReturnValueOnce(pendingList.promise)
  const save = vi.spyOn(api, 'saveVersion').mockResolvedValue(entry('saved', 'Saved'))
  await open()
  await click(button('保存当前为新版本'))
  expect(state().toast?.text).toBe('版本已保存')
  await act(async () => pendingList.reject(new Error('private post-save listing detail')))
  expect(state().toast?.text).toContain('加载版本列表失败')
  expect(state().toast?.text).not.toContain('private post-save listing detail')
  expect(save).toHaveBeenCalledTimes(1)
})

it('ignores a pending save acknowledgement after the document leaves and returns in one render', async () => {
  const pending = deferred<Awaited<ReturnType<typeof api.saveVersion>>>()
  const list = vi.spyOn(api, 'versions').mockResolvedValue([])
  vi.spyOn(api, 'saveVersion').mockReturnValue(pending.promise)
  await open()
  const original = state().doc
  await click(button('保存当前为新版本'))
  await act(async () => {
    useStore.setState({ doc: emptyDoc() })
    useStore.setState({ doc: original })
  })
  const currentToast = state().toast
  await act(async () => pending.resolve(entry('v1', 'Saved')))
  expect(list).toHaveBeenCalledTimes(1)
  expect(state().toast).toBe(currentToast)
})

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError } from '../../src/editor/api'
import { emptyDoc, saveConflictCopy, saveNow, useStore } from '../../src/editor/store'

beforeEach(() => { vi.useFakeTimers(); useStore.getState().load({ ...emptyDoc(), revision: 'v1' }) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
it('keeps persistence revision separate from undo history', async () => {
  const save = vi.spyOn(api, 'saveProject').mockResolvedValue({ updatedAt: 1, revision: 'v2' })
  useStore.getState().setDocFields({ title: 'edit' })
  await saveNow()
  useStore.getState().undo()
  await saveNow()
  expect(save.mock.calls[1][0].revision).toBe('v2')
})
it('coalesces overlapping same-page saves and carries revision into later edits', async () => {
  let finish!: (value: { updatedAt: number; revision: string }) => void
  const save = vi.spyOn(api, 'saveProject').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const first = saveNow()
  useStore.getState().setDocFields({ title: 'during request' })
  const second = saveNow()
  expect(save).toHaveBeenCalledTimes(1)
  finish({ updatedAt: 1, revision: 'v2' })
  expect(await first).toBe(false)
  expect(await second).toBe(false)
  save.mockResolvedValue({ updatedAt: 2, revision: 'v3' })
  await saveNow()
  expect(save.mock.calls[1][0]).toMatchObject({ title: 'during request', revision: 'v2' })
})

it('retains conflicts and failed recovery, then saves a separate copy', async () => {
  const original = useStore.getState().doc
  const save = vi.spyOn(api, 'saveProject').mockRejectedValue(new ApiError('conflict', 409))
  expect(await saveNow()).toBe(false)
  expect(useStore.getState().saveConflict).toBe(true)
  useStore.getState().setDocFields({ title: 'keep my work' })
  expect(await saveNow()).toBe(false)
  expect(save).toHaveBeenCalledTimes(1)
  save.mockRejectedValue(new Error('offline'))
  expect(await saveConflictCopy()).toBe(false)
  expect(useStore.getState().doc).toMatchObject({ id: original.id, title: 'keep my work' })
  expect(useStore.getState().saveConflict).toBe(true)
  save.mockResolvedValue({ updatedAt: 1, revision: 'copy-v1' })
  expect(await saveConflictCopy()).toBe(true)
  expect(useStore.getState().doc.id).not.toBe(original.id)
  expect(useStore.getState().doc.title).toBe('keep my work（冲突副本）')
  expect(useStore.getState().savedRevision).toBe('copy-v1')
  expect(useStore.getState().saveConflict).toBe(false)
})
it('keeps edits made during recovery and prevents duplicate copy requests', async () => {
  useStore.setState({ saveConflict: true, saveStatus: 'error' })
  let finish!: (value: { updatedAt: number; revision: string }) => void
  const save = vi.spyOn(api, 'saveProject').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const copying = saveConflictCopy()
  expect(await saveConflictCopy()).toBe(false)
  useStore.getState().setDocFields({ author: 'edited during recovery', title: 'new title during recovery' })
  expect(await saveConflictCopy()).toBe(false)
  finish({ updatedAt: 1, revision: 'copy-v1' })
  expect(await copying).toBe(false)
  expect(useStore.getState().doc.author).toBe('edited during recovery')
  expect(useStore.getState().doc.title).toBe('new title during recovery（冲突副本）')
  save.mockResolvedValue({ updatedAt: 2, revision: 'copy-v2' })
  await saveNow()
  expect(save.mock.calls[1][0]).toMatchObject({ author: 'edited during recovery', revision: 'copy-v1' })
})

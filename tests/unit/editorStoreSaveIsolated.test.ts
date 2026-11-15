import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Doc } from '../../src/core/types'

type Acknowledgment = { updatedAt: number; revision?: string }

const { saveProject } = vi.hoisted(() => ({
  saveProject: vi.fn<(doc: Doc) => Promise<Acknowledgment>>(),
}))
vi.mock('../../src/editor/api', () => ({ api: { saveProject } }))

import { emptyDoc, flushSave, saveBeforeLeave, saveConflictCopy, saveNow, useStore } from '../../src/editor/store'

const state = useStore.getState
function load(title: string, revision: string) {
  state().load({ ...emptyDoc(), title, revision })
  return state().doc
}
const edit = (title: string) => state().setDocFields({ title })
const ack = (revision: string): Acknowledgment => ({ updatedAt: 1, revision })

function holdSave() {
  let resolve!: (result: Acknowledgment) => void
  let entered!: (doc: Doc) => void
  const started = new Promise<Doc>(accept => { entered = accept })
  saveProject.mockImplementationOnce(doc => {
    entered(doc)
    return new Promise(complete => { resolve = complete })
  })
  return { started, resolve: (value: Acknowledgment) => resolve(value) }
}

beforeEach(() => {
  vi.useFakeTimers()
  saveProject.mockReset()
  saveProject.mockRejectedValue(new Error('unexpected save request'))
  load('original', 'r1')
  useStore.setState({ toast: null })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('skips an old queued save after switching documents and ignores the old in-flight response', async () => {
  const old = state().doc
  const pending = holdSave()
  const first = saveNow()
  expect(await pending.started).toMatchObject({ id: old.id, revision: 'r1' })
  const queued = saveNow()
  const newer = load('new document', 'new-r1')
  edit('new document edited')
  saveProject.mockResolvedValueOnce(ack('new-r2'))
  const current = saveNow()
  pending.resolve(ack('old-r2'))
  await expect(first).resolves.toBe(false)
  await expect(queued).resolves.toBe(false)
  await expect(current).resolves.toBe(true)
  expect(saveProject.mock.calls.map(([d]) => [d.id, d.revision])).toEqual([[old.id, 'r1'], [newer.id, 'new-r1']])
  expect(state()).toMatchObject({ savedRevision: 'new-r2', saveStatus: 'saved', doc: { id: newer.id, title: 'new document edited' } })
})

it('debounces consecutive edits and sends only the latest document with its accepted revision', async () => {
  saveProject.mockResolvedValueOnce(ack('r2'))
  edit('first title')
  await vi.advanceTimersByTimeAsync(1000)
  edit('last title')
  await vi.advanceTimersByTimeAsync(1199)
  expect(saveProject).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(saveProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'last title', revision: 'r1' }))
  expect(state()).toMatchObject({ savedRevision: 'r2', saveStatus: 'saved' })
})

it('retries a newer edit using the revision returned by its in-flight predecessor', async () => {
  const pending = holdSave()
  const first = saveNow()
  await pending.started
  edit('newer title')
  pending.resolve(ack('r2'))
  await expect(first).resolves.toBe(false)
  expect(state()).toMatchObject({ savedRevision: 'r2', saveStatus: 'dirty', doc: { title: 'newer title' } })
  saveProject.mockResolvedValueOnce(ack('r3'))
  await vi.advanceTimersByTimeAsync(799)
  expect(saveProject).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(saveProject).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: 'newer title', revision: 'r2' }))
  expect(state()).toMatchObject({ savedRevision: 'r3', saveStatus: 'saved' })
})

it('flushes through an in-flight edit and resolves only after sending the newer contents', async () => {
  const pending = holdSave()
  const flush = flushSave()
  await pending.started
  edit('latest required by flush')
  saveProject.mockResolvedValueOnce(ack('r3'))
  pending.resolve(ack('r2'))
  await expect(flush).resolves.toBeUndefined()
  expect(saveProject).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: 'latest required by flush', revision: 'r2' }))
  expect(state()).toMatchObject({ savedRevision: 'r3', saveStatus: 'saved' })
})

it('rejects a flush that cannot settle within its bounded attempts without dropping the latest edit', async () => {
  let edits = 0
  saveProject.mockImplementation(async () => {
    edits += 1
    edit(`ongoing ${edits}`)
    return ack(`r${edits + 1}`)
  })
  await expect(flushSave()).rejects.toThrow('内容仍在变化')
  expect(saveProject).toHaveBeenCalledTimes(5)
  expect(state()).toMatchObject({ saveStatus: 'dirty', doc: { title: 'ongoing 5' } })
})

it('refuses leaving after a failed write and keeps the exact current draft', async () => {
  edit('keep this edit')
  const draft = state().doc
  saveProject.mockRejectedValueOnce(new Error('disk unavailable'))
  await expect(saveBeforeLeave()).resolves.toBe(false)
  expect(state().doc).toBe(draft)
  expect(state()).toMatchObject({ saveStatus: 'error', saveError: 'disk unavailable', toast: { kind: 'error' } })
})

async function establishConflict() {
  saveProject.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  await expect(saveNow()).resolves.toBe(false)
  expect(state().saveConflict).toBe(true)
}

it('coalesces concurrent conflict-copy commands and puts in-flight edits on the new draft', async () => {
  const original = state().doc
  await establishConflict()
  const pending = holdSave()
  const result = saveConflictCopy()
  const attempted = await pending.started
  expect(attempted.id).not.toBe(original.id)
  expect(attempted.revision).toBeUndefined()
  expect(attempted.title).toBe('original（冲突副本）')
  await expect(saveConflictCopy()).resolves.toBe(false)
  edit('changed during copy')
  pending.resolve(ack('copy-r1'))
  await expect(result).resolves.toBe(false)
  expect(state()).toMatchObject({ doc: { id: attempted.id, title: 'changed during copy（冲突副本）' }, savedRevision: 'copy-r1', saveConflict: false, saveStatus: 'dirty' })
  saveProject.mockResolvedValueOnce(ack('copy-r2'))
  await vi.advanceTimersByTimeAsync(800)
  expect(saveProject).toHaveBeenNthCalledWith(3, expect.objectContaining({ id: attempted.id, title: 'changed during copy（冲突副本）', revision: 'copy-r1' }))
  expect(state()).toMatchObject({ savedRevision: 'copy-r2', saveStatus: 'saved' })
})

it('does not replace a newer loaded draft when a previous conflict copy finishes', async () => {
  await establishConflict()
  const pending = holdSave()
  const result = saveConflictCopy()
  await pending.started
  const newer = load('another document', 'another-r1')
  pending.resolve(ack('copy-r1'))
  await expect(result).resolves.toBe(false)
  expect(state()).toMatchObject({ doc: { id: newer.id, title: 'another document' }, saveStatus: 'saved', savedRevision: 'another-r1', saveConflict: false })
  expect(saveProject).toHaveBeenCalledTimes(2)
})

it('retains the conflicted draft and permits another copy after a failed attempt', async () => {
  await establishConflict()
  edit('recoverable contents')
  const draft = state().doc
  saveProject.mockRejectedValueOnce(new Error('copy failed'))
  await expect(saveConflictCopy()).resolves.toBe(false)
  expect(state().doc).toBe(draft)
  expect(state()).toMatchObject({ saveStatus: 'error', saveError: 'copy failed', saveConflict: true })
  saveProject.mockResolvedValueOnce(ack('copy-r1'))
  await expect(saveConflictCopy()).resolves.toBe(true)
  expect(state().doc.id).not.toBe(draft.id)
  expect(state()).toMatchObject({ saveStatus: 'saved', savedRevision: 'copy-r1', saveConflict: false })
})

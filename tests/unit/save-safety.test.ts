// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
import { emptyDoc, saveNow, useStore } from '../../src/editor/store'

beforeEach(() => {
  vi.useFakeTimers()
  useStore.getState().load(emptyDoc())
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

it('reports failed persistence to callers while retaining the unsaved document', async () => {
  useStore.getState().setDocFields({ title: '尚未保存的原稿' })
  const doc = useStore.getState().doc
  vi.spyOn(api, 'saveProject').mockRejectedValue(new Error('磁盘已满'))
  expect(await saveNow()).toBe(false)
  expect(useStore.getState().doc).toBe(doc)
  expect(useStore.getState().saveStatus).toBe('error')
  expect(useStore.getState().saveError).toContain('磁盘已满')
})

it('reports successful persistence so a caller may safely leave the document', async () => {
  vi.spyOn(api, 'saveProject').mockResolvedValue({ updatedAt: Date.now() })
  expect(await saveNow()).toBe(true)
  expect(useStore.getState().saveStatus).toBe('saved')
})

it('does not report navigation-safe success if the user edits while saving', async () => {
  let finish!: (value: {updatedAt:number}) => void
  vi.spyOn(api, 'saveProject').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const saving = saveNow()
  useStore.getState().setDocFields({ title: '请求期间的新编辑' })
  finish({ updatedAt: Date.now() })
  expect(await saving).toBe(false)
  expect(useStore.getState().doc.title).toBe('请求期间的新编辑')
  expect(useStore.getState().saveStatus).not.toBe('saved')
})

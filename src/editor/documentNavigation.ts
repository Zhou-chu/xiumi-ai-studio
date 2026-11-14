import type { Doc } from '../core/types'
import { useStore } from './store'

/** An async read/save must never discard edits made after navigation began. */
export function loadIfUnchanged(next: Doc, expected: Doc): boolean {
  const state = useStore.getState()
  if (state.doc !== expected) {
    state.notify('等待期间文档已变化，已保留当前内容。请保存后重试切换。', 'error')
    return false
  }
  state.load(next)
  return true
}

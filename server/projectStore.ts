import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { collection, safeId } from './store'

type Project = { id: string; revision?: string; [key: string]: any }
// One API process owns DATA_DIR. Serialize the read/check/write transaction, not
// just the final rename. Deletion shares this queue so stale saves cannot revive it.
const pending = new Map<string, Promise<unknown>>()
function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).then(action)
  const settled = result.then(() => {}, () => {})
  pending.set(key, settled)
  void settled.then(() => { if (pending.get(key) === settled) pending.delete(key) })
  return result
}
function versioned<T extends Project>(doc: T): T & { revision: string } {
  // Stable read-only migration: old files need not be rewritten on GET.
  return { ...doc, revision: doc.revision ?? `legacy-${createHash('sha256').update(JSON.stringify(doc)).digest('hex')}` }
}
export function projectCollection<T extends Project = Project>(dir: string) {
  const base = collection<T>(dir)
  const key = (id: string) => resolve(dir, `${safeId(id)}.json`)
  return {
    ...base,
    async get(id: string) { const doc = await base.get(id); return doc ? versioned(doc) : null },
    put(item: T) {
      const snapshot = structuredClone(item)
      return serialize(key(item.id), async () => {
        const current = await base.get(snapshot.id)
        if (current ? snapshot.revision !== versioned(current).revision : snapshot.revision != null) {
          throw Object.assign(new Error('此稿件已在其他页面修改或删除。当前内容未覆盖服务器，请另存副本或导出备份。'), { status: 409 })
        }
        const doc = { ...snapshot, revision: randomUUID(), updatedAt: Date.now() }
        await base.put(doc)
        return doc
      })
    },
    remove: (id: string) => serialize(key(id), () => base.remove(id)),
  }
}

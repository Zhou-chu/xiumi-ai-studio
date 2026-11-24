import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { collection, safeId } from './store'

type Project = { id: string; revision?: string; [key: string]: any }
// One API process owns DATA_DIR. Serialize the read/check/write transaction, not
// just the final publication. Reads, deletion and restore share this queue.
const pending = new Map<string, Promise<unknown>>()
function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).then(action)
  const settled = result.then(() => {}, () => {})
  pending.set(key, settled)
  void settled.then(() => { if (pending.get(key) === settled) pending.delete(key) })
  return result
}
async function pathOccupied(path: string) {
  // Detect corrupt files and links, not just readable JSON.
  try { await lstat(path); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
function versioned<T extends Project>(doc: T): T & { revision: string } {
  // Stable read-only migration: old files need not be rewritten on GET.
  return { ...doc, revision: doc.revision ?? `legacy-${createHash('sha256').update(JSON.stringify(doc)).digest('hex')}` }
}
export function projectCollection<T extends Project = Project>(dir: string) {
  const base = collection<T>(dir)
  const root = resolve(dir)
  const target = (id: string) => join(root, `${safeId(id)}.json`)
  const key = (file: string) => process.platform === 'win32' ? file.toLowerCase() : file
  return {
    ...base,
    async get(id: string) {
      return serialize(key(target(id)), async () => {
        const doc = await base.get(id)
        return doc ? versioned(doc) : null
      })
    },
    put(item: T) {
      const snapshot = structuredClone(item)
      return serialize(key(target(snapshot.id)), async () => {
        const current = await base.get(snapshot.id)
        if (current ? snapshot.revision !== versioned(current).revision : snapshot.revision != null) {
          throw Object.assign(new Error('此稿件已在其他页面修改或删除。当前内容未覆盖服务器，请另存副本或导出备份。'), { status: 409 })
        }
        const doc = { ...snapshot, revision: randomUUID(), updatedAt: Date.now() }
        await base.put(doc)
        return doc
      })
    },
    serializeDependent<R>(id: string, action: () => Promise<R>) {
      return serialize(key(target(id)), action)
    },
    /** Read a current local revision under the same queue without touching its bytes. */
    withCurrentRevision<R>(id: string, action: (current: T & { revision: string }) => Promise<R>) {
      const file = target(id)
      return serialize(key(file), async () => {
        try {
          const info = await lstat(file)
          if (!info.isFile() || info.nlink !== 1) return null
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
        const current = await base.get(id)
        return current?.id === id ? action(versioned(current)) : null
      })
    },
    /** Lock an exact live parent for dependent data writes. The callback must not re-enter this project collection. */
    withRevision<R>(id: string, revision: string, action: (current: T) => Promise<R>) {
      return serialize(key(target(id)), async () => {
        const current = await base.get(id)
        if (!current || current.id !== id || versioned(current).revision !== revision) return null
        return action(current)
      })
    },
    occupied: (id: string) => pathOccupied(target(id)),
    // An optional dependency publisher runs only for a fresh parent,
    // inside the same queue as ordinary PUT/remove. It must not re-enter it.
    async restore(item: T, prepareFresh?: () => Promise<boolean>) {
      const snapshot = structuredClone(item)
      const file = target(snapshot.id)
      return serialize(key(file), async () => {
        if (prepareFresh && (await pathOccupied(file) || !(await prepareFresh()))) return null
        const doc = { ...snapshot, revision: randomUUID() }
        const staging = await mkdtemp(join(root, '.restore-'))
        try {
          const complete = join(staging, 'project.json')
          await writeFile(complete, JSON.stringify(doc), { encoding: 'utf8', flag: 'wx' })
          try {
            // Hard-link only a complete same-volume file. Unlike a content
            // read or exists check, this cannot mistake corrupt data for absence.
            await link(complete, file)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null
            throw error
          }
          return doc
        } finally {
          // Cleanup errors must not hide a successful publication or collision.
          await rm(staging, { recursive: true, force: true }).catch(() => {})
        }
      })
    },
    remove: (id: string) => serialize(key(target(id)), () => base.remove(id)),
  }
}

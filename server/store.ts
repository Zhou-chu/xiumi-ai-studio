// 本地文件存储：项目、历史版本、模板收藏、自定义主题、素材。
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { link, lstat, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'
import { dirname, join, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '..')
export const DATA = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'))
export const DIRS = {
  projects: join(DATA, 'projects'),
  versions: join(DATA, 'versions'),
  templates: join(DATA, 'templates'),
  components: join(DATA, 'components'),
  themes: join(DATA, 'themes'),
  assets: join(DATA, 'assets'),
  cache: join(DATA, 'cache'),
}
for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true })

const SAFE_ID = /^[\w-]{1,64}$/
export function safeId(id: string) {
  if (!SAFE_ID.test(id)) throw Object.assign(new Error('非法 id'), { status: 400 })
  return id
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

// Windows 不允许对同一目标并发替换；不同文件仍可独立保存。
const pendingWrites = new Map<string, Promise<void>>()

function serializeWrite<T>(target: string, action: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? target.toLowerCase() : target
  const write = (pendingWrites.get(key) ?? Promise.resolve()).then(action)
  const settled = write.then(() => {}, () => {})
  pendingWrites.set(key, settled)
  void settled.then(() => { if (pendingWrites.get(key) === settled) pendingWrites.delete(key) })
  return write
}

export type RestoreStatus = 'available' | 'alreadyPresent' | 'conflict'
type RestorePublication = 'restored' | Exclude<RestoreStatus, 'available'>

async function compareArchivedJson(target: string, value: unknown): Promise<RestoreStatus> {
  // An archive must not publish into an existing redirected collection.
  if (!(await lstat(dirname(target))).isDirectory()) return 'conflict'
  try {
    const file = await lstat(target)
    if (!file.isFile() || file.size > 32 * 1024 * 1024) return 'conflict'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'available'
    throw error
  }
  const current = await readJson<unknown>(target, null)
  return isDeepStrictEqual(current, value) ? 'alreadyPresent' : 'conflict'
}

async function publishArchivedJson(target: string, value: unknown): Promise<RestorePublication> {
  const current = await compareArchivedJson(target, value)
  if (current !== 'available') return current
  const tmp = `${target}.${randomUUID()}.restore-tmp`
  try {
    await writeFile(tmp, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' })
    try {
      await link(tmp, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'conflict'
      throw error
    }
    return 'restored'
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

/** 原子写入，避免保存中断导致项目损坏 */
export async function writeJson(file: string, data: unknown) {
  const target = resolve(file)
  // 在排队前捕获数据，避免调用方后续修改对象影响本次保存。
  const json = JSON.stringify(data)
  await serializeWrite(target, async () => {
    const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`
    let published = false
    try {
      await writeFile(tmp, json, 'utf8')
      // Windows scanners/read handles may temporarily deny an atomic replacement.
      // Keep the old destination and this temporary file intact between attempts.
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(tmp, target)
          published = true
          break
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error
          await delay(20 * 2 ** attempt)
        }
      }
    } finally {
      // A successful rename consumed the temp path. Never report cleanup
      // failure as failed publication, or coupled callers might undo data
      // referenced by the already-published index.
      if (!published) await rm(tmp, { force: true }).catch(() => {})
    }
  })
}

export function collection<T extends { id: string }>(dir: string) {
  // Version collections are nested per project and may be opened before any save.
  mkdirSync(dir, { recursive: true })
  const target = (id: string) => resolve(dir, `${safeId(id)}.json`)
  return {
    async list(): Promise<T[]> {
      const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
      return Promise.all(files.map((f) => readJson<T>(join(dir, f), null as unknown as T))).then((xs) => xs.filter(Boolean))
    },
    get: (id: string) => readJson<T | null>(join(dir, `${safeId(id)}.json`), null),
    put: (item: T) => writeJson(join(dir, `${safeId(item.id)}.json`), item),
    remove: (id: string) => {
      const file = target(id)
      return serializeWrite(file, () => rm(file, { force: true }))
    },
    restoreStatus(item: { id: string }) {
      const file = target(item.id)
      return serializeWrite(file, () => compareArchivedJson(file, item))
    },
    withRestoreEntry<U>(item: { id: string }, action: (restore: () => Promise<RestorePublication>, status: () => Promise<RestoreStatus>) => Promise<U>) {
      const file = target(item.id)
      return serializeWrite(file, () => action(() => publishArchivedJson(file, item), () => compareArchivedJson(file, item)))
    },
    exists: (id: string) => existsSync(join(dir, `${safeId(id)}.json`)),
  }
}

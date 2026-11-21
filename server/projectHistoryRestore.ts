import { link, lstat, mkdir, mkdtemp, opendir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Doc } from '../src/core/types'
import type { projectCollection } from './projectStore'
import { safeId } from './store'
import { verifyHistoryDirectory } from './historyDirectory'

export type VersionSnapshot = { id: string; projectId: string; label: string; createdAt: number; doc: Doc }
type BoundHistory = { sourceParent: Doc; parentRevision: string; version: VersionSnapshot }
type ActiveParent = { id: string; revision?: string }
type ParentStore<T extends ActiveParent> = Pick<ReturnType<typeof projectCollection<T>>, 'withRevision'>
type Result = 'restored' | 'occupied' | 'parent-unavailable' | 'retention-limit'
export const VERSION_RETENTION_LIMIT = 50
const MAX_SCAN = 10_000
const status = (error: unknown) => (error as NodeJS.ErrnoException).code
const invalid = () => Object.assign(new Error('历史版本无法安全归入该项目'), { status: 400 })

async function exists(path: string) {
  try { await lstat(path); return true }
  catch (error) { if (status(error) === 'ENOENT') return false; throw error }
}

async function requireDirectDirectory(path: string) {
  if (!(await verifyHistoryDirectory(path))) throw invalid()
}

function sameProject(source: Doc, active: ActiveParent) {
  const expected = { ...source }, actual = { ...active }
  delete expected.revision
  delete actual.revision
  return isDeepStrictEqual(expected, actual)
}

async function full(directory: string) {
  let scanned = 0, candidates = 0
  for await (const entry of await opendir(directory)) {
    if (++scanned > MAX_SCAN) return true
    // Conservatively count unreadable and interrupted existing history too.
    if (entry.name.toLowerCase().endsWith('.json') && ++candidates >= VERSION_RETENTION_LIMIT) return true
  }
  return false
}

/**
 * Local storage adapter for an already decoded and canonically validated legacy
 * project/child pair. Never feed raw HTTP, unvalidated ZIP data, or strings
 * identifying arbitrary roots here. The library integration must validate the
 * archive path/payload identity and all document dependencies before calling.
 *
 * The ordinary version writer shares this parent queue in the app. Imported
 * writes never evict existing versions.
 */
export function projectHistoryRestore<T extends ActiveParent>(directory: string, projects: ParentStore<T>) {
  const root = resolve(directory)
  return {
    async restore(request: BoundHistory): Promise<Result> {
      const { sourceParent, parentRevision, version } = structuredClone(request)
      const pid = safeId(sourceParent.id), vid = safeId(version.id)
      if (pid !== version.projectId || pid !== version.doc.id || typeof parentRevision !== 'string' ||
          !parentRevision || typeof version.label !== 'string' || version.label.length > 2000 ||
          !Number.isSafeInteger(version.createdAt) || version.createdAt < 0) throw invalid()
      const write = await projects.withRevision<Result>(pid, parentRevision, async current => {
        if (!sameProject(sourceParent, current)) return 'parent-unavailable'
        await requireDirectDirectory(root)
        const parent = join(root, pid)
        try { await mkdir(parent) }
        catch (error) { if (status(error) !== 'EEXIST') throw error }
        await requireDirectDirectory(parent)
        const target = join(parent, vid + '.json')
        if (await exists(target)) return 'occupied'
        if (await full(parent)) return 'retention-limit'
        const stage = await mkdtemp(join(root, '.version-restore-'))
        try {
          const completed = join(stage, 'version.json')
          const record = { id: vid, projectId: pid, label: version.label, createdAt: version.createdAt, doc: version.doc }
          await writeFile(completed, JSON.stringify(record), { encoding: 'utf8', flag: 'wx' })
          await requireDirectDirectory(parent)
          try { await link(completed, target) }
          catch (error) { if (status(error) === 'EEXIST') return 'occupied'; throw error }
          return 'restored'
        } finally {
          await rm(stage, { recursive: true, force: true }).catch(() => {})
        }
      })
      return write ?? 'parent-unavailable'
    },
  }
}

import { crc32 } from 'node:zlib'
import { openPromise, type Entry, type ZipFile } from 'yauzl'
import type { projectCollection } from './projectStore'

const PROJECT = /^projects\/([\w-]{1,64})\.json$/
const OTHER_LIBRARY_ENTRY = /^(?:settings\.json|assets\/_index\.json|assets\/[\w-]{1,64}\.(?:jpg|png)|(?:templates|components|themes)\/[\w-]{1,64}\.json|versions\/[\w-]{1,64}\/[\w-]{1,80}\.json)$/
const MANIFEST = 'xiumi-backup.json'
// These bounds cover only the in-memory project stage, not the upload size of
// a full library ZIP. Assets are not loaded into memory by this stage.
const DEFAULT_BUDGET = {
  maxEntries: 500_000,
  maxNameBytes: 32 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  totalProjectBytes: 128 * 1024 * 1024,
}
const invalid = () => Object.assign(new Error('备份格式无效或项目文件已损坏'), { status: 400 })
const tooLarge = () => Object.assign(new Error('备份超出了项目恢复的读取上限'), { status: 413 })
type ProjectStore = Pick<ReturnType<typeof projectCollection>, 'occupied' | 'restore'>
type Project = Parameters<ProjectStore['restore']>[0]
type ProjectArchive = { projects: Project[]; otherLibraryEntries: string[] }

async function readJsonEntry(zip: ZipFile, entry: Entry, limit: number): Promise<unknown> {
  if (entry.uncompressedSize > limit) throw tooLarge()
  const stream = await zip.openReadStreamPromise(entry)
  let length = 0
  let checksum = 0
  const chunks: Buffer[] = []
  for await (const piece of stream) {
    const chunk = Buffer.from(piece)
    length += chunk.length
    if (length > limit) throw tooLarge()
    checksum = crc32(chunk, checksum)
    chunks.push(chunk)
  }
  if (checksum !== entry.crc32) throw invalid()
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readLegacyArchive(path: string, budget: typeof DEFAULT_BUDGET): Promise<ProjectArchive> {
  const projects: Project[] = []
  const otherLibraryEntries: string[] = []
  const seen = new Set<string>()
  let sawManifest = false
  let consumed = 0
  let count = 0
  let nameBytes = 0
  let zip: ZipFile | undefined
  try {
    zip = await openPromise(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true })
    if (zip.entryCount > budget.maxEntries) throw tooLarge()
    for await (const entry of zip.eachEntry()) {
      if (++count > budget.maxEntries) throw tooLarge()
      const name = entry.fileName
      const key = name.toLowerCase()
      // Bound the seen set and the names kept for the unsupported list. Unicode
      // normalization to lowercase may increase the size of the retained key.
      nameBytes += Buffer.byteLength(key, 'utf8')
      if (key !== name) nameBytes += Buffer.byteLength(name, 'utf8')
      if (nameBytes > budget.maxNameBytes) throw tooLarge()
      if (seen.has(key)) throw invalid()
      seen.add(key)
      if (name === MANIFEST) {
        const manifest = await readJsonEntry(zip, entry, 64 * 1024)
        if (!isObject(manifest) || manifest.app !== 'xiumi-ai-studio') throw invalid()
        sawManifest = true
      } else {
        const id = PROJECT.exec(name)?.[1]
        if (id) {
          consumed += entry.uncompressedSize
          if (consumed > budget.totalProjectBytes) throw tooLarge()
          const value = await readJsonEntry(zip, entry, budget.entryBytes)
          if (!isObject(value) || value.id !== id || !Array.isArray(value.blocks)) throw invalid()
          projects.push({ ...value, id })
        } else if (OTHER_LIBRARY_ENTRY.test(name)) {
          otherLibraryEntries.push(name)
        }
      }
    }
    if (!sawManifest) throw invalid()
    return {
      projects: projects.sort((a, b) => a.id.localeCompare(b.id, 'en')),
      otherLibraryEntries: otherLibraryEntries.sort((a, b) => a.localeCompare(b, 'en')),
    }
  } catch (error) {
    if ((error as { status?: number }).status === 413) throw error
    throw invalid()
  } finally {
    zip?.close()
  }
}

/**
 * Internal project-only stage, not a full library restore endpoint. The source
 * ZIP is read once; confirmation cannot switch it or accidentally follow a
 * manifest-provided path. Other library categories are surfaced but not applied.
 */
export async function stageLegacyProjects(path: string, store: ProjectStore, limits: Partial<typeof DEFAULT_BUDGET> = {}) {
  const budget = { ...DEFAULT_BUDGET, ...limits }
  if (Object.values(budget).some(value => !Number.isSafeInteger(value) || value < 1)) throw new RangeError('Invalid restore budget')
  const { projects, otherLibraryEntries } = await readLegacyArchive(path, budget)
  let used = false
  return {
    async preview() {
      const add: string[] = [], skip: string[] = []
      for (const { id } of projects) (await store.occupied(id) ? skip : add).push(id)
      return { add, skip, notRestoredByProjectStage: [...otherLibraryEntries] }
    },
    async apply() {
      if (used) throw new Error('恢复计划已使用')
      used = true
      const restored: string[] = [], skipped: string[] = []
      // Do not reuse the preview decision: restore checks occupancy atomically
      // with normal writes, even if content appeared after preview.
      for (const doc of projects) (await store.restore(doc) ? restored : skipped).push(doc.id)
      return { restored, skipped }
    },
  }
}

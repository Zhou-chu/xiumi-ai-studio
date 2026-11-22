import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { readAssetMetadata, isAssetCatalog, validateArchivedRaster } from './legacyRaster'
import type { ArchivedAsset } from './assets'
import type { HistoryCandidate } from './legacyProjectRestore'
import { verifyHistoryDirectory } from './historyDirectory'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

const categories = ['projects', 'versions', 'templates', 'components', 'themes', 'assets'] as const
type Category = typeof categories[number]
type Count = Record<'available' | 'occupied' | 'blocked', number>
type MigrationPreview = {
  sourceLayout: 'checkout' | 'data'
  mode: 'metadata-only'
  categories: Record<Category, Count>
  metadata: { settingsDetected: boolean; wechatEnvDetected: boolean; assetIndexDetected: boolean }
}

class LocalMigrationError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

const invalid = () => new LocalMigrationError('旧版数据预览需要已明确配置的本机文件夹，且不能与当前数据目录重叠', 400)
const inaccessible = () => new LocalMigrationError('无法安全读取配置的旧版数据目录，请检查其位置和权限', 400)
const tooLarge = () => new LocalMigrationError('目录条目超过迁移预览上限', 413)
const changed = () => new LocalMigrationError('旧版数据目录或项目已变化，请重新检测', 409)
const MAX_PROJECT_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_PROJECT_BYTES = 32 * 1024 * 1024
const MAX_HISTORY_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_HISTORY_BYTES = 32 * 1024 * 1024
const MAX_INDEX_BYTES = 4 * 1024 * 1024
const MAX_ASSET_BYTES = 32 * 1024 * 1024
const MAX_TOTAL_ASSET_BYTES = 64 * 1024 * 1024
const id = /^[\w-]{1,64}$/
const jsonFile = /^[\w-]{1,64}\.json$/
const revision = /^[\w-]{1,80}\.json$/
const asset = /^[\w-]{1,64}\.(?:jpg|png)$/
const comparable = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name

/** Only local absolute paths provided by the process owner; never accept a request path. */
async function ownerDirectory(name: string) {
  if (!isAbsolute(name) || /^[\\/]{2}/.test(name) || Array.from(name, char => char.charCodeAt(0)).some(code => code < 32 || code === 127)
    || process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(name)) throw invalid()
  const path = resolve(name)
  if (path === parse(path).root) throw invalid()
  return canonicalDirectory(path)
}

async function canonicalDirectory(path: string) {
  const lexical = await lstat(path, { bigint: true })
  if (!lexical.isDirectory() || !await verifyHistoryDirectory(path)) throw invalid()
  const canonical = await realpath(path)
  const check = await lstat(canonical, { bigint: true })
  if (!check.isDirectory() || !sameIdentity(lexical, check) ||
      !await verifyHistoryDirectory(path) || !sameIdentity(lexical, await lstat(path, { bigint: true }))) throw changed()
  return { path: canonical, identity: [lexical.dev, lexical.ino, lexical.birthtimeNs].join(':'), verify: verifyDirectoryIdentity(canonical, lexical) }
}

async function inspect(path: string) {
  try { return await lstat(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function directDirectory(path: string) {
  const info = await inspect(path)
  return !!info?.isDirectory() && await verifyHistoryDirectory(path)
}

function contains(parent: string, child: string) {
  const rel = relative(comparable(parent), comparable(child))
  return rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
}

function disjoint(a: string, b: string) {
  if (contains(a, b) || contains(b, a)) throw invalid()
}

async function recognizable(path: string) {
  for (const category of categories) if (await directDirectory(join(path, category))) return true
  return (await inspect(join(path, 'settings.json')))?.isFile() ?? false
}

async function* leaves(root: string, pattern: RegExp, scan: () => void): AsyncGenerator<string> {
  if (!await directDirectory(root)) return
  for await (const entry of await opendir(root)) {
    scan()
    if (entry.isFile() && pattern.test(entry.name)) yield entry.name
  }
}

async function* files(source: string, category: Category, scan: () => void): AsyncGenerator<string[]> {
  const directory = join(source, category)
  if (category !== 'versions') {
    for await (const file of leaves(directory, category === 'assets' ? asset : jsonFile, scan)) yield [category, file]
    return
  }
  if (!await directDirectory(directory)) return
  for await (const project of await opendir(directory)) {
    scan()
    if (!project.isDirectory() || !id.test(project.name)) continue
    for await (const file of leaves(join(directory, project.name), revision, scan)) yield [category, project.name, file]
  }
}

async function occupancy(target: string, segments: string[]): Promise<keyof Count> {
  const folder = join(target, segments[0])
  const info = await inspect(folder)
  if (!info) return 'available'
  if (!info.isDirectory() || !await directDirectory(folder)) return 'blocked'
  if (segments.length === 3) {
    const nested = join(folder, segments[1])
    const parent = await inspect(nested)
    if (!parent) return 'available'
    if (!parent.isDirectory() || !await directDirectory(nested)) return 'blocked'
  }
  return await inspect(join(target, ...segments)) ? 'occupied' : 'available'
}

async function metadata(source: string, data: string): Promise<MigrationPreview['metadata']> {
  const assets = join(data, 'assets')
  return {
    settingsDetected: (await inspect(join(data, 'settings.json')))?.isFile() ?? false,
    wechatEnvDetected: (await inspect(join(source, '.env')))?.isFile() ?? false,
    assetIndexDetected: await directDirectory(assets) && ((await inspect(join(assets, '_index.json')))?.isFile() ?? false),
  }
}

type Options = {
  configuredSource: string | undefined
  target: string
  maxEntries?: number
  maxProjectBytes?: number
  maxTotalProjectBytes?: number
}
type ProjectCandidate = Record<string, unknown> & { id: string; blocks: unknown[] }
type SourceSnapshot = {
  sourceLayout: MigrationPreview['sourceLayout']
  projects: ProjectCandidate[]
  assets: ArchivedAsset[]
  history?: HistoryCandidate[]
  targetHistory?: ReturnType<typeof targetHistoryFolders>
  /** Server-only version of the exact source bytes and selected data/target identities. */
  sourceVersion: string
  verifyDestination: () => Promise<void>
  summaries: { candidates: number; invalid: number; ignored: number }
}

function sameIdentity(a: BigIntStats, b: BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs
}

function verifyDirectoryIdentity(path: string, info: BigIntStats) {
  return async () => {
    try {
      if (await verifyHistoryDirectory(path) && sameIdentity(info, await lstat(path, { bigint: true }))) return
    } catch { /* Missing or replaced roots invalidate this census. */ }
    throw changed()
  }
}

function unchanged(before: BigIntStats, after: BigIntStats) {
  return after.isFile() && after.nlink === 1n && sameIdentity(before, after) &&
    before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs
}

async function readRegularFile(path: string, before: BigIntStats, limit: number, signal?: AbortSignal) {
  if (comparable(await realpath(path)) !== comparable(path)) throw changed()
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    if (!unchanged(before, await handle.stat({ bigint: true }))) throw changed()
    signal?.throwIfAborted()
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024, signal })) {
      length += chunk.length
      if (length > limit) throw tooLarge()
      if (BigInt(length) > before.size) throw changed()
      chunks.push(chunk)
    }
    if (BigInt(length) !== before.size || !unchanged(before, await handle.stat({ bigint: true })) ||
        !unchanged(before, await lstat(path, { bigint: true })) ||
        comparable(await realpath(path)) !== comparable(path)) throw changed()
    return Buffer.concat(chunks, length)
  } finally { await handle.close() }
}

function projectCandidate(bytes: Buffer, id: string): ProjectCandidate | undefined {
  try {
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'id' in raw && raw.id === id &&
        'blocks' in raw && Array.isArray(raw.blocks)) return raw as ProjectCandidate
  } catch { /* Invalid source JSON is counted without reflecting any bytes. */ }
}

// This is a discovery hint only; the ZIP stage still validates the entire
// image block, source URL (including generation), and document schema.
function selectedImageId(block: unknown) {
  if (!isAssetCatalog(block) || block.type !== 'image' || !isAssetCatalog(block.props)) return
  const ref = block.props.image
  if (!isAssetCatalog(ref)) return
  const { assetId, src } = ref
  if (typeof assetId !== 'string' || !id.test(assetId) || typeof src !== 'string') return
  if (['jpg', 'png'].some(ext => {
    const path = '/media/' + assetId + '.' + ext
    return src === path || src.startsWith(path + '?gen=')
  })) return assetId
}

function imageDependencies(projects: Pick<ProjectCandidate, 'blocks'>[], maxEntries: number) {
  const ids = new Set<string>()
  for (const project of projects) {
    if (project.blocks.length > 2000) continue
    for (const block of project.blocks) {
      const selected = selectedImageId(block)
      if (!selected) continue
      ids.add(selected)
      if (ids.size > maxEntries) throw tooLarge()
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, 'en'))
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
type Verify = () => Promise<void>

async function pinFolder(path: string) {
  const directory = await inspect(path) ? await canonicalDirectory(path) : undefined
  return {
    path: directory?.path ?? path,
    identity: directory?.identity ?? 'absent',
    verify: directory?.verify ?? (async () => { if (await inspect(path)) throw changed() }),
  }
}

type PinnedFolder = Awaited<ReturnType<typeof pinFolder>>

function targetHistoryFolders(folder: PinnedFolder) {
  const parents = new Map<string, PinnedFolder>()
  const blocked = new Set<string>()
  return {
    blocked,
    async pin(id: string) {
      await folder.verify()
      const parent = await pinFolder(join(folder.path, id))
      parents.set(id, parent)
      if (parent.identity !== 'absent') blocked.add(id)
      return parent.identity
    },
    async guard(id: string, created = false) {
      await folder.verify()
      const parent = parents.get(id)
      if (!parent) return
      if (created && parent.identity === 'absent') {
        const pinned = await pinFolder(parent.path)
        if (pinned.identity === 'absent') throw changed()
        parents.set(id, pinned)
      } else await parent.verify()
    },
  }
}

async function historyFiles(directory: PinnedFolder, visit: () => void) {
  const files: string[] = []
  const names = new Set<string>()
  for await (const entry of await opendir(directory.path)) {
    visit()
    if (!entry.isFile() || !jsonFile.test(entry.name)) continue
    const key = entry.name.toLowerCase()
    if (names.has(key)) throw invalid()
    names.add(key)
    files.push(entry.name)
  }
  return files.sort((a, b) => a.localeCompare(b, 'en'))
}

function readHistoryDocument(bytes: Buffer) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch { return undefined }
}

function versionImages(raw: unknown, id: string, projectId: string): Pick<ProjectCandidate, 'blocks'> | undefined {
  if (isAssetCatalog(raw) && raw.id === id && raw.projectId === projectId &&
      isAssetCatalog(raw.doc) && raw.doc.id === projectId && Array.isArray(raw.doc.blocks)) return { blocks: raw.doc.blocks }
}

async function snapshotHistory(data: string, projects: ProjectCandidate[], target: ReturnType<typeof targetHistoryFolders>,
  verify: Verify, budget: { visit: () => void; signal?: AbortSignal }) {
  const candidates: HistoryCandidate[] = []
  const images: Pick<ProjectCandidate, 'blocks'>[] = []
  const fingerprints: string[] = []
  const folder = await pinFolder(join(data, 'versions'))
  fingerprints.push(folder.identity)
  if (folder.identity === 'absent') { await folder.verify(); return { candidates, images, fingerprints } }
  let total = 0
  for (const project of projects) {
    budget.visit()
    await verify()
    await folder.verify()
    const parent = await pinFolder(join(folder.path, project.id))
    if (parent.identity === 'absent') { await parent.verify(); continue }
    if (comparable(parent.path) !== comparable(join(folder.path, project.id))) throw changed()
    fingerprints.push(parent.identity, await target.pin(project.id))
    const verifySource = async () => { await verify(); await folder.verify(); await parent.verify() }
    for (const name of await historyFiles(parent, budget.visit)) {
      await verifySource()
      const leaf = join(parent.path, name)
      const info = await lstat(leaf, { bigint: true })
      if (!info.isFile() || info.nlink !== 1n) continue
      const remaining = Math.min(MAX_HISTORY_BYTES, MAX_TOTAL_HISTORY_BYTES - total)
      if (info.size > BigInt(remaining)) throw tooLarge()
      const bytes = await readRegularFile(leaf, info, remaining, budget.signal).finally(verifySource)
      total += bytes.length
      const path = 'versions/' + project.id + '/' + name
      fingerprints.push(path + ':' + digest(bytes))
      const raw = readHistoryDocument(bytes)
      const id = name.slice(0, -5)
      candidates.push({ path, projectId: project.id, id, raw })
      const body = versionImages(raw, id, project.id)
      if (body) images.push(body)
    }
  }
  await folder.verify()
  await verify()
  return { candidates, images, fingerprints }
}

async function snapshotReferencedAssets(data: string, ids: string[], verifyRoots: Verify, signal?: AbortSignal) {
  const assets: ArchivedAsset[] = []
  const fingerprints: string[] = []
  if (!ids.length) return { assets, fingerprints }
  const folder = await pinFolder(join(data, 'assets'))
  const verify = async () => { await verifyRoots(); await folder.verify() }
  fingerprints.push(folder.identity)
  let total = 0
  async function read(name: string, limit: number) {
    await verify()
    const path = join(folder.path, name)
    const info = await lstat(path, { bigint: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (!info?.isFile() || info.nlink !== 1n) {
      fingerprints.push(name + ':unavailable')
      return
    }
    const remaining = Math.min(limit, MAX_TOTAL_ASSET_BYTES - total)
    if (info.size > BigInt(remaining)) throw tooLarge()
    try {
      const bytes = await readRegularFile(path, info, remaining, signal)
      total += bytes.length
      fingerprints.push(name + ':' + digest(bytes))
      return bytes
    } finally { await verify() }
  }
  const index = folder.identity === 'absent' ? undefined : await read('_index.json', MAX_INDEX_BYTES)
  let catalog: unknown
  if (index) {
    try { catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(index)) }
    catch { /* A malformed index cannot qualify any image. */ }
  }
  if (isAssetCatalog(catalog)) for (const key of ids) {
    signal?.throwIfAborted()
    if (!Object.hasOwn(catalog, key)) continue
    let asset: ArchivedAsset['asset']
    try { asset = readAssetMetadata(key, catalog[key]) }
    catch { continue }
    const bytes = await read(asset.file, MAX_ASSET_BYTES)
    if (!bytes) continue
    try { await validateArchivedRaster(asset, bytes) }
    catch { continue }
    assets.push({ asset, bytes })
  }
  await verify()
  return { assets, fingerprints }
}

/**
 * A setup-time capability, not a path-based HTTP API. The host must bind
 * `configuredSource` to a local owner opt-in and apply its normal loopback/CSRF
 * policy before exposing preview. Do not pass request data here.
 *
 * The result is a read-only census of recognized regular files, not a content
 * validator, restore token or copy plan. Settings and .env contents are never
 * read, including outside the expressly configured checkout. Applying migration
 * must revalidate the source and use dependency-aware, add-only restore stores.
 */
export function createLegacyDirectoryPreview({
  configuredSource, target, maxEntries = 50_000,
  maxProjectBytes = MAX_PROJECT_BYTES, maxTotalProjectBytes = MAX_TOTAL_PROJECT_BYTES,
}: Options) {
  const validLimit = (limit: number, max: number) => Number.isSafeInteger(limit) && limit >= 1 && limit <= max
  if (!validLimit(maxEntries, 50_000) || !validLimit(maxProjectBytes, MAX_PROJECT_BYTES) ||
      !validLimit(maxTotalProjectBytes, MAX_TOTAL_PROJECT_BYTES)) throw new RangeError('Invalid migration preview budget')

  async function roots(signal?: AbortSignal) {
    if (!configuredSource) throw new LocalMigrationError('尚未在本机明确指定旧版数据位置', 403)
    signal?.throwIfAborted()
    const source = await ownerDirectory(configuredSource)
    const destination = await ownerDirectory(target)
    disjoint(source.path, destination.path)
    const child = join(source.path, 'data')
    const nested = await directDirectory(child) && await recognizable(child)
    const data = nested ? await canonicalDirectory(child) : source
    if (!nested && !await recognizable(data.path)) throw invalid()
    disjoint(data.path, destination.path)
    const verify = async () => {
      signal?.throwIfAborted()
      await source.verify()
      if (nested) await data.verify()
      await destination.verify()
    }
    return { source: source.path, destination: destination.path, data: data.path, identity: data.identity + '/' + destination.identity, verify, sourceLayout: nested ? 'checkout' as const : 'data' as const }
  }

  async function operation<T>(work: () => Promise<T>, signal?: AbortSignal) {
    try { return await work() }
    catch (error) {
      signal?.throwIfAborted()
      if (error instanceof LocalMigrationError) throw error
      throw inaccessible()
    }
  }
  return {
    async preview(signal?: AbortSignal): Promise<MigrationPreview> {
      return operation(async () => {
        const { source, destination, data, sourceLayout } = await roots(signal)
        let visited = 0
        const scan = () => {
          signal?.throwIfAborted()
          if (++visited > maxEntries) throw tooLarge()
        }
        const counts = {} as Record<Category, Count>
        for (const category of categories) {
          signal?.throwIfAborted()
          const count = counts[category] = { available: 0, occupied: 0, blocked: 0 }
          for await (const file of files(data, category, scan)) count[await occupancy(destination, file)]++
        }
        signal?.throwIfAborted()
        return { sourceLayout, mode: 'metadata-only', categories: counts, metadata: await metadata(source, data) }
      }, signal)
    },
    /** Server-internal bounded structural candidates; never a public response or a copy plan.
     * The ordinary restore stage must still qualify content and enforce destination ownership.
     */
    async snapshotProjects(signal?: AbortSignal): Promise<SourceSnapshot> {
      return operation(async () => {
        const { data, destination, identity, sourceLayout, verify: verifyRoots } = await roots(signal)
        const projects: ProjectCandidate[] = []
        const summaries = { candidates: 0, invalid: 0, ignored: 0 }
        const fingerprints: string[] = []
        const version = (folder: string, assets: string[] = [], history: string[] = []) => createHash('sha256')
          .update(JSON.stringify([identity, targetProjects.identity, targetAssets.identity, targetVersions.identity, folder, fingerprints.sort((a, b) => a.localeCompare(b, 'en')), assets, history, summaries])).digest('hex')
        await verifyRoots()
        const targetProjects = await pinFolder(join(destination, 'projects'))
        const targetAssets = await pinFolder(join(destination, 'assets'))
        const targetVersions = await pinFolder(join(destination, 'versions'))
        const verifyDestination = async () => {
          await verifyRoots()
          await targetProjects.verify()
          await targetAssets.verify()
          await targetVersions.verify()
        }
        const requested = join(data, 'projects')
        if (!await inspect(requested)) {
          await verifyDestination()
          if (await inspect(requested)) throw changed()
          return { sourceLayout, projects, assets: [], summaries, sourceVersion: version('absent'), verifyDestination }
        }
        const directory = await canonicalDirectory(requested)
        const verify = async () => {
          await verifyDestination()
          await directory.verify()
        }
        const names = new Set<string>()
        const files: string[] = []
        let visited = 0
        await verify()
        for await (const entry of await opendir(directory.path)) {
          signal?.throwIfAborted()
          if (++visited > maxEntries) throw tooLarge()
          if (!entry.isFile() || !jsonFile.test(entry.name)) { summaries.ignored++; continue }
          const name = entry.name.toLowerCase()
          if (names.has(name)) throw invalid()
          names.add(name)
          files.push(entry.name)
        }
        // Do not pin the directory enumeration open while reading files.
        // Windows may refuse a legitimate concurrent rename while a child
        // directory handle remains open; detect actual changes with identity checks.
        let total = 0
        for (const name of files) {
          await verify()
          const path = join(directory.path, name)
          const info = await lstat(path, { bigint: true })
          if (!info.isFile() || info.nlink !== 1n) { summaries.ignored++; continue }
          const remaining = Math.min(maxProjectBytes, maxTotalProjectBytes - total)
          if (info.size > BigInt(remaining)) throw tooLarge()
          const bytes = await readRegularFile(path, info, remaining, signal).finally(verify)
          total += bytes.length
          fingerprints.push(name + ':' + digest(bytes))
          const candidate = projectCandidate(bytes, name.slice(0, -5))
          if (candidate) projects.push(candidate)
          else summaries.invalid++
        }
        await verify()
        summaries.candidates = projects.length
        projects.sort((a, b) => a.id.localeCompare(b.id, 'en'))
        const targetHistory = targetHistoryFolders(targetVersions)
        let historyVisited = 0
        const visit = () => { signal?.throwIfAborted(); if (++historyVisited > maxEntries) throw tooLarge() }
        const history = await snapshotHistory(data, projects, targetHistory, verify, { visit, signal })
        const archived = await snapshotReferencedAssets(data, imageDependencies([...projects, ...history.images], maxEntries), verify, signal)
        return { sourceLayout, projects, assets: archived.assets, summaries, sourceVersion: version(directory.identity, archived.fingerprints, history.fingerprints),
          verifyDestination, ...(history.candidates.length && { history: history.candidates, targetHistory }) }
      }, signal)
    },
  }
}

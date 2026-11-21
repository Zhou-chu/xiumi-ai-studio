import { crc32 } from 'node:zlib'
import { openPromise, type Entry, type ZipFile } from 'yauzl'
import sharp from 'sharp'
import { normalizeBlocks } from '../src/core/blocks'
import { THEMES } from '../src/core/themes'
import type { Doc } from '../src/core/types'
import { withImageBudget } from './imageBudget'
import type { Asset, ArchivedAsset, assetRestoreStore } from './assets'
import { acceptsLegacyRichText, legacyTextAlignments, type RichTextBudget } from './legacyRichText'
import type { projectCollection } from './projectStore'

const PROJECT = /^projects\/([\w-]{1,64})\.json$/
const OTHER_LIBRARY_ENTRY = /^(?:settings\.json|assets\/_index\.json|assets\/[\w-]{1,64}\.(?:jpg|png)|(?:templates|components|themes)\/[\w-]{1,64}\.json|versions\/[\w-]{1,64}\/[\w-]{1,80}\.json)$/
const MANIFEST = 'xiumi-backup.json'
const ASSET_INDEX = 'assets/_index.json'
const ASSET_FILE = /^assets\/[\w-]{1,64}\.(?:jpg|png)$/
const MAX_ARCHIVED_IMAGE_PIXELS = 2400 * 2400
// These bounds cover only the in-memory project stage, not the upload size of
// a full library ZIP. Assets have a separate in-memory staging limit.
const DEFAULT_BUDGET = {
  maxEntries: 500_000,
  maxNameBytes: 32 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  totalProjectBytes: 128 * 1024 * 1024,
  totalAssetBytes: 128 * 1024 * 1024,
}
const invalid = () => Object.assign(new Error('备份格式无效或项目文件已损坏'), { status: 400 })
const tooLarge = () => Object.assign(new Error('备份超出了项目恢复的读取上限'), { status: 413 })
type ProjectStore = Pick<ReturnType<typeof projectCollection>, 'occupied' | 'restore'>
type Project = Parameters<ProjectStore['restore']>[0]
type AssetStore = typeof assetRestoreStore
type ProjectArchive = { projects: Project[]; assets: ArchivedAsset[]; otherLibraryEntries: string[] }

async function readEntry(zip: ZipFile, entry: Entry, limit: number): Promise<Buffer> {
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
  return Buffer.concat(chunks, length)
}

async function readJsonEntry(zip: ZipFile, entry: Entry, limit: number): Promise<unknown> {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readEntry(zip, entry, limit)))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAssetMetadata(id: string, value: unknown): Asset {
  if (!/^[\w-]{1,64}$/.test(id) || !isObject(value)) throw invalid()
  const { file, name, width, height, size, createdAt } = value
  if (value.id !== id || !(file === id + '.jpg' || file === id + '.png') ||
      typeof name !== 'string' || typeof width !== 'number' || typeof height !== 'number' ||
      typeof size !== 'number' || typeof createdAt !== 'number' ||
      [width, height, size].some(item => !Number.isSafeInteger(item) || item < 1) ||
      !Number.isFinite(createdAt) || width > 2400 || height > 2400) throw invalid()
  // Preserve only local display metadata; legacy source URL/key fields are
  // not used to fetch content or trusted as a new external-cache identity.
  return { id, file, name, width, height, size, createdAt }
}

async function readArchivedAssets(zip: ZipFile, index: Entry, binaries: Map<string, Entry>, budget: typeof DEFAULT_BUDGET) {
  const catalog = await readJsonEntry(zip, index, budget.entryBytes)
  if (!isObject(catalog)) throw invalid()
  const result: ArchivedAsset[] = []
  let assetBytes = index.uncompressedSize
  if (assetBytes > budget.totalAssetBytes) throw tooLarge()
  for (const [id, value] of Object.entries(catalog)) {
    const asset = readAssetMetadata(id, value)
    const entry = binaries.get('assets/' + asset.file)
    if (!entry || asset.size !== entry.uncompressedSize) throw invalid()
    assetBytes += entry.uncompressedSize
    if (assetBytes > budget.totalAssetBytes) throw tooLarge()
    const bytes = await readEntry(zip, entry, budget.entryBytes)
    await withImageBudget(async () => {
      const img = sharp(bytes, { limitInputPixels: MAX_ARCHIVED_IMAGE_PIXELS, failOn: 'warning' })
      const actual = await img.metadata()
      if (actual.format !== (asset.file.endsWith('.png') ? 'png' : 'jpeg') ||
          actual.width !== asset.width || actual.height !== asset.height ||
          (actual.pages ?? 1) !== 1) throw invalid()
      await img.raw().toBuffer()
    })
    result.push({ asset, bytes })
    binaries.delete(entry.fileName)
  }
  return result.sort((a, b) => a.asset.id.localeCompare(b.asset.id, 'en'))
}

async function readLegacyArchive(path: string, budget: typeof DEFAULT_BUDGET, includeAssets = false, requireLibraryManifest = false): Promise<ProjectArchive> {
  const projects: Project[] = []
  const otherLibraryEntries: string[] = []
  const seen = new Set<string>()
  const binaries = new Map<string, Entry>()
  let index: Entry | undefined
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
      if (includeAssets && (name === ASSET_INDEX || ASSET_FILE.test(name))) {
        // Retained ZIP entry handles also retain comment and extra-field bytes.
        nameBytes += entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength
      }
      if (nameBytes > budget.maxNameBytes) throw tooLarge()
      if (seen.has(key)) throw invalid()
      seen.add(key)
      if (name === MANIFEST) {
        const manifest = await readJsonEntry(zip, entry, 64 * 1024)
        if (!isObject(manifest) || manifest.app !== 'xiumi-ai-studio') throw invalid()
        if (requireLibraryManifest && (typeof manifest.version !== 'string' || manifest.scope !== undefined)) throw invalid()
        sawManifest = true
      } else {
        const id = PROJECT.exec(name)?.[1]
        if (id) {
          consumed += entry.uncompressedSize
          if (consumed > budget.totalProjectBytes) throw tooLarge()
          const value = await readJsonEntry(zip, entry, budget.entryBytes)
          if (!isObject(value) || value.id !== id || !Array.isArray(value.blocks)) throw invalid()
          projects.push({ ...value, id })
        } else if (includeAssets && name === ASSET_INDEX) {
          index = entry
        } else if (includeAssets && ASSET_FILE.test(name)) {
          binaries.set(name, entry)
        } else if (OTHER_LIBRARY_ENTRY.test(name)) {
          otherLibraryEntries.push(name)
        }
      }
    }
    if (!sawManifest) throw invalid()
    const assets = index ? await readArchivedAssets(zip, index, binaries, budget) : []
    return {
      projects: projects.sort((a, b) => a.id.localeCompare(b.id, 'en')),
      assets,
      otherLibraryEntries: [...otherLibraryEntries, ...binaries.keys()].sort((a, b) => a.localeCompare(b, 'en')),
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


// Match the existing offline portable reference scan, but keep that path
// unchanged. Local references not represented by this indexed archive are not
// trusted to resolve to any same-named live content on the destination.
function missingManagedMedia(doc: Project, known: { files: Set<string>; ids: Set<string> }): boolean {
  const stack: unknown[] = [doc]
  const media = /(?:^|[\s"'(])\/media\/([\w-]{1,64}\.(?:jpg|png))(?=$|[\s"'?)#<])/g
  while (stack.length) {
    const item = stack.pop()
    if (typeof item === 'string') {
      for (const match of item.matchAll(media)) if (!known.files.has(match[1])) return true
    } else if (Array.isArray(item)) {
      for (const child of item) stack.push(child)
    } else if (isObject(item)) {
      if (typeof item.assetId === 'string' && item.assetId && !known.ids.has(item.assetId)) return true
      for (const child of Object.values(item)) stack.push(child)
    }
  }
  return false
}

/** Internal combined stage. Not wired to HTTP or the existing portable format. */
export async function stageLegacyLibrary(path: string, projects: ProjectStore, assetStore: AssetStore) {
  const source = await readLegacyArchive(path, DEFAULT_BUDGET, true)
  const known = {
    files: new Set(source.assets.map(({ asset }) => asset.file)),
    ids: new Set(source.assets.map(({ asset }) => asset.id)),
  }
  const missing = new Set(source.projects.filter(doc => missingManagedMedia(doc, known)).map(({ id }) => id))
  let used = false
  return {
    async preview() {
      const projectAdd: string[] = [], projectSkip: string[] = []
      const assetAdd: string[] = [], assetSkip: string[] = [], alreadyPresent: string[] = []
      for (const { id } of source.projects) {
        if (!missing.has(id)) (await projects.occupied(id) ? projectSkip : projectAdd).push(id)
      }
      for (const entry of source.assets) {
        const status = await assetStore.status(entry)
        const destination = status === 'available' ? assetAdd : status === 'alreadyPresent' ? alreadyPresent : assetSkip
        destination.push(entry.asset.id)
      }
      return {
        projects: { add: projectAdd, skip: projectSkip, blockedByAssetConflicts: assetSkip.length > 0, missingMedia: [...missing] },
        assets: { add: assetAdd, skip: assetSkip, alreadyPresent },
        notRestored: [...source.otherLibraryEntries],
      }
    },
    async apply() {
      if (used) throw new Error('恢复计划已使用')
      used = true
      return assetStore.withApplyLock(async restoreAsset => {
        const assetResult = { restored: [] as string[], alreadyPresent: [] as string[], skipped: [] as string[], failed: [] as { id: string; cleanupFailed: boolean }[] }
        const projectResult = { restored: [] as string[], skipped: [] as string[], notAttempted: [] as string[], failed: [] as string[], missingMedia: [...missing] }
        for (const entry of source.assets) {
          try {
            const outcome = await restoreAsset(entry)
            assetResult[outcome === 'conflict' ? 'skipped' : outcome].push(entry.asset.id)
          } catch (error) {
            assetResult.failed.push({ id: entry.asset.id, cleanupFailed: (error as { cleanupFailed?: boolean }).cleanupFailed === true })
          }
        }
        // An occupied file may be a different image with the same legacy ID.
        // Until per-project dependency acceptance is available, conservatively
        // stop new project writes when any indexed asset conflicts or fails.
        if (assetResult.failed.length || assetResult.skipped.length) {
          projectResult.notAttempted = source.projects.map(({ id }) => id)
        } else {
          for (const doc of source.projects) {
            if (missing.has(doc.id)) continue
            try {
              (await projects.restore(doc) ? projectResult.restored : projectResult.skipped).push(doc.id)
            } catch {
              projectResult.failed.push(doc.id)
            }
          }
        }
        return { assets: assetResult, projects: projectResult }
      })
    },
  }
}


const coreThemeIds = new Set(THEMES.map(({ id }) => id))
const emptyMedia = { files: new Set<string>(), ids: new Set<string>() }
const routeBudget = { ...DEFAULT_BUDGET, maxEntries: 5000, maxNameBytes: 1024 * 1024, entryBytes: 4 * 1024 * 1024, totalProjectBytes: 32 * 1024 * 1024 }
const idPattern = /^[\w-]{1,64}$/
const boundedText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

const projectKeys = new Set(['id', 'title', 'author', 'digest', 'themeId', 'blocks', 'createdAt', 'updatedAt', 'revision'])
const blockKeys = new Set(['id', 'type', 'props'])
const headingKeys = new Set(['variant', 'index', 'title', 'subtitle'])
const quoteKeys = new Set(['variant', 'text', 'source'])
const dividerKeys = new Set(['variant'])
const paragraphKeys = new Set(['content', 'align'])
const cardKeys = new Set(['content', 'title', 'variant'])
const knownKeys = (value: Record<string, unknown>, allowed: Set<string>) => Object.keys(value).every(key => allowed.has(key))

function textBlock(value: unknown, budget: RichTextBudget) {
  if (!isObject(value) || !knownKeys(value, blockKeys) || typeof value.id !== 'string' ||
      !idPattern.test(value.id) || !isObject(value.props)) return false
  const { props } = value
  if (value.type === 'paragraph') {
    return knownKeys(props, paragraphKeys) && typeof props.align === 'string' &&
      legacyTextAlignments.has(props.align) && acceptsLegacyRichText(props.content, budget)
  }
  if (typeof props.variant !== 'string') return false
  if (value.type === 'card') {
    return knownKeys(props, cardKeys) && ['auto', 'border', 'fill', 'accent'].includes(props.variant) &&
      boundedText(props.title, 2000) && acceptsLegacyRichText(props.content, budget)
  }
  if (value.type === 'heading') {
    return knownKeys(props, headingKeys) && ['auto', 'number', 'bar', 'pill', 'underline'].includes(props.variant) &&
      boundedText(props.index, 160) && boundedText(props.title, 2000) && boundedText(props.subtitle, 2000)
  }
  if (value.type === 'quote') {
    return knownKeys(props, quoteKeys) && ['auto', 'line', 'mark', 'center'].includes(props.variant) &&
      boundedText(props.text, 20_000) && boundedText(props.source, 2000)
  }
  return value.type === 'divider' && knownKeys(props, dividerKeys) && ['auto', 'line', 'dots', 'ornament'].includes(props.variant)
}

function independentlyRestorable(doc: Project) {
  // Accept only a finite, shallow schema. Extra or nested application data
  // is explicitly deferred instead of being silently pruned or restored.
  if (!knownKeys(doc, projectKeys) || !boundedText(doc.title, 2000) ||
      !Array.isArray(doc.blocks) || doc.blocks.length > 2000 ||
      (doc.author !== undefined && !boundedText(doc.author, 2000)) ||
      (doc.digest !== undefined && !boundedText(doc.digest, 2000)) ||
      (doc.revision !== undefined && !boundedText(doc.revision, 200)) ||
      (doc.themeId !== undefined && (typeof doc.themeId !== 'string' || !coreThemeIds.has(doc.themeId)))) return false
  for (const value of [doc.createdAt, doc.updatedAt]) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) return false
  }
  const budget = { nodes: 0, characters: 0 }
  return doc.blocks.every(block => textBlock(block, budget)) &&
    new Set(doc.blocks.map(block => block.id)).size === doc.blocks.length &&
    !missingManagedMedia(doc, emptyMedia)
}

function canonicalTextProject(doc: Project, fallbackTime: number): Doc {
  // The read-only qualification above establishes that each present field is
  // an allowed primitive or a fully checked text block. Keep meaningful
  // legacy values while making the persisted record safe for every reader.
  const createdAt = doc.createdAt ?? doc.updatedAt ?? fallbackTime
  const updatedAt = doc.updatedAt ?? doc.createdAt ?? fallbackTime
  return {
    id: doc.id,
    title: doc.title,
    author: doc.author ?? '',
    digest: doc.digest ?? '',
    themeId: doc.themeId ?? THEMES[0].id,
    // Validation excluded every unsupported field before normalization.
    // Persist the editor's canonical property order so opening does not
    // perform a phantom repair/write of unchanged restored content.
    blocks: normalizeBlocks(doc.blocks),
    createdAt,
    updatedAt,
  }
}

/** Exposable subset: reject dependencies until their end-to-end restore is ready. */
export async function stageLegacyTextProjects(path: string, store: ProjectStore) {
  const { projects, otherLibraryEntries } = await readLegacyArchive(path, routeBudget, false, true)
  const supported: Doc[] = [], unsupported: string[] = []
  const fallbackTime = Date.now()
  for (const doc of projects) {
    if (independentlyRestorable(doc)) supported.push(canonicalTextProject(doc, fallbackTime))
    else unsupported.push(doc.id)
  }
  return {
    async preview() {
      const add: string[] = [], skip: string[] = []
      for (const { id } of supported) (await store.occupied(id) ? skip : add).push(id)
      return { projects: { add, skip, unsupported: [...unsupported] }, unsupported: [...otherLibraryEntries] }
    },
    async apply() {
      const restored: string[] = [], skipped: string[] = [], failed: string[] = []
      for (const doc of supported) {
        try {
          (await store.restore(doc) ? restored : skipped).push(doc.id)
        } catch {
          failed.push(doc.id)
        }
      }
      return { projects: { restored, skipped, failed, unsupported: [...unsupported] }, unsupported: [...otherLibraryEntries] }
    },
  }
}

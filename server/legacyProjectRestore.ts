import { decodeLinkedSvgScene, parseCrossSvgPreview, type CrossSvgPreview } from '../src/core/crossSvgPreview'
import { crc32 } from 'node:zlib'
import { createHash } from 'node:crypto'
import { openPromise, type Entry, type ZipFile } from 'yauzl'
import type { RestoreHistoryReason } from '../src/core/restoreHistoryReasons'
import { renderLocalSvgInteraction } from '../src/core/localSvgInteraction'
import { normalizeBlocks } from '../src/core/blocks'
import { THEMES } from '../src/core/themes'
import type { Block, Doc, ImageRef } from '../src/core/types'
import { readAssetMetadata, validateArchivedRaster } from './legacyRaster'
import { archivedModelCards, stageModelCards } from './modelRestore'
import type { ArchivedAsset, assetRestoreStore } from './assets'
import { acceptsLegacyRichText, legacyTextAlignments, type RichTextBudget } from './legacyRichText'
import type { projectCollection } from './projectStore'
import { acceptsLegacyDataBlock, type LegacyDataBlockBudget } from './legacyDataBlocks'
import { COMPONENT_ENTRY, qualifyLegacyComponent, stageLegacyComponents, type ComponentCollection, type ComponentCandidate } from './legacyComponentRestore'
import { DESIGN_ENTRY, qualifyLegacyDesign, stageLegacyDesign, type DesignCategory, type DesignCollections, type DesignData } from './legacyDesignRestore'
import { VERSION_RETENTION_LIMIT, type projectHistoryRestore, type VersionSnapshot } from './projectHistoryRestore'

const PROJECT = /^projects\/([\w-]{1,64})\.json$/
const OTHER_LIBRARY_ENTRY = /^(?:settings\.json|assets\/_index\.json|assets\/[\w-]{1,64}\.(?:jpg|png)|(?:templates|components|themes)\/[\w-]{1,64}\.json|versions\/[\w-]{1,64}\/[\w-]{1,80}\.json)$/
const VERSION_PATH = /^versions\/([\w-]{1,64})\/([\w-]{1,64})\.json$/
const MANIFEST = 'xiumi-backup.json'
const ASSET_INDEX = 'assets/_index.json'
const ASSET_FILE = /^assets\/[\w-]{1,64}\.(?:jpg|png)$/
// These bounds cover only the in-memory project stage, not the upload size of
// a full library ZIP. Assets have a separate in-memory staging limit.
const DEFAULT_BUDGET = {
  maxEntries: 500_000,
  maxNameBytes: 32 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  totalProjectBytes: 128 * 1024 * 1024,
  totalHistoryBytes: 32 * 1024 * 1024,
  totalDesignBytes: 16 * 1024 * 1024,
  totalAssetBytes: 128 * 1024 * 1024,
}
const invalid = () => Object.assign(new Error('备份格式无效或项目文件已损坏'), { status: 400 })
const tooLarge = () => Object.assign(new Error('备份超出了项目恢复的读取上限'), { status: 413 })
type ProjectStore = Pick<ReturnType<typeof projectCollection>, 'occupied' | 'restore'>
type Project = Parameters<ProjectStore['restore']>[0]
type AssetStore = typeof assetRestoreStore
type AssetLockCallbacks = Parameters<Parameters<AssetStore['withApplyLock']>[0]>
type HistoryStore = Pick<ReturnType<typeof projectHistoryRestore>, 'restore'> & Partial<Pick<ReturnType<typeof projectHistoryRestore>, 'inspectExisting'>>
export type HistoryCandidate = { path: string; projectId: string; id: string; raw: unknown }
export type ComponentRecord = { path: string; id: string; raw: unknown }
export type DesignEntry = ComponentRecord & { kind: DesignCategory }
type ProjectArchive = { modelCards?: ReturnType<typeof archivedModelCards>; components: ComponentRecord[]; projects: Project[]; assets: ArchivedAsset[]; otherLibraryEntries: string[]; history: HistoryCandidate[]; design: DesignEntry[] }

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
    await validateArchivedRaster(asset, bytes)
    result.push({ asset, bytes })
    binaries.delete(entry.fileName)
  }
  return result.sort((a, b) => a.asset.id.localeCompare(b.asset.id, 'en'))
}

async function readLegacyArchive(path: string, budget: typeof DEFAULT_BUDGET, includeAssets = false, requireLibraryManifest = false, includeHistory = false, includeDesign = false, includeComponents = false, includeModelCards = false): Promise<ProjectArchive> {
  const projects: Project[] = []
  const design: DesignEntry[] = []
  let designBytes = 0, componentBytes = 0
  const components: ComponentRecord[] = []
  const otherLibraryEntries: string[] = []
  const history: HistoryCandidate[] = []
  const seen = new Set<string>()
  const binaries = new Map<string, Entry>()
  let index: Entry | undefined
  let modelCards: ProjectArchive['modelCards']
  let sawManifest = false
  let consumed = 0
  let historyBytes = 0
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
        const componentId = includeComponents ? COMPONENT_ENTRY.exec(name)?.[1] : undefined
        const designMatch = includeDesign ? DESIGN_ENTRY.exec(name) : null
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
        } else if (includeHistory && VERSION_PATH.test(name)) {
          const [, projectId, id] = VERSION_PATH.exec(name)!
          if (entry.uncompressedSize > budget.entryBytes || entry.uncompressedSize > budget.totalHistoryBytes - historyBytes) {
            otherLibraryEntries.push(name)
            continue
          }
          historyBytes += entry.uncompressedSize
          const bytes = await readEntry(zip, entry, budget.entryBytes)
          let raw: unknown
          try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
          catch { /* Unusable JSON is accounted for in the unsupported list. */ }
          history.push({ path: name, projectId, id, raw })
        } else if (componentId) {
          if (components.length >= 128 || entry.uncompressedSize > Math.min(128 * 1024, 8 * 1024 * 1024 - componentBytes)) {
            otherLibraryEntries.push(name)
            continue
          }
          componentBytes += entry.uncompressedSize
          const bytes = await readEntry(zip, entry, budget.entryBytes)
          let raw: unknown
          try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
          catch { /* Report malformed JSON as unsupported. */ }
          components.push({ path: name, id: componentId, raw })
        } else if (designMatch) {
          if (entry.uncompressedSize > budget.entryBytes || entry.uncompressedSize > budget.totalDesignBytes - designBytes) {
            otherLibraryEntries.push(name)
            continue
          }
          designBytes += entry.uncompressedSize
          const bytes = await readEntry(zip, entry, budget.entryBytes)
          let raw: unknown
          try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
          catch { /* Malformed design JSON is left unsupported. */ }
          design.push({ path: name, id: designMatch[2], kind: designMatch[1] as DesignCategory, raw })
        } else if (includeModelCards && name === 'settings.json') {
          if (entry.uncompressedSize <= 256 * 1024) {
            try { modelCards = archivedModelCards(await readJsonEntry(zip, entry, 256 * 1024)) }
            catch { /* Invalid settings are not imported. */ }
          }
          if (!modelCards?.length) otherLibraryEntries.push(name)
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
      modelCards,
      history,
      components,
      design,
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
const routeBudget = { ...DEFAULT_BUDGET, maxEntries: 5000, maxNameBytes: 1024 * 1024, entryBytes: 4 * 1024 * 1024, totalProjectBytes: 32 * 1024 * 1024, totalAssetBytes: 32 * 1024 * 1024 }
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

function textBlock(value: unknown, budget: RichTextBudget, dataBudget: LegacyDataBlockBudget) {
  if (!isObject(value) || !knownKeys(value, blockKeys) || typeof value.id !== 'string' ||
      !idPattern.test(value.id) || !isObject(value.props)) return false
  const { props } = value
  if (value.type === 'paragraph') {
    return knownKeys(props, paragraphKeys) && typeof props.align === 'string' &&
      legacyTextAlignments.has(props.align) && acceptsLegacyRichText(props.content, budget)
  }
  if (value.type === 'timeline' || value.type === 'table') return acceptsLegacyDataBlock(value.type, props, dataBudget)
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
  return value.type === 'divider' && knownKeys(props, dividerKeys) && ['auto', 'line', 'dots', 'ornament', 'space'].includes(props.variant)
}

const imageBlockKeys = new Set(['image', 'caption', 'variant'])
const imageRefKeys = new Set(['src', 'assetId', 'alt', 'width', 'height', 'displayWidth'])
type RestoreImage = { asset: ArchivedAsset; qualifiedSrc: string; name: string }
function acceptedImageBlock(block: unknown, images: Map<string, RestoreImage>): block is Block<'image'> {
  if (!isObject(block) || !knownKeys(block, blockKeys) || block.type !== 'image' ||
      typeof block.id !== 'string' || !idPattern.test(block.id) || !isObject(block.props)) return false
  const { image, caption, variant } = block.props
  return knownKeys(block.props, imageBlockKeys) && boundedText(caption, 2000) &&
    typeof variant === 'string' && ['full', 'framed', 'rounded'].includes(variant) && acceptedImageRef(image, images)
}

function acceptedImageRef(image: unknown, images: Map<string, RestoreImage>): image is ImageRef & { assetId: string } {
  if (!isObject(image) || !knownKeys(image, imageRefKeys) || typeof image.assetId !== 'string') return false
  const record = images.get(image.assetId)
  return !!record && (image.src === record.name || image.src === record.qualifiedSrc) &&
    (image.alt === undefined || boundedText(image.alt, 2000)) &&
    (image.width === undefined || image.width === record.asset.asset.width) &&
    (image.height === undefined || image.height === record.asset.asset.height) &&
    (image.displayWidth === undefined ||
      (typeof image.displayWidth === 'number' && image.displayWidth >= 10 && image.displayWidth <= 100))
}

const svgBlockKeys = new Set(['html', 'label'])
function acceptedLocalSvgBlock(block: unknown): boolean {
  return isObject(block) && knownKeys(block, blockKeys) && block.type === 'html' &&
    typeof block.id === 'string' && idPattern.test(block.id) && isObject(block.props) &&
    knownKeys(block.props, svgBlockKeys) && boundedText(block.props.label, 2000) &&
    typeof block.props.html === 'string' && renderLocalSvgInteraction(block.props.html) !== null
}

function acceptedLinkedSvgBlock(block: unknown): boolean {
  return isObject(block) && knownKeys(block, blockKeys) && block.type === 'linkedSvg' &&
    typeof block.id === 'string' && idPattern.test(block.id) && isObject(block.props) &&
    knownKeys(block.props, linkedSvgBlockKeys) && !!decodeLinkedSvgScene(block.props.scene)
}
const linkedSvgBlockKeys = new Set(['scene'])

function linkedSvgProject(doc: Project): Project | null {
  if (!Array.isArray(doc.blocks) || ![2, 5].includes(doc.blocks.length)) return null
  const fragments: string[] = []
  for (const block of doc.blocks) {
    if (!isObject(block) || !knownKeys(block, blockKeys) || block.type !== 'html' ||
      typeof block.id !== 'string' || !idPattern.test(block.id) || !isObject(block.props) ||
      !knownKeys(block.props, svgBlockKeys) || !boundedText(block.props.label, 2000) ||
      typeof block.props.html !== 'string') return null
    fragments.push(block.props.html)
  }
  if (new Set(doc.blocks.map(block => block.id)).size !== doc.blocks.length) return null
  const parsed = parseCrossSvgPreview(fragments)
  if (!parsed) return null
  const { context, ...scene } = parsed
  const at = context ? 2 : 0
  const paired: Block<'linkedSvg'> = { id: doc.blocks[at].id, type: 'linkedSvg', props: { scene } }
  return { ...doc, blocks: [...doc.blocks.slice(0, at), paired, ...doc.blocks.slice(at + 2)] }
}

function independentlyRestorable(doc: Project, images: Map<string, RestoreImage>, linkedSvg = false) {
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
  const dataBudget = { characters: 0 }
  return doc.blocks.every(block => textBlock(block, budget, dataBudget) || acceptedImageBlock(block, images) ||
    acceptedLocalSvgBlock(block) || (linkedSvg && acceptedLinkedSvgBlock(block))) &&
    new Set(doc.blocks.map(block => block.id)).size === doc.blocks.length
}

function canonicalImageBlock(block: Block<'image'>, images: Map<string, RestoreImage>): Block<'image'> {
  const ref = block.props.image
  const record = images.get(ref?.assetId ?? '')
  if (!ref || !record) return block
  const image: ImageRef = { ...ref, src: record.qualifiedSrc }
  return { ...block, props: { ...block.props, image } }
}

function canonicalTextProject(doc: Project, fallbackTime: number, images: Map<string, RestoreImage>): Doc {
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
    blocks: normalizeBlocks(doc.blocks.map((block: Block) => block.type === 'image' ? canonicalImageBlock(block, images) : block)),
    createdAt,
    updatedAt,
  }
}

const historyKeys = new Set(['id', 'projectId', 'label', 'createdAt', 'doc'])
type ManagedVersion = { version: VersionSnapshot; dependencies: Set<string> }

function managedProject(source: Project, fallbackTime: number, images: Map<string, RestoreImage>, linkedSvg = false): ManagedProject | null {
  const candidate = (linkedSvg && linkedSvgProject(source)) || source
  if (!independentlyRestorable(candidate, images, linkedSvg)) return null
  const doc = canonicalTextProject(candidate, fallbackTime, images)
  const dependencies = new Set(doc.blocks.flatMap(block =>
    block.type === 'image' && block.props.image?.assetId ? [block.props.image.assetId] : []))
  const known = { ids: dependencies, files: new Set([...dependencies].map(id => images.get(id)!.asset.asset.file)) }
  // Already-qualified table/timeline fields are literal text, not references.
  // Preserve the existing scan for every other type, including real image/HTML data.
  const referenceSource = { ...source, blocks: source.blocks.filter((block: Block) => block.type !== 'timeline' && block.type !== 'table') }
  return missingManagedMedia(referenceSource, known) ? null : { doc, dependencies }
}

function acceptedSnapshot(candidate: HistoryCandidate, parents: Map<string, Doc>, fallbackTime: number,
  images: Map<string, RestoreImage>, linkedSvg: boolean): ManagedVersion | null {
  const { id, projectId, raw } = candidate
  if (!isObject(raw) || !knownKeys(raw, historyKeys) || raw.id !== id || raw.projectId !== projectId ||
      !parents.has(projectId) || !boundedText(raw.label, 2000) ||
      typeof raw.createdAt !== 'number' || !Number.isSafeInteger(raw.createdAt) || raw.createdAt < 0 ||
      !isObject(raw.doc) || raw.doc.id !== projectId) return null
  const restored = managedProject({ ...raw.doc, id: projectId }, fallbackTime, images, linkedSvg)
  if (!restored) return null
  return { version: { id, projectId, label: raw.label, createdAt: raw.createdAt, doc: restored.doc }, dependencies: restored.dependencies }
}

const archiveSort = (a: string, b: string) => a.localeCompare(b, 'en')
const versionKey = (version: VersionSnapshot) => version.projectId + '/' + version.id

type ManagedProject = { doc: Doc; dependencies: Set<string> }
const initAssetPlan = () => ({ add: [] as string[], skip: [] as string[], alreadyPresent: [] as string[] })
const initAssetResult = () => ({ restored: [] as string[], skipped: [] as string[], failed: [] as string[], alreadyPresent: [] as string[] })

/** Exposable subset. Opt-in images require both exact index metadata and
 * matching bytes; text-only preview/apply remains available independently. */
type StageOptions = { components?: ComponentCollection; projectImages?: boolean; standaloneImages?: boolean; modelCards?: boolean; existingHistory?: boolean; crossSvgPreview?: boolean; crossSvgRestore?: boolean }

export async function stageLegacyTextProjects(path: string, store: ProjectStore, historyStore?: HistoryStore, assetStore?: AssetStore, designStore?: DesignCollections, options: StageOptions = {}) {
  const decoded = await readLegacyArchive(path, routeBudget, !!assetStore, true, !!historyStore, !!designStore, !!options.components, !!options.modelCards)
  return stageDecodedLegacyProjects(decoded, store, historyStore, assetStore, designStore, { ...options, existingHistory: true })
}

/** Current manuscripts and their reviewed indexed raster dependencies from an owner-local directory. */
export function stageLegacyDirectoryProjects(projects: Project[], store: ProjectStore, related: {
  assets: ArchivedAsset[]; assetStore: AssetStore; history?: HistoryCandidate[]; historyStore?: HistoryStore; standaloneImages?: boolean
  design?: DesignEntry[]; designStore?: DesignCollections; components?: ComponentRecord[]; componentStore?: ComponentCollection
}) {
  return stageDecodedLegacyProjects({
    projects, assets: related.assets, history: related.history ?? [], design: related.design ?? [], components: related.components ?? [], otherLibraryEntries: [],
  }, store, related.historyStore, related.assets.length ? related.assetStore : undefined, related.designStore, {
    existingHistory: true, standaloneImages: related.standaloneImages, components: related.componentStore,
  })
}

type InspectExisting = NonNullable<HistoryStore['inspectExisting']>
type PlannedExisting = { revision: string } | { reason: RestoreHistoryReason }

async function existingHistoryPlan(versions: ManagedVersion[], retained: Set<string>, parents: Map<string, Doc>, inspectExisting: InspectExisting) {
  const groups = new Map<string, string[]>()
  for (const { version } of versions) {
    if (!retained.has(version.projectId)) continue
    const ids = groups.get(version.projectId) ?? []
    ids.push(version.id)
    groups.set(version.projectId, ids)
  }
  const states = new Map<string, Awaited<ReturnType<InspectExisting>>>()
  for (const [id, ids] of groups) states.set(id, await inspectExisting(parents.get(id)!, ids))
  return states
}

function reserveVersion(parent: Awaited<ReturnType<InspectExisting>>, id: string) {
  if (!parent) return { reason: 'parent-mismatch' as const }
  if (parent.reason) return { reason: parent.reason }
  if (parent.occupied.has(id)) return { reason: 'occupied' as const }
  if (!parent.available) return { reason: 'retention-limit' as const }
  return { revision: parent.revision }
}

async function planVersionWrites({ versions, retained, parents, inspect, eligible, planDependencies }: {
  versions: ManagedVersion[]
  retained: Set<string>
  parents: Map<string, Doc>
  inspect?: InspectExisting
  eligible: Set<string>
  planDependencies: (dependencies: Set<string>) => Promise<boolean>
}) {
  const add: string[] = [], skip: string[] = []
  const reasons: Record<string, RestoreHistoryReason> = {}
  const choices = new Map<string, PlannedExisting>()
  const states = inspect ? await existingHistoryPlan(versions, retained, parents, inspect) : undefined
  const perProject = new Map<string, number>()
  for (const { version, dependencies } of versions) {
    const key = versionKey(version)
    const pid = version.projectId
    if (states?.has(pid)) {
      const state = states.get(pid) ?? null
      let choice: PlannedExisting = reserveVersion(state, version.id)
      if ('revision' in choice && !await planDependencies(dependencies)) choice = { reason: 'dependency-unavailable' }
      if ('revision' in choice) {
        if (state && state.available !== undefined) state.available--
        add.push(key)
      } else {
        reasons[key] = choice.reason
        skip.push(key)
      }
      choices.set(key, choice)
    } else {
      const count = perProject.get(pid) ?? 0
      if (eligible.has(pid) && count < VERSION_RETENTION_LIMIT && await planDependencies(dependencies)) {
        add.push(key)
        perProject.set(pid, count + 1)
      } else skip.push(key)
    }
  }
  return { plan: { add, skip, ...(Object.keys(reasons).length && { reasons }) }, choices, retainedParents: new Set(states?.keys()) }
}

function stageDecodedLegacyProjects({ projects, assets, history, design, components, modelCards, otherLibraryEntries }: ProjectArchive, store: ProjectStore,
  historyStore?: HistoryStore, assetStore?: AssetStore, designStore?: DesignCollections, options: StageOptions = {}) {
  const images = new Map(assets.map(asset => {
    const name = '/media/' + asset.asset.file
    const generation = createHash('sha256').update(asset.bytes).digest('hex')
    const qualifiedSrc = name + '?gen=' + generation
    return [asset.asset.id, { asset: { ...asset, asset: { ...asset.asset, generation } }, qualifiedSrc, name }]
  }))
  const projectImages = options.projectImages === false ? new Map<string, RestoreImage>() : images
  const byFile = new Map([...images].map(([id, image]) => [image.asset.asset.file, { id, src: image.qualifiedSrc }]))
  const preparedComponents: ComponentCandidate[] = []
  for (const record of components) {
    const candidate = qualifyLegacyComponent(record.id, record.raw, byFile)
    if (candidate) preparedComponents.push(candidate)
    else otherLibraryEntries.push(record.path)
  }
  const modelStage = modelCards?.length ? stageModelCards(modelCards) : undefined
  const componentStage = options.components ? stageLegacyComponents(preparedComponents, options.components) : null
  const supported: ManagedProject[] = [], unsupported: string[] = []
  const selected = new Set<string>(), parents = new Map<string, Doc>()
  const designRecords: DesignData = { templates: [], themes: [] }
  const templateAssets = new Map<string, Set<string>>()
  for (const entry of design) {
    const dependencies = new Set<string>()
    const includeMedia = assetStore && options.projectImages !== false
    const template = qualifyLegacyDesign(entry.kind, entry.id, entry.raw, includeMedia ? block => {
      if (!acceptedImageBlock(block, images)) return null
      dependencies.add(block.props.image!.assetId!)
      return { block: canonicalImageBlock(block, images) }
    } : undefined, includeMedia ? ref => {
      if (!acceptedImageRef(ref, images)) return null
      dependencies.add(ref.assetId)
      return { ...ref, src: images.get(ref.assetId)!.qualifiedSrc }
    } : undefined)
    if (!template) { otherLibraryEntries.push(entry.path); continue }
    designRecords[entry.kind].push(template)
    if (entry.kind === 'templates') templateAssets.set(entry.id, dependencies)
    for (const id of dependencies) selected.add(id)
  }
  const designs = designStore ? stageLegacyDesign(designRecords, designStore) : null
  const fallbackTime = Date.now()
  let crossSvgPreview: CrossSvgPreview | null = null
  for (const source of projects) {
    const candidate = managedProject(source, fallbackTime, projectImages, options.crossSvgRestore)
    if (!candidate) {
      unsupported.push(source.id)
      if (options.crossSvgPreview && !crossSvgPreview && Array.isArray(source.blocks) && [2, 5].includes(source.blocks.length)) {
        const html = source.blocks.flatMap(block => block?.type === 'html' && typeof block.props?.html === 'string' ? [block.props.html] : [])
        crossSvgPreview = parseCrossSvgPreview(html)
      }
      continue
    }
    supported.push(candidate)
    parents.set(candidate.doc.id, candidate.doc)
    for (const id of candidate.dependencies) selected.add(id)
  }
  const crossPreviewPlan = crossSvgPreview ? { crossSvgPreview } : {}
  for (const candidate of preparedComponents) if (!candidate.missing) for (const id of candidate.dependencies) selected.add(id)
  const versions: ManagedVersion[] = []
  for (const entry of history) {
    const snapshot = acceptedSnapshot(entry, parents, fallbackTime, projectImages, !!options.crossSvgRestore)
    if (!snapshot) { otherLibraryEntries.push(entry.path); continue }
    versions.push(snapshot)
    for (const id of snapshot.dependencies) selected.add(id)
  }
  // This separate opt-in uses only independently checked archive index/bytes.
  // Invalid referring records stay unsupported even when their asset is valid.
  const standalone = options.standaloneImages && assetStore ? [...images.keys()] : []
  for (const id of standalone) selected.add(id)
  if (assetStore) {
    if (!selected.size && assets.length) otherLibraryEntries.push(ASSET_INDEX)
    for (const { asset } of assets) if (!selected.has(asset.id)) otherLibraryEntries.push('assets/' + asset.file)
  }
  // Use retention-compatible newest-first ordering. Unavailable versions do
  // not take a slot from eligible, older snapshots of the same project.
  versions.sort(({ version: a }, { version: b }) => archiveSort(a.projectId, b.projectId) || b.createdAt - a.createdAt || archiveSort(a.id, b.id))
  otherLibraryEntries.sort(archiveSort)

  let reviewedExisting = new Map<string, PlannedExisting>()
  let retainedParents = new Set<string>()
  return {
    async preview() {
      const add: string[] = [], skip: string[] = []
      const plan = initAssetPlan()
      const status = new Map<string, 'available' | 'alreadyPresent' | 'conflict'>()
      const needed = new Set<string>(), conflicts = new Set<string>()
      async function planDependencies(dependencies: Set<string>, existing = false) {
        for (const id of dependencies) {
          if (!status.has(id) && assetStore) status.set(id, await assetStore.status(images.get(id)!.asset))
        }
        const conflicted = [...dependencies].filter(id => status.get(id) === 'conflict')
        for (const id of conflicted) conflicts.add(id)
        if (conflicted.length || (existing && [...dependencies].some(id => status.get(id) !== 'alreadyPresent'))) return false
        for (const id of dependencies) needed.add(id)
        return true
      }
      const retained = new Set<string>()
      for (const { doc, dependencies } of supported) {
        if (await store.occupied(doc.id)) { retained.add(doc.id); skip.push(doc.id) }
        else if (!(await planDependencies(dependencies))) skip.push(doc.id)
        else add.push(doc.id)
      }
      const components = await componentStage?.preview((candidate, existing) => planDependencies(candidate.dependencies, existing))
      const inspect = options.existingHistory ? historyStore?.inspectExisting : undefined
      const targetVersions = await planVersionWrites({ versions, retained, parents, inspect, eligible: new Set(add), planDependencies })
      reviewedExisting = targetVersions.choices
      retainedParents = targetVersions.retainedParents
      const design = await designs?.preview((id, existing) => planDependencies(templateAssets.get(id)!, existing))
      for (const id of standalone) await planDependencies(new Set([id]))
      plan.skip = [...conflicts]
      for (const id of needed) (status.get(id) === 'available' ? plan.add : plan.alreadyPresent).push(id)
      return { ...crossPreviewPlan, ...(modelStage && { modelCards: await modelStage.preview() }), ...(components && { components }), ...(design && { design }), versions: targetVersions.plan, projects: { add, skip, unsupported: [...unsupported] }, ...(assetStore && { assets: plan }), unsupported: [...otherLibraryEntries] }
    },
    async apply() {
      const restored: string[] = [], skipped: string[] = [], failed: string[] = []
      const result = initAssetResult(), fresh = new Map<string, string>()
      const historyResult = { restored: [] as string[], skipped: [] as string[], failed: [] as string[] }
      const historyReasons: Record<string, RestoreHistoryReason> = {}
      const run = async (restoreAsset?: AssetLockCallbacks[0], checkAsset?: AssetLockCallbacks[1]) => {
        const applied = new Map<string, 'restored' | 'alreadyPresent' | 'conflict' | 'failed'>()
        const hasStatus = (dependencies: Set<string>, status: 'conflict' | 'failed') =>
          [...dependencies].some(id => applied.get(id) === status)
        async function publishDependencies(dependencies: Set<string>, existing = false) {
          if (!dependencies.size) return true
          if (!checkAsset || !restoreAsset) return false
          if (existing) {
            for (const id of dependencies) if (await checkAsset(images.get(id)!.asset) !== 'alreadyPresent') return false
            return true
          }
          for (const id of dependencies) {
            if (!applied.has(id) && await checkAsset(images.get(id)!.asset) === 'conflict') {
              applied.set(id, 'conflict')
              result.skipped.push(id)
            }
          }
          if (hasStatus(dependencies, 'conflict') || hasStatus(dependencies, 'failed')) return false
          for (const id of dependencies) {
            if (applied.has(id)) continue
            try {
              const outcome = await restoreAsset(images.get(id)!.asset)
              applied.set(id, outcome)
              result[outcome === 'conflict' ? 'skipped' : outcome].push(id)
              if (outcome === 'conflict') return false
            } catch {
              applied.set(id, 'failed')
              result.failed.push(id)
              return false
            }
          }
          return true
        }
        for (const { doc, dependencies } of supported) {
          if (retainedParents.has(doc.id)) { skipped.push(doc.id); continue }
          try {
            // Asset queue → project queue. The callback never re-enters
            // either queue; ordinary project writers cannot win mid-restore.
            const added = await store.restore(doc, dependencies.size ? () => publishDependencies(dependencies) : undefined)
            if (added) {
              restored.push(doc.id)
              fresh.set(doc.id, added.revision)
            } else if (hasStatus(dependencies, 'failed')) failed.push(doc.id)
            else skipped.push(doc.id)
          } catch {
            failed.push(doc.id)
          }
        }
        const components = await componentStage?.apply(async (candidate, existing) => {
          if (await publishDependencies(candidate.dependencies, existing)) return 'ready'
          return hasStatus(candidate.dependencies, 'failed') ? 'failed' : 'unresolved'
        })
        const fullParents = new Set<string>()
        for (const { version, dependencies } of versions) {
          const key = versionKey(version)
          const existing = reviewedExisting.get(key)
          if (existing && 'reason' in existing) { historyReasons[key] = existing.reason; historyResult.skipped.push(key); continue }
          const parentRevision = existing?.revision ?? fresh.get(version.projectId)
          const sourceParent = parents.get(version.projectId)
          if (!historyStore || !parentRevision || !sourceParent || (!existing && fullParents.has(version.projectId))) { historyResult.skipped.push(key); continue }
          try {
            const status = await historyStore.restore({ sourceParent, parentRevision, version },
              dependencies.size ? () => publishDependencies(dependencies) : undefined)
            if (status === 'restored') historyResult.restored.push(key)
            else if (status === 'dependency-unavailable' && hasStatus(dependencies, 'failed')) historyResult.failed.push(key)
            else historyResult.skipped.push(key)
            if (existing && status !== 'restored') historyReasons[key] = status === 'parent-unavailable' ? 'parent-changed' : status
            if (status === 'retention-limit' || status === 'parent-unavailable') fullParents.add(version.projectId)
          } catch {
            historyResult.failed.push(key)
          }
        }
        const design = await designs?.apply(async (id, existing) => {
          const dependencies = templateAssets.get(id)!
          if (await publishDependencies(dependencies, existing)) return 'ready'
          return hasStatus(dependencies, 'failed') ? 'failed' : 'unresolved'
        })
        // Each independently eligible image can succeed despite a collision
        // elsewhere; the same applied map dedupes referenced dependencies.
        for (const id of standalone) await publishDependencies(new Set([id]))
        return { components, design }
      }
      const { components, design } = assetStore ? await assetStore.withApplyLock(run) : await run()
      return { ...(modelStage && { modelCards: await modelStage.apply() }), ...(components && { components }), ...(design && { design }), versions: { ...historyResult, ...(Object.keys(historyReasons).length && { reasons: historyReasons }) }, projects: { restored, skipped, failed, unsupported: [...unsupported] }, ...(assetStore && { assets: result }), unsupported: [...otherLibraryEntries] }
    },
  }
}

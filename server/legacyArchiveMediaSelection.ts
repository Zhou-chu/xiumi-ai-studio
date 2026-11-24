import { discoverLegacyComponentMedia } from './legacyComponentRestore'
import { hasNativePhotoSlots } from './legacyDesignRestore'

export const MAX_NATIVE_GALLERY_IMAGES = 30
const MAX_NATIVE_CAROUSEL_SLOTS = 30

const INDEXED_IMAGE = /^\/media\/([\w-]{1,64})\.(png|jpg)(?:\?gen=[a-f0-9]{64})?$/
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function imageFile(value: unknown): string | null {
  if (!object(value) || typeof value.src !== 'string') return null
  const match = INDEXED_IMAGE.exec(value.src)
  return match && match[1] === value.assetId ? match[1] + '.' + match[2] : null
}

const projectBlockKeys = new Set(['id', 'type', 'props'])
const filledFrameKeys = new Set(['image', 'caption', 'label', 'variant'])
const carouselPropsKeys = new Set(['pics', 'label', 'ratio', 'variant'])
const carouselSlotKeys = new Set(['image', 'caption'])
const carouselRatios = new Set<unknown>(['4:3', '3:2', '16:9', '1:1', '3:4'])
const indexedRefKeys = new Set(['src', 'assetId', 'alt', 'width', 'height', 'displayWidth'])
const hasOnlyKeys = (value: Record<string, unknown>, allowed: Set<string>) => Object.keys(value).every(key => allowed.has(key))
const captionText = (value: unknown) => typeof value === 'string' && value.length <= 2000
const plausibleDimension = (value: unknown) =>
  value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 2400)

function looksLikeLocalRaster(value: unknown) {
  if (!object(value) || !hasOnlyKeys(value, indexedRefKeys) || !imageFile(value)) return false
  const { alt, width, height, displayWidth } = value
  return (alt === undefined || captionText(alt)) && plausibleDimension(width) && plausibleDimension(height) &&
    (displayWidth === undefined || (typeof displayWidth === 'number' && displayWidth >= 10 && displayWidth <= 100))
}

function supportedCarouselSlot(value: unknown): value is Record<string, unknown> {
  return object(value) && hasOnlyKeys(value, carouselSlotKeys) && captionText(value.caption) &&
    (!Object.hasOwn(value, 'image') || looksLikeLocalRaster(value.image))
}

function nativeCarouselHeader(value: Record<string, unknown>): boolean {
  const { label, ratio, variant } = value
  return hasOnlyKeys(value, carouselPropsKeys) && captionText(label) &&
    (variant === 'peek' || variant === 'full') && carouselRatios.has(ratio)
}

/** Shared cheap structural gate for project read-ahead and restore admission.
 * Actual catalog, byte, dimensions and generation validation still happens
 * through the archive reader and the existing qualified image policy. */
export function nativeCarouselSlots(value: unknown): Record<string, unknown>[] | null {
  if (!object(value) || value.type !== 'carousel' || !hasOnlyKeys(value, projectBlockKeys) ||
      typeof value.id !== 'string' || !/^[\w-]{1,64}$/.test(value.id) || !object(value.props) ||
      !nativeCarouselHeader(value.props)) return null
  const { pics } = value.props
  return Array.isArray(pics) && pics.length <= MAX_NATIVE_CAROUSEL_SLOTS && pics.every(supportedCarouselSlot) ? pics : null
}

/** Validate frame structure before selecting bytes; the store verifies the indexed reference separately. */
export function nativeFilledFrameImage(value: unknown): unknown {
  if (!object(value) || value.type !== 'frame' || !hasOnlyKeys(value, projectBlockKeys) ||
      typeof value.id !== 'string' || !/^[\w-]{1,64}$/.test(value.id) || !object(value.props)) return undefined
  const { image, caption, label, variant } = value.props
  return hasOnlyKeys(value.props, filledFrameKeys) && captionText(caption) && captionText(label) &&
    (variant === 'flag' || variant === 'circuit' || variant === 'ticket') && looksLikeLocalRaster(image) ? image : undefined
}

function imageBlock(value: unknown): string | null {
  return object(value) && value.type === 'image' && object(value.props) ? imageFile(value.props.image) : null
}

type Candidates = {
  projects: readonly Record<string, unknown>[]
  history: readonly { raw: unknown; id: string; projectId: string }[]
  design: readonly { kind: string; raw: unknown }[]
  components: readonly { id: string; raw: unknown }[]
}

type AddFile = (file: string | null) => void

function addImageBlocks(blocks: unknown, add: AddFile) {
  if (Array.isArray(blocks)) for (const block of blocks) add(imageBlock(block))
}

function addProjectCollectionMedia(block: unknown, add: AddFile) {
  if (object(block) && object(block.props)) {
    const { images } = block.props
    if (block.type === 'gallery' && Array.isArray(images) && images.length <= MAX_NATIVE_GALLERY_IMAGES) {
      for (const ref of images) add(imageFile(ref))
      return
    }
    if (block.type === 'frame') {
      add(imageFile(nativeFilledFrameImage(block)))
      return
    }
    if (block.type === 'carousel') {
      for (const slot of nativeCarouselSlots(block) ?? []) add(imageFile(slot.image))
      return
    }
  }
  addLeafMedia(block, add)
}

function addProjectMedia(project: Record<string, unknown>, add: AddFile) {
  add(imageFile(project.cover))
  if (Array.isArray(project.blocks)) for (const block of project.blocks) addProjectCollectionMedia(block, add)
}

function addVersionMedia({ raw, id, projectId }: Candidates['history'][number], add: AddFile) {
  if (object(raw) && raw.id === id && raw.projectId === projectId && object(raw.doc) && raw.doc.id === projectId) {
    addProjectMedia(raw.doc, add)
  }
}

function addLeafMedia(block: unknown, add: AddFile) {
  if (object(block) && block.type === 'photos' && object(block.props) &&
      hasNativePhotoSlots(block.props.count, block.props.pics)) {
    for (const slot of block.props.pics) if (object(slot)) add(imageFile(slot.image))
  } else add(imageBlock(block))
}

function addTemplateBlockMedia(block: unknown, add: AddFile) {
  if (object(block) && block.type === 'box' && object(block.props)) addImageBlocks(block.props.children, add)
  else addLeafMedia(block, add)
}

function addTemplateMedia({ kind, raw }: Candidates['design'][number], add: AddFile) {
  if (kind === 'templates' && object(raw) && Array.isArray(raw.blocks)) {
    for (const block of raw.blocks) addTemplateBlockMedia(block, add)
  }
}

/** Select possible dependencies of the exact admitted block families. This
 * is only read-ahead: all loaded bytes and each consumer are still validated. */
export function selectArchiveMediaFiles(candidates: Candidates, projectImages: boolean, hasBinary: (file: string) => boolean): Set<string> {
  const files = new Set<string>()
  const add: AddFile = (file) => { if (file && hasBinary(file)) files.add(file) }
  if (projectImages) {
    for (const project of candidates.projects) addProjectMedia(project, add)
    for (const version of candidates.history) addVersionMedia(version, add)
    for (const design of candidates.design) addTemplateMedia(design, add)
  }
  for (const component of candidates.components) {
    for (const file of discoverLegacyComponentMedia(component.id, component.raw)) add(file)
  }
  return files
}

import { discoverLegacyComponentMedia } from './legacyComponentRestore'
import { hasNativePhotoSlots } from './legacyDesignRestore'

const INDEXED_IMAGE = /^\/media\/([\w-]{1,64})\.(png|jpg)(?:\?gen=[a-f0-9]{64})?$/
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function imageFile(value: unknown): string | null {
  if (!object(value) || typeof value.src !== 'string') return null
  const match = INDEXED_IMAGE.exec(value.src)
  return match && match[1] === value.assetId ? match[1] + '.' + match[2] : null
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

function addVersionMedia({ raw, id, projectId }: Candidates['history'][number], add: AddFile) {
  if (object(raw) && raw.id === id && raw.projectId === projectId && object(raw.doc) && raw.doc.id === projectId) {
    addImageBlocks(raw.doc.blocks, add)
  }
}

function addTemplateBlockMedia(block: unknown, add: AddFile) {
  if (!object(block) || !object(block.props)) return
  const props = block.props
  if (block.type === 'box') addImageBlocks(props.children, add)
  else if (block.type === 'photos' && hasNativePhotoSlots(props.count, props.pics)) {
    for (const slot of props.pics) if (object(slot)) add(imageFile(slot.image))
  } else add(imageBlock(block))
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
    for (const project of candidates.projects) addImageBlocks(project.blocks, add)
    for (const version of candidates.history) addVersionMedia(version, add)
    for (const design of candidates.design) addTemplateMedia(design, add)
  }
  for (const component of candidates.components) {
    for (const file of discoverLegacyComponentMedia(component.id, component.raw)) add(file)
  }
  return files
}

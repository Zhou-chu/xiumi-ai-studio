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

function addProjectMedia(project: Record<string, unknown>, add: AddFile) {
  add(imageFile(project.cover))
  if (Array.isArray(project.blocks)) for (const block of project.blocks) addLeafMedia(block, add)
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

import { findBlock } from './tree'
import type { Block, Doc } from './types'

/** Explicit document selection boundaries shared with AI editing. */
export function selectionScope(doc: Doc, selectedId: string | null | undefined): { ids: Set<string>; top: number } | null {
  const at = findBlock(doc.blocks, selectedId)
  if (!at) return null
  const outer = at.parent ?? at.block
  const ids = new Set<string>()
  const add = (b: Block) => {
    ids.add(b.id)
    if (b.type === 'box') b.props.children.forEach(add)
  }
  add(at.block)
  return { ids, top: doc.blocks.findIndex((b) => b.id === outer.id) }
}

export function limitToSelection(doc: Doc, selectedId: string | string[] | null | undefined, rawOps: any[]): { ops: any[]; dropped: any[] } {
  if (selectedId == null) return { ops: rawOps, dropped: [] }
  const ids = Array.isArray(selectedId) ? selectedId : [selectedId]
  const valid = ids.length > 0 && ids.every(id => !!findBlock(doc.blocks, id)) && rawOps.every(op => op?.op === 'update' && ids.includes(op.id))
  return valid ? { ops: rawOps, dropped: [] } : { ops: [], dropped: rawOps }
}

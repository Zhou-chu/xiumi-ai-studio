import { newId } from './blocks'
import { removeBlockById, updateBlock } from './tree'
import type { Block, Doc, DocOp } from './types'

// Preserve the public operation API while separating trust boundaries from mutation and display.
export { validateOp } from './opValidation'
export { selectionScope, limitToSelection } from './selectionBoundary'
export { describeOp, summarize } from './operationDescriptions'

export function applyOp(doc: Doc, op: DocOp): Doc {
  const blocks = [...doc.blocks]
  switch (op.op) {
    case 'insert':
      blocks.splice(op.index, 0, { ...op.block, id: op.block.id || newId() })
      return { ...doc, blocks }
    case 'update':
      return { ...doc, blocks: updateBlock(blocks, op.id, (b) => ({ ...b, props: { ...b.props, ...op.props } }) as Block) }
    case 'remove':
      return { ...doc, blocks: removeBlockById(blocks, op.id) }
    case 'move': {
      const from = blocks.findIndex((b) => b.id === op.id)
      if (from < 0) return doc
      const [b] = blocks.splice(from, 1)
      blocks.splice(Math.max(0, Math.min(blocks.length, op.to)), 0, b)
      return { ...doc, blocks }
    }
    case 'setTheme':
      return { ...doc, themeId: op.themeId, themeOverrides: undefined }
    case 'setMeta': {
      const { title, digest, author } = op
      return { ...doc, ...(title !== undefined && { title }), ...(digest !== undefined && { digest }), ...(author !== undefined && { author }) }
    }
  }
}

export function applyOps(doc: Doc, ops: DocOp[]): Doc {
  return ops.reduce(applyOp, doc)
}

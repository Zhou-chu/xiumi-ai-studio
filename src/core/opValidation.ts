import { coerceProps, createBlock, isBlockType } from './blocks'
import { findBlock } from './tree'
import { validateHtmlUpdate } from './htmlUpdateValidation'
import type { Block, Doc, DocOp } from './types'

type Validation = { op?: DocOp; error?: string }
type Candidate = Record<string, any>

function position(value: unknown, fallback: number): number | undefined {
  const raw = value ?? fallback
  if (typeof raw !== 'number' && typeof raw !== 'string') return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

function validateInsert(doc: Doc, op: Candidate): Validation {
  const type = op.block?.type
  if (typeof type !== 'string') return { error: '模块类型必须是字符串' }
  if (!isBlockType(type) || type === 'html') return { error: `不支持插入模块类型 ${type}` }
  const parsed = position(op.index, doc.blocks.length)
  if (parsed === undefined) return { error: '插入位置必须是有限数字' }
  const block = createBlock(type, coerceProps(type, op.block.props) as any)
  const index = Math.max(0, Math.min(doc.blocks.length, parsed))
  return { op: { op: 'insert', index, block, reason: op.reason } }
}

function validateNativeUpdate(b: Exclude<Block, Block<'html'>>, op: Candidate): Validation {
  const props: Record<string, any> = coerceProps(b.type, op.props, true)
  // 文本框的子模块只能逐个修改，不能整体替换（避免丢内容）
  delete props.children
  // 图片位：AI 只能改图注，图片和位置保持不变
  if (props.pics && 'pics' in b.props) {
    const given = props.pics as { caption: string }[]
    props.pics = b.props.pics.map((old, i) => ({ ...old, caption: given[i]?.caption ?? old.caption }))
  }
  if (!Object.keys(props).length) return { error: `修改 ${op.id} 没有有效字段` }
  return { op: { op: 'update', id: op.id, props, reason: op.reason } }

}

function validateUpdate(doc: Doc, op: Candidate): Validation {
  const block = findBlock(doc.blocks, op.id)?.block
  if (!block) return { error: `找不到模块 ${op.id}` }
  return block.type === 'html' ? validateHtmlUpdate(block, op) : validateNativeUpdate(block, op)
}

function validateMove(doc: Doc, op: Candidate): Validation {
  const to = position(op.to, 0)
  if (to === undefined) return { error: '移动位置必须是有限数字' }
  return doc.blocks.some(block => block.id === op.id) ? { op: { ...op, op: 'move', id: op.id, to } } : { error: `找不到模块 ${op.id}` }
}

/** Validate untrusted model operations before any draft mutation or display. */
export function validateOp(doc: Doc, raw: any): Validation {
  if (!raw || typeof raw !== 'object') return { error: 'op 不是对象' }
  if (typeof raw.op !== 'string') return { error: '操作名称必须是字符串' }
  if (['update', 'remove', 'move'].includes(raw.op) && typeof raw.id !== 'string') return { error: '模块 ID 必须是字符串' }
  if (raw.reason !== undefined && typeof raw.reason !== 'string') return { error: '修改原因必须是文字' }
  switch (raw.op) {
    case 'insert': return validateInsert(doc, raw)
    case 'update': return validateUpdate(doc, raw)
    case 'move': return validateMove(doc, raw)
    case 'remove': return findBlock(doc.blocks, raw.id) ? { op: raw } : { error: `找不到模块 ${raw.id}` }
    case 'setTheme': return typeof raw.themeId === 'string' ? { op: raw } : { error: '缺少 themeId' }
    case 'setMeta':
      if (['title', 'author', 'digest'].some(key => raw[key] !== undefined && typeof raw[key] !== 'string')) return { error: '文章信息必须是文字' }
      return { op: raw }
    default: return { error: `未知操作 ${raw.op}` }
  }
}

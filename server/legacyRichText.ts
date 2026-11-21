import { safeColor } from '../src/core/style'
import { safeTextFont, safeTextSize } from '../src/core/textTypography'

const MAX_NODES = 8_000
const MAX_TEXT = 500_000
const MAX_LEAF = 20_000
export const legacyTextAlignments = new Set(['left', 'center', 'right', 'justify'])
const simpleMarks = new Set(['bold', 'italic', 'underline', 'strike'])
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const hasOnly = (node: Record<string, unknown>, keys: readonly string[]) => Object.keys(node).every(key => keys.includes(key))
const supportedColor = (value: unknown) => typeof value === 'string' && value.length <= 64 && safeColor(value) === value
const nullable = (value: unknown, judge: (input: unknown) => boolean) => value === undefined || value === null || judge(value)
export type RichTextBudget = { nodes: number; characters: number }

function styleMark(mark: Record<string, unknown>) {
  const attrs = mark.attrs
  if (simpleMarks.has(String(mark.type))) return attrs === undefined
  if (mark.type === 'highlight') {
    return attrs === undefined || (object(attrs) && hasOnly(attrs, ['color']) && nullable(attrs.color, supportedColor))
  }
  if (mark.type === 'textStyle') {
    return object(attrs) && hasOnly(attrs, ['color', 'fontFamily', 'fontSize']) &&
      nullable(attrs.color, supportedColor) &&
      nullable(attrs.fontFamily, font => safeTextFont(font) !== undefined) &&
      nullable(attrs.fontSize, size => safeTextSize(size) !== undefined)
  }
  // Hyperlinks, nested notes/lists and other custom nodes remain unsupported.
  return false
}

function count(budget: RichTextBudget) {
  return ++budget.nodes <= MAX_NODES
}

function inline(node: unknown, budget: RichTextBudget): boolean {
  if (!object(node) || !count(budget)) return false
  if (node.type === 'hardBreak') return hasOnly(node, ['type'])
  if (node.type !== 'text' || !hasOnly(node, ['type', 'text', 'marks']) ||
      typeof node.text !== 'string' || !node.text.length || node.text.length > MAX_LEAF) return false
  budget.characters += node.text.length
  if (budget.characters > MAX_TEXT) return false
  if (node.marks === undefined) return true
  if (!Array.isArray(node.marks) || node.marks.length > 6) return false
  const used = new Set<string>()
  for (const mark of node.marks) {
    if (!object(mark) || !count(budget) || !hasOnly(mark, ['type', 'attrs']) ||
        typeof mark.type !== 'string' || used.has(mark.type) || !styleMark(mark)) return false
    used.add(mark.type)
  }
  return true
}

/** Bounded, non-coercive subset of the existing Tiptap document format.
 * No recursive or unknown nodes, and no silent pruning of attributes. */
export function acceptsLegacyRichText(value: unknown, budget: RichTextBudget): boolean {
  if (!object(value) || value.type !== 'doc' || !hasOnly(value, ['type', 'content']) || !count(budget) ||
      !Array.isArray(value.content) || !value.content.length) return false
  for (const paragraph of value.content) {
    if (!object(paragraph) || paragraph.type !== 'paragraph' || !count(budget) ||
        !hasOnly(paragraph, ['type', 'attrs', 'content'])) return false
    const attrs = paragraph.attrs
    if (attrs !== undefined && (!object(attrs) || !hasOnly(attrs, ['textAlign']) ||
        !nullable(attrs.textAlign, value => typeof value === 'string' && legacyTextAlignments.has(value)))) return false
    if (paragraph.content !== undefined) {
      if (!Array.isArray(paragraph.content)) return false
      for (const node of paragraph.content) if (!inline(node, budget)) return false
    }
  }
  return true
}

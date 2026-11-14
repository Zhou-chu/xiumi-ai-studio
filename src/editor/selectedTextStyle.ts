import { guardHtml } from '../core/sanitize'
import { safeTextFont, safeTextSize } from '../core/textTypography'

/** Conservative boundary: no SVG or table-cell structure edits through text tools. */
export function canStyleSelection(root: HTMLElement, range: Range): boolean {
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer) || !range.toString()) return false
  const element = (node: Node) => node instanceof Element ? node : node.parentElement
  const startCell = element(range.startContainer)?.closest('td,th')
  const endCell = element(range.endContainer)?.closest('td,th')
  if (startCell !== endCell) return false
  if ([...root.querySelectorAll('td,th')].some(cell => range.intersectsNode(cell) && cell !== startCell)) return false
  return ![...root.querySelectorAll('svg')].some(svg => range.intersectsNode(svg))
}

/** Build a styled selection without mutating the live document or its surrounding structure. */
export function styledSelectionHtml(root: HTMLElement, range: Range, property: 'fontFamily' | 'fontSize', value: string): string | null {
  const safe = property === 'fontFamily' ? safeTextFont(value) : safeTextSize(value)
  if (!safe || !canStyleSelection(root, range)) return null
  const holder = root.ownerDocument.createElement('div')
  holder.append(range.cloneContents())
  holder.querySelectorAll<HTMLElement>('*').forEach(el => {
    if (el.closest('svg,script,style')) return
    el.style[property] = ''
    if (el.tagName === 'FONT') el.removeAttribute(property === 'fontSize' ? 'size' : 'face')
  })
  const walker = root.ownerDocument.createTreeWalker(holder, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  texts.forEach(text => {
    if (!text.data || text.parentElement?.closest('svg,script,style')) return
    const span = root.ownerDocument.createElement('span')
    span.style[property] = safe
    text.replaceWith(span)
    span.append(text)
  })
  return guardHtml(holder.innerHTML)
}

import { safeTextFont, safeTextSize } from '../core/textTypography'

/** Build a styled selection without mutating the live document or its surrounding structure. */
export function styledSelectionHtml(root: HTMLElement, range: Range, property: 'fontFamily' | 'fontSize', value: string): string | null {
  const safe = property === 'fontFamily' ? safeTextFont(value) : safeTextSize(value)
  if (!safe || range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer) || !range.toString()) return null
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
  return holder.innerHTML
}

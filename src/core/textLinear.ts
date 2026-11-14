/** Legacy text-only tag-span removal, not an HTML sanitizer. Keep malformed tails verbatim. */
export function stripTagSpans(text: string, replacement = ''): string {
  const parts: string[] = []
  let kept = 0
  let search = 0
  while (search < text.length) {
    const start = text.indexOf('<', search)
    if (start < 0) break
    const end = text.indexOf('>', start + 1)
    if (end < 0) break
    search = end + 1
    if (end === start + 1) continue
    parts.push(text.slice(kept, start), replacement)
    kept = search
  }
  parts.push(text.slice(kept))
  return parts.join('')
}
/** Collapse exactly whitespace runs containing an LF, leaving all other spacing intact. */
export function collapseNewlineWhitespace(text: string): string {
  return text.replace(/\s+/g, run => run.includes('\n') ? ' ' : run)
}
export function removeFirstImportant(text: string): string {
  const index = text.indexOf('!important')
  return index < 0 ? text : text.slice(0, index).trimEnd() + text.slice(index + 10)
}
/** First matching line only; keep the old greedy last closing parenthesis behavior. */
export function removeParentheticalName(text: string): string {
  let opening = -1
  let closing = -1
  for (let i = 0; i <= text.length; i++) {
    const char = text[i]
    if (i === text.length || char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029') {
      if (closing > opening && opening >= 0) return text.slice(0, opening) + text.slice(closing + 1)
      opening = closing = -1
    } else if (char === '（' && opening < 0) opening = i
    else if (char === '）' && opening >= 0) closing = i
  }
  return text
}

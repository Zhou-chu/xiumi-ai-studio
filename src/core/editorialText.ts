const lineBreak = /[\r\n\u2028\u2029]/
const isSpace = (char: string) => /\s/.test(char)
const isDigit = (char: string) => char >= '0' && char <= '9'
const quoteDash = (char: string) => char === '—' || char === '–'
const markdownDash = (char: string) => quoteDash(char) || char === '-'

export function isDecorLabel(text: string): boolean {
  return text.split(lineBreak).some(line => /[A-Za-z]{3}/.test(line) && /[·|｜/]/.test(line))
}
export function replaceFractionTotal(text: string, total: number): string {
  for (const match of text.matchAll(/\d+/g)) {
    const end = match.index + match[0].length
    let cursor = end
    while (cursor < text.length && isSpace(text[cursor])) cursor++
    if (text[cursor++] !== '/') continue
    while (cursor < text.length && isSpace(text[cursor])) cursor++
    const start = cursor
    while (cursor < text.length && isDigit(text[cursor])) cursor++
    if (cursor > start) return text.slice(0, start) + String(total).padStart(cursor - start, '0') + text.slice(cursor)
  }
  return text
}
export function copyHeading(text: string): [string,string] | null {
  let hashes = 0
  while (text[hashes] === '#') hashes++
  if (hashes < 1 || hashes > 4 || hashes >= text.length || !isSpace(text[hashes])) return null
  let start = hashes
  while (start < text.length && isSpace(text[start])) start++
  // The old greedy whitespace prefix leaves one character for the required body.
  if (start === text.length) start--
  if (start <= hashes) return null
  const body = text.slice(start)
  return lineBreak.test(body) ? null : [text.slice(0, hashes), body]
}
function sourceStart(text: string, from: number): number {
  let start = from
  while (start < text.length && isSpace(text[start])) start++
  return start === text.length ? Math.max(from, start - 1) : start
}
export function shortQuote(text: string): [string,string] | null {
  const firstBreak = text.search(lineBreak)
  let prefixEnd = 0
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && !isSpace(text[i - 1])) prefixEnd = i
    if (firstBreak >= 0 && firstBreak < prefixEnd) return null
    if (!quoteDash(text[i])) continue
    const counts = quoteDash(text[i + 1]) ? [2, 1] : [1]
    for (const count of counts) {
      if (i + count >= text.length) continue
      const start = sourceStart(text, i + count)
      if (text.length - start <= 30 && !lineBreak.test(text.slice(start))) return [text.slice(0, prefixEnd), text.slice(start)]
    }
  }
  return null
}
export function trimEdgePunctuation(text: string): string {
  const punctuation = '，。！？；、,.!?;:：'
  let start = 0, end = text.length
  while (start < end && punctuation.includes(text[start])) start++
  while (end > start && punctuation.includes(text[end - 1])) end--
  return text.slice(start, end)
}
/** Both historical grammars share delimiters, but only URL extraction rejects whitespace. */
function* imageSpans(text: string, requireUrl: boolean): Generator<{start:number;end:number;url:string}> {
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('![', cursor)
    if (start < 0) break
    const altEnd = text.indexOf(']', start + 2)
    if (altEnd < 0) break
    cursor = altEnd + 1
    if (text[cursor] !== '(') continue
    const bodyStart = ++cursor
    if (requireUrl && isSpace(text[bodyStart])) continue
    const end = text.indexOf(')', bodyStart)
    if (end < 0) break
    if (end === bodyStart) continue
    let urlEnd = bodyStart
    while (urlEnd < end && !isSpace(text[urlEnd])) urlEnd++
    yield {start, end: end + 1, url: text.slice(bodyStart, urlEnd)}
    cursor = end + 1
  }
}
export function markdownImages(text: string): string[] {
  return [...imageSpans(text, true)].map(span => span.url)
}
export function hasMarkdownImageSyntax(text: string): boolean {
  return !imageSpans(text, false).next().done
}
export function stripMarkdownImageSyntax(text: string): string {
  const parts: string[] = []
  let cursor = 0
  for (const span of imageSpans(text, false)) {
    parts.push(text.slice(cursor, span.start))
    cursor = span.end
  }
  parts.push(text.slice(cursor))
  return parts.join('')
}
export function markdownQuote(text: string): [string,string|undefined] {
  for (let i = 0; i + 2 < text.length; i++) {
    if (markdownDash(text[i]) && markdownDash(text[i + 1])) return [text.slice(0, i).trimEnd(), text.slice(sourceStart(text, i + 2))]
  }
  return [text, undefined]
}

/** Quantity recognition with the same numeric punctuation and unit grammar, without backtracking. */
export function hasQuantity(text: string): boolean {
  const units = ['名', '人次', '人', '场', '件', '张', '个', '小时', '所', '支', '条', '项', '家', '%']
  for (let i = 0; i < text.length; i++) {
    if (!isDigit(text[i])) continue
    while (i + 1 < text.length && (isDigit(text[i + 1]) || text[i + 1] === ',' || text[i + 1] === '.')) i++
    let end = i + 1
    while (end < text.length && isSpace(text[end])) end++
    if (text[end] === '余' || text[end] === '多') end++
    while (end < text.length && isSpace(text[end])) end++
    if (units.some(unit => text.startsWith(unit, end))) return true
  }
  return false
}

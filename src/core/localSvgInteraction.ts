/**
 * Complete grammar for restored, self-contained native SVG interactions.
 * This is not a general sanitizer. Reject the entire fragment on mismatch,
 * then rebuild only literal tags and validated values; never splice input HTML.
 */
const ATTR = /\s+([A-Za-z]+)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/y
const NUMBER = /^-?\d{1,4}(?:\.\d{1,4})?$/
const finite = (s: string, min: number, max: number) => NUMBER.test(s) && Number(s) >= min && Number(s) <= max
const dimension = (s: string) => finite(s, 0, 4096)
const coordinate = (s: string) => finite(s, -4096, 4096)
const color = (s: string) => /^(?:#[\da-f]{3}(?:[\da-f]{3})?|[a-z]{1,24})$/i.test(s)
const visibility = (s: string) => ['visible', 'hidden', 'collapse'].includes(s)
const event = (s: string) => s === 'click' || s === 'touchstart'
const opacity = (s: string) => finite(s, 0, 1)
type Rule = (s: string) => boolean
type Rules = Record<string, Rule>
const viewBox: Rule = s => {
  const a = s.trim().split(/\s+/)
  return a.length === 4 && coordinate(a[0]) && coordinate(a[1]) && dimension(a[2]) && dimension(a[3])
}

const SVG: Rules = { width: dimension, height: dimension, viewBox }
const RECT: Rules = { width: dimension, height: dimension, x: coordinate, y: coordinate, fill: color }
const SET: Rules = { attributeName: s => s === 'visibility' || s === 'opacity', to: s => visibility(s) || opacity(s), begin: event, fill: s => s === 'freeze' }
const ANIMATE: Rules = {
  attributeName: s => s === 'visibility',
  values: s => /^[a-z;]{1,80}$/.test(s) && s.split(';').every(visibility),
  calcMode: s => s === 'discrete',
  begin: s => s === 'indefinite',
  dur: s => /^\d{1,2}(?:\.\d{1,3})?s$/.test(s) && Number(s.slice(0, -1)) > 0 && Number(s.slice(0, -1)) <= 10,
}

function attributes(input: string, rules: Rules, required: string[]) {
  const parsed = new Map<string, string>()
  const scanner = new RegExp(ATTR)
  let offset = 0
  while (offset < input.length && input.slice(offset).trim()) {
    scanner.lastIndex = offset
    const match = scanner.exec(input)
    if (!match) return null
    const [, name, a, b] = match
    const value = a ?? b
    if (!Object.hasOwn(rules, name) || parsed.has(name) || !rules[name](value)) return null
    parsed.set(name, name === 'viewBox' ? value.trim().split(/\s+/).join(' ') : value)
    offset = scanner.lastIndex
  }
  return required.every(name => parsed.has(name)) ? parsed : null
}

const serialize = (attrs: ReadonlyMap<string, string>) => [...attrs].map(([k, v]) => ` ${k}="${v}"`).join('')

export function renderLocalSvgInteraction(html: string): string | null {
  if (html.length > 1024) return null
  const shape = /^\s*<svg\b([^<>]*)>\s*<rect\b([^<>]*)>\s*<(set|animate)\b([^<>]*?)(?:\/>|>\s*<\/\3>)\s*<\/rect>\s*<\/svg>\s*$/.exec(html)
  if (!shape) return null
  const [, rootAttrs, rectAttrs, tag, actionAttrs] = shape
  const root = attributes(rootAttrs, SVG, ['viewBox'])
  const rect = attributes(rectAttrs, RECT, ['width', 'height', 'fill'])
  const rules = tag === 'set' ? SET : ANIMATE
  const action = attributes(actionAttrs, rules, Object.keys(rules))
  if (!root || !rect || !action) return null
  if (tag === 'set' && !(action.get('attributeName') === 'visibility' ? visibility : opacity)(action.get('to')!)) return null
  return `<svg${serialize(root)}><rect${serialize(rect)}><${tag}${serialize(action)} /></rect></svg>`
}

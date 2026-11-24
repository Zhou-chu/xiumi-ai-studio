import { renderLocalSvgInteraction } from './localSvgInteraction'

const deny = "default-src 'none'; base-uri 'none'; form-action 'none'"
const header = (title: string, policy: string) => `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${title}</title>`
const localShapes = [
  '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#ccc"><set attributeName="visibility" to="hidden" begin="click" fill="freeze" /></rect></svg>',
  '<svg width="100" height="55" viewBox="0 0 100 55"><rect width="100" height="55" fill="teal"><set attributeName="opacity" to="0.2" begin="touchstart" fill="freeze" /></rect></svg>',
  '<svg width="100" height="55" viewBox="0 0 100 55"><rect width="100" height="55" fill="green"><animate attributeName="visibility" values="visible;hidden;collapse" calcMode="discrete" begin="indefinite" dur="1s" /></rect></svg>',
]

type Box = { width: number; height: number; viewBox: [number, number, number, number] }
type Rect = { width: number; height: number; x: number; y: number; fill: string }
export type LinkedSvgScene = {
  timing: number; target: number
  sourceBox: Box; followerBox: Box; sourceRect: Rect; targetRect: Rect; followerRect: Rect
}

export type CrossSvgPreview = LinkedSvgScene & { context: boolean }

const sourceName = /^[A-Za-z][A-Za-z0-9_]{0,31}$/
const decimal = /^-?\d{1,4}(?:\.\d{1,4})?$/
const idDigit = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 9
function finite(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= 4096
}
const fillPattern = /^(?:#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?|navy|orange|purple|teal|green|red|blue|black|white|gray|yellow)$/
const geometry = (w: unknown, h: unknown) => finite(w, 0.0001) && finite(h, 0.0001)
function fields(value: unknown, expected: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  return Object.keys(v).length === expected.length && expected.every(key => Object.hasOwn(v, key)) ? v : null
}

function box(input: unknown): Box | null {
  const v = fields(input, ['width', 'height', 'viewBox'])
  if (!v || !geometry(v.width, v.height) || !Array.isArray(v.viewBox) || v.viewBox.length !== 4) return null
  const [x, y, w, h] = v.viewBox
  if (!finite(x, -4096) || !finite(y, -4096) || !geometry(w, h)) return null
  return { width: v.width as number, height: v.height as number, viewBox: [x, y, w, h] }
}

function rect(input: unknown): Rect | null {
  const v = fields(input, ['width', 'height', 'x', 'y', 'fill'])
  if (!v || !geometry(v.width, v.height) || !finite(v.x, -4096) || !finite(v.y, -4096) ||
      typeof v.fill !== 'string' || !fillPattern.test(v.fill)) return null
  return { width: v.width as number, height: v.height as number, x: v.x as number, y: v.y as number, fill: v.fill }
}

export function decodeLinkedSvgScene(input: unknown): LinkedSvgScene | null {
  const v = fields(input, ['timing', 'target', 'sourceBox', 'followerBox', 'sourceRect', 'targetRect', 'followerRect'])
  if (!v || !idDigit(v.timing) || !idDigit(v.target)) return null
  const sourceBox = box(v.sourceBox), followerBox = box(v.followerBox)
  const sourceRect = rect(v.sourceRect), targetRect = rect(v.targetRect), followerRect = rect(v.followerRect)
  return sourceBox && followerBox && sourceRect && targetRect && followerRect
    ? { timing: v.timing, target: v.target, sourceBox, followerBox, sourceRect, targetRect, followerRect } : null
}

export function decodeCrossSvgPreview(input: unknown): CrossSvgPreview | null {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(input, 'context')) return null
  const { context, ...raw } = input as Record<string, unknown>
  const scene = decodeLinkedSvgScene(raw)
  return scene && typeof context === 'boolean' ? { ...scene, context } : null
}

function tags(text: string, names: readonly string[], required = names) {
  const scanner = /\s+([A-Za-z]+)="([^"<>]*)"/y
  const attrs = new Map<string, string>()
  let offset = 0
  while (text.slice(offset).trim()) {
    scanner.lastIndex = offset
    const match = scanner.exec(text)
    if (!match || !names.includes(match[1]) || attrs.has(match[1])) return null
    attrs.set(match[1], match[2])
    offset = scanner.lastIndex
  }
  return required.every(name => attrs.has(name)) ? attrs : null
}

function number(value: string) { return decimal.test(value) ? Number(value) : Number.NaN }

function openSvg(fragment: string) {
  const shape = /^<svg([^<>]*)>(.*)<\/svg>$/.exec(fragment.trim())
  if (!shape) return null
  const attrs = tags(shape[1], ['width', 'height', 'viewBox'])
  if (!attrs) return null
  const geometry = box({ width: number(attrs.get('width')!), height: number(attrs.get('height')!), viewBox: attrs.get('viewBox')!.trim().split(/ +/).map(number) })
  return geometry ? { geometry, inner: shape[2] } : null
}

function parseRect(text: string, named: boolean) {
  const required = ['width', 'height', 'fill', ...(named ? ['id'] : [])]
  const attrs = tags(text, [...required, 'x', 'y'], required)
  if (!attrs) return null
  const id = attrs.get('id')
  if (named && (!id || !sourceName.test(id))) return null
  const geometry = rect({ width: number(attrs.get('width')!), height: number(attrs.get('height')!),
    x: number(attrs.get('x') ?? '0'), y: number(attrs.get('y') ?? '0'), fill: attrs.get('fill') })
  return geometry ? { id, geometry } : null
}

function setAction(text: string, target: boolean) {
  const attrs = tags(text, ['attributeName', 'to', 'begin', 'fill', ...(target ? ['href'] : [])])
  if (!attrs || attrs.get('attributeName') !== 'opacity' || attrs.get('fill') !== 'freeze') return null
  const alpha = /^0\.([1-9])$/.exec(attrs.get('to')!)
  const source = /^([A-Za-z][A-Za-z0-9_]{0,31})\.click$/.exec(attrs.get('begin')!)
  const href = attrs.get('href')
  if (!alpha || !source || (target && (!href?.startsWith('#') || !sourceName.test(href.slice(1))))) return null
  return { alpha: Number(alpha[1]), source: source[1], href: href?.slice(1) }
}

function parseLinkedRectangles(trigger: string, follower: string) {
  const pair = /^\s*<rect([^<>]*)\/>\s*<rect([^<>]*)\/>\s*$/.exec(trigger)
  const action = /^\s*<rect([^<>]*)>\s*<set([^<>]*)\/>\s*<\/rect>\s*<set([^<>]*)\/>\s*$/.exec(follower)
  if (!pair || !action) return null
  const source = parseRect(pair[1], true), target = parseRect(pair[2], true), receiver = parseRect(action[1], false)
  const timing = setAction(action[2], false), explicit = setAction(action[3], true)
  if (!source || !target || !receiver || !timing || !explicit) return null
  if (source.id === target.id || timing.source !== source.id || explicit.source !== source.id || explicit.href !== target.id) return null
  return { timing: timing.alpha, target: explicit.alpha, sourceRect: source.geometry, targetRect: target.geometry, followerRect: receiver.geometry }
}

/** Closed preview grammar: one pair of SVGs; no source identifiers exit it. */
export function parseCrossSvgPreview(fragments: readonly string[]): CrossSvgPreview | null {
  if (![2, 5].includes(fragments.length) || fragments.some(value => value.length > 1024)) return null
  const context = fragments.length === 5
  if (context && [fragments[0], fragments[1], fragments[4]].some((value, i) => renderLocalSvgInteraction(value) !== localShapes[i])) return null
  const trigger = openSvg(fragments[context ? 2 : 0]), follower = openSvg(fragments[context ? 3 : 1])
  if (!trigger || !follower) return null
  const linked = parseLinkedRectangles(trigger.inner, follower.inner)
  return linked ? { ...linked, context, sourceBox: trigger.geometry, followerBox: follower.geometry } : null
}

const rectAttrs = (value: Rect) => `width="${value.width}" height="${value.height}" x="${value.x}" y="${value.y}" fill="${value.fill}"`
const rootAttrs = (value: Box) => `width="${value.width}" height="${value.height}" viewBox="${value.viewBox.join(' ')}"`
/** The only interaction emitted is two generated, bounded opacity actions. */
export function renderLinkedSvgScene(value: unknown, scope?: number): string {
  const scene = decodeLinkedSvgScene(value)
  if (!scene) return ''
  const interactive = Number.isSafeInteger(scope) && scope! >= 0
  const prefix = scope ? `xiumi_proof_${scope}_` : 'xiumi_proof_'
  const sourceId = prefix + '1', targetId = prefix + '2'
  const id = (value: string) => interactive ? ` id="${value}"` : ''
  const action = (alpha: number, explicit = false) => interactive
    ? `<set${explicit ? ` href="#${targetId}"` : ''} attributeName="opacity" to="0.${alpha}" begin="${sourceId}.click" fill="freeze" />` : ''
  const first = `<svg ${rootAttrs(scene.sourceBox)}><rect${id(sourceId)} ${rectAttrs(scene.sourceRect)} /><rect${id(targetId)} ${rectAttrs(scene.targetRect)} /></svg>`
  const second = `<svg ${rootAttrs(scene.followerBox)}><rect ${rectAttrs(scene.followerRect)}>${action(scene.timing)}</rect>${action(scene.target, true)}</svg>`
  return first + second
}

export function renderCrossSvgPreview(value: CrossSvgPreview): string | null {
  const decoded = decodeCrossSvgPreview(value)
  if (!decoded) return null
  const { context, ...scene } = decoded
  const paired = renderLinkedSvgScene(scene, 0)
  return header('本机跨块 SVG 预览', deny) + (context ? localShapes[0] + localShapes[1] + paired + localShapes[2] : paired)
}

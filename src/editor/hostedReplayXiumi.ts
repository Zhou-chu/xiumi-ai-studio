import { compileDoc, REPLAY_ERROR, type CompileResult } from '../core/compiler'
import { isHostedReplayImage } from '../core/hostedReplayMedia'
import { validMediaGeneration } from '../core/managedMediaUrl'
import { resolveTheme } from '../core/themes'
import { flatBlocks } from '../core/tree'
import type { Doc, ImageRef } from '../core/types'
import { checkedXiumiParts } from '../core/xiumiExport'
import type { Asset } from './api'

type IndexedAsset = Pick<Asset, 'id' | 'file' | 'generation'>
const MEDIA = /^\/media\/([\w-]{1,64}\.(?:png|jpg))(?:\?([\w%=&:.-]{1,160}))?$/
const invalidImage = () => new Error('回放图片必须匹配本机已索引素材，或经确认映射到允许的公众号图床。')
const decode = (url: string) => url.replaceAll('&amp;', '&')

function indexedLocal(value: string, assets: ReadonlyMap<string, IndexedAsset>) {
  const parsed = MEDIA.exec(value)
  if (!parsed) throw invalidImage()
  const [, file, query] = parsed
  const record = assets.get(file)
  if (!record) throw invalidImage()
  const params = new URLSearchParams(query)
  const keys = [...params.keys()]
  const gen = params.get('gen')
  const fit = params.get('fit')
  const width = params.get('w')
  if (new Set(keys).size !== keys.length || keys.some(key => !['fit', 'w', 'gen'].includes(key)) ||
      (fit !== null && !/^\d{1,3}:\d{1,3}$/.test(fit)) ||
      (width !== null && !/^\d{1,4}$/.test(width)) ||
      (gen !== null && !validMediaGeneration(gen)) ||
      (record.generation !== undefined && record.generation !== gen)) throw invalidImage()
  return { record, gen }
}

function requireReplaySelections(doc: Doc, assets: ReadonlyMap<string, IndexedAsset>) {
  const selected = (ref?: ImageRef) => {
    if (!ref) return false
    const { record, gen } = indexedLocal(ref.src, assets)
    const canonical = '/media/' + record.file + (gen ? '?gen=' + gen : '')
    if (ref.src !== canonical || (ref.assetId !== undefined && ref.assetId !== record.id)) throw invalidImage()
    return true
  }
  const topLevel = new Set(doc.blocks)
  let images = 0
  for (const block of flatBlocks(doc.blocks)) {
    if (block.type !== 'replay') continue
    if (!topLevel.has(block)) throw new Error('嵌套回放暂不支持此导出。')
    const bg = block.props.canvas.background
    if (bg.type === 'image' && selected(bg.image)) images++
    for (const scene of block.props.scenes) for (const item of scene.items) {
      if (item.type === 'image' && selected(item.image)) images++
    }
  }
  if (!images) throw new Error('没有需要上传的回放素材；请使用本地 HTML 或只含文字的秀米导出。')
}

function quotedAttributes(tag: string, attribute: RegExp) {
  return [...tag.matchAll(attribute)].map((match) => decode(match[1] ?? match[2]))
}

function cssReference(css: string, start: number, close: number) {
  const source = css.slice(start, close).trim()
  const quote = source[0]
  if (quote !== '"' && quote !== "'") return source
  // Supported URL grammars never contain a literal ')'. Quotes must
  // surround the entire value; do not backtrack into an unquoted match.
  if (source.indexOf(quote, 1) !== source.length - 1) throw invalidImage()
  return source.slice(1, -1)
}

function assertHostedCssLinks(html: string, accepted: (source: string) => boolean) {
  const css = html.replaceAll('&quot;', '"').replaceAll('&#39;', "'")
  const marker = /url\(/gi
  while (marker.exec(css)) {
    const start = marker.lastIndex
    const close = css.indexOf(')', start)
    // Trailing prose containing a literal "url(" is not a reference.
    if (close < 0) return
    const source = decode(cssReference(css, start, close))
    if (!/^#[\w-]+$/.test(source) && !accepted(source)) throw invalidImage()
    // Advance past the consumed token; no whitespace/backreference search
    // can rescan the remainder when a URL fails validation.
    marker.lastIndex = close + 1
  }
}

/** Inspect the generated output independently for SVG href, HTML src and CSS URLs. */
export function assertHostedReplayLinks(html: string, pending: ReadonlySet<string> = new Set()) {
  const accepted = (source: string) => pending.has(source) || isHostedReplayImage(source)
  for (const tag of html.matchAll(/<image\b[^>]*>/gi)) {
    const refs = quotedAttributes(tag[0], /\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)
    if (refs.length !== 1 || !accepted(refs[0])) throw invalidImage()
  }
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const refs = quotedAttributes(tag[0], /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)
    if (refs.length !== 1 || !accepted(refs[0])) throw invalidImage()
  }
  assertHostedCssLinks(html, accepted)
}

function assertRenderable(result: CompileResult) {
  const issue = result.warnings.find(text => text.startsWith(REPLAY_ERROR) || text.includes('模块数据异常，已跳过输出'))
  if (issue) throw new Error(issue)
}

function validatedMapping(value: unknown, requested: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== requested.length) throw invalidImage()
  const record = value as Record<string, unknown>
  const mapping = new Map<string, string>()
  for (const source of requested) {
    const replacement = record[source]
    if (!Object.hasOwn(record, source) || !isHostedReplayImage(replacement)) throw invalidImage()
    mapping.set(source, replacement)
  }
  return mapping
}

/** No live transport or hidden upload. The caller must provide the already owned catalog. */
export function prepareHostedReplaySource(doc: Doc, catalog: readonly IndexedAsset[]) {
  const snapshot = structuredClone(doc)
  // Keep the fully resolved theme even if the live custom theme changes before
  // a pending confirmation or response. Caller still cannot mutate the clone.
  snapshot.themeOverrides = structuredClone(resolveTheme(snapshot))
  const assets = new Map<string, IndexedAsset>()
  for (const entry of catalog) {
    if (entry.file !== entry.id + '.png' && entry.file !== entry.id + '.jpg') continue
    if (assets.has(entry.file)) throw invalidImage()
    assets.set(entry.file, { ...entry })
  }
  requireReplaySelections(snapshot, assets)
  const pending = new Set<string>()
  const checked = compileDoc(snapshot, {
    replayPendingImageUpload: true,
    mapImage(source) {
      if (source.startsWith('/media/')) pending.add(source)
      return source
    },
  })
  assertRenderable(checked)
  for (const source of pending) indexedLocal(source, assets)
  assertHostedReplayLinks(checked.html, pending)
  const parts = checkedXiumiParts(checked.html).length
  const sources = Object.freeze([...pending])
  if (!sources.length || sources.length > 64) throw invalidImage()
  return {
    parts,
    sources,
    render(response: unknown) {
      const mapping = validatedMapping(response, sources)
      const rendered = compileDoc(snapshot, { mapImage: source => mapping.get(source) ?? source })
      assertRenderable(rendered)
      assertHostedReplayLinks(rendered.html)
      return rendered.html
    },
  }
}

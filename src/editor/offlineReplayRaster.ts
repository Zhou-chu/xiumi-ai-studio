import { compileDoc, compileLocalSvgDocument, REPLAY_ERROR, type CompileResult } from '../core/compiler'
import { validMediaGeneration } from '../core/managedMediaUrl'
import { flatBlocks } from '../core/tree'
import type { Doc, ImageRef } from '../core/types'

const RASTER_FILE = /^[\w-]{1,64}\.(?:png|jpg)$/
const MAX_INDEX = 4 * 1024 * 1024
const MAX_ASSET = 8 * 1024 * 1024
const MAX_TOTAL = 16 * 1024 * 1024
const MAX_IMAGES = 64
const MEDIA_FETCH = { mode: 'same-origin', credentials: 'same-origin', redirect: 'error' } as const
type Source = { file: string; generation?: string }
type OwnedRaster = Source & { size: number }
const invalidSource = () => new Error('本地回放只支持素材库中已索引的 PNG 或 JPEG 图片。')

function parseSource(url: string): Source {
  const [path, query, unexpected] = url.split('?')
  const file = path.slice('/media/'.length)
  if (!path.startsWith('/media/') || !RASTER_FILE.test(file) || unexpected !== undefined || (query?.length ?? 0) > 200) throw invalidSource()
  const params = new URLSearchParams(query)
  const gen = params.getAll('gen')
  if ([...params.keys()].some(key => !['w', 'fit', 'gen'].includes(key)) || gen.length > 1 ||
      (gen.length && !validMediaGeneration(gen[0]))) throw invalidSource()
  return { file, generation: gen[0] }
}

function checkChosenImage(ref: ImageRef | undefined) {
  if (!ref) return
  const { file, generation } = parseSource(ref.src)
  const canonical = '/media/' + file + (generation ? '?gen=' + generation : '')
  if (ref.src !== canonical || (ref.assetId !== undefined && ref.assetId !== file.slice(0, -4))) throw invalidSource()
}

function preflightReplayImages(doc: Doc) {
  for (const block of flatBlocks(doc.blocks)) {
    if (block.type !== 'replay') continue
    const { canvas, scenes } = block.props
    if (canvas.background.type === 'image') checkChosenImage(canvas.background.image)
    for (const scene of scenes) {
      for (const item of scene.items) {
        if (item.type === 'image') checkChosenImage(item.image)
      }
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' }

async function indexAssets() {
  const r = await fetch('/api/assets', MEDIA_FETCH)
  if (!r.ok) throw new Error('无法读取本机素材库，未下载回放。')
  let items: unknown
  try {
    items = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(r, MAX_INDEX)))
  } catch {
    throw new Error('素材库数据无效或超出读取上限，未下载回放。')
  }
  if (!Array.isArray(items) || items.length > 10_000) throw invalidSource()
  const assets = new Map<string, OwnedRaster>()
  const duplicates = new Set<string>()
  for (const item of items) {
    if (!isObject(item) || typeof item.file !== 'string' || !RASTER_FILE.test(item.file) ||
        item.id !== item.file.slice(0, -4) || typeof item.size !== 'number' ||
        !Number.isSafeInteger(item.size) || item.size < 1) continue
    const { file, size, generation } = item
    if (generation !== undefined && (typeof generation !== 'string' || !validMediaGeneration(generation))) continue
    if (assets.has(file)) duplicates.add(file)
    assets.set(file, { file, size, generation })
  }
  for (const file of duplicates) assets.delete(file)
  return assets
}

function hasSignature(bytes: Uint8Array, png: boolean): boolean {
  if (png) return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
  return bytes.length >= 5 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 &&
    bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw invalidSource()
  const bytes = new Uint8Array(limit)
  const reader = response.body.getReader()
  let offset = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.length > limit) throw invalidSource()
      bytes.set(value, offset)
      offset += value.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return bytes.subarray(0, offset)
}

async function readRaster(asset: OwnedRaster): Promise<string> {
  const source = '/media/' + asset.file + '?w=2400' + (asset.generation ? '&gen=' + asset.generation : '')
  const png = asset.file.endsWith('.png')
  const mime = png ? 'image/png' : 'image/jpeg'
  const response = await fetch(source, { ...MEDIA_FETCH, cache: 'no-store' })
  if (!response.ok || response.headers.get('Content-Type')?.split(';', 1)[0] !== mime) throw invalidSource()
  const bytes = await readBounded(response, asset.size)
  if (bytes.length !== asset.size || !hasSignature(bytes, png)) throw invalidSource()
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return 'data:' + mime + ';base64,' + btoa(text)
}

/** Standalone replay only. Never resolves user-supplied hosts or renews a stale generation. */
export async function compileOfflineReplayRaster(doc: Doc, onProgress?: (message: string) => void, linkedSvg = false): Promise<CompileResult> {
  preflightReplayImages(doc)
  const sources = new Map<string, number>()
  let count = 0
  compileDoc(doc, { mapImage: url => { count++; sources.set(url, (sources.get(url) ?? 0) + 1); return url } })
  if (count > MAX_IMAGES) throw new Error('本地回放图片过多，未下载回放。')
  const references = [...sources].map(([url, copies]) => ({ url, copies, ...parseSource(url) }))
  const owned = references.length ? await indexAssets() : new Map<string, OwnedRaster>()
  const unique = new Map<string, OwnedRaster>()
  for (const { file, generation } of references) {
    const asset = owned.get(file)
    if (!asset || (generation && asset.generation && generation !== asset.generation) ||
        asset.size > MAX_ASSET) throw invalidSource()
    const current = unique.get(file)
    const expected = generation ?? asset.generation ?? current?.generation
    if (current?.generation && expected !== current.generation) throw invalidSource()
    unique.set(file, { ...asset, generation: expected })
  }
  if (references.reduce((size, ref) => size + ref.copies * unique.get(ref.file)!.size, 0) > MAX_TOTAL) throw new Error('本地回放图片超过 16 MiB，未下载回放。')
  const encoded = new Map<string, string>()
  for (const asset of unique.values()) {
    onProgress?.(`读取本地图片 ${encoded.size + 1}/${unique.size}`)
    encoded.set(asset.file, await readRaster(asset))
  }
  const embedded = new Map(references.map(({ url, file }) => [url, encoded.get(file)!]))
  const compile = linkedSvg ? compileLocalSvgDocument : compileDoc
  const result = compile(doc, { mapImage: url => embedded.get(url) ?? url })
  const error = result.warnings.find(w => w.startsWith(REPLAY_ERROR))
  if (error) throw new Error(error)
  return result
}

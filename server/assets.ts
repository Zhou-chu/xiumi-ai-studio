import type { BigIntStats } from 'node:fs'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { MAX_INPUT_PIXELS, withImageBudget } from './imageBudget'
// 素材库：上传、按需裁切缩放（微信相册统一比例）、裁剪另存。
import { existsSync } from 'node:fs'
import { link, lstat, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { DIRS, readJson, safeId, writeJson } from './store'
import { validMediaGeneration } from '../src/core/managedMediaUrl'

export interface Asset {
  id: string
  file: string
  name: string
  width: number
  height: number
  size: number
  sourceUrl?: string
  generation?: string
  createdAt: number
}

const META = join(DIRS.assets, '_index.json')
const MAX_EDGE = 2400

let indexWrites: Promise<void> = Promise.resolve()
function serializeIndex<T>(action: () => Promise<T>): Promise<T> {
  const next = indexWrites.then(action)
  indexWrites = next.then(() => {}, () => {})
  return next
}

function updateIndex(update: (idx: Record<string, Asset>) => void | Promise<void>): Promise<void> {
  return serializeIndex(async () => {
    const idx = await index()
    await update(idx)
    await writeJson(META, idx)
  })
}

async function strictIndex(): Promise<Record<string, Asset>> {
  try {
    const value = JSON.parse(await readFile(META, 'utf8')) as Record<string, Asset>
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.values(value).some(asset => !asset || typeof asset.file !== 'string')) {
      throw new Error('素材索引格式无效')
    }
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export type ArchivedAsset = { asset: Asset; bytes: Buffer }
const assetKey = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
const MAX_VARIANT_SOURCE_BYTES = 32 * 1024 * 1024
async function boundedImageBytes(path: string, limit: number): Promise<Buffer> {
  return readImageStream(createReadStream(path), limit)
}

async function readImageStream(stream: AsyncIterable<Buffer>, limit: number): Promise<Buffer> {
  const parts: Buffer[] = []
  let length = 0
  for await (const chunk of stream) {
    length += chunk.length
    if (length > limit) throw Object.assign(new Error('图片超出读取上限'), { status: 413 })
    parts.push(chunk)
  }
  return Buffer.concat(parts, length)
}

type AssetStatus = 'available' | 'alreadyPresent' | 'conflict'
async function archivedAssetStatus(idx: Record<string, Asset>, { asset, bytes }: ArchivedAsset): Promise<AssetStatus> {
  const key = assetKey(asset.id)
  const name = assetKey(asset.file)
  const owners = Object.entries(idx).filter(([id, entry]) => assetKey(id) === key || assetKey(entry.file) === name)
  const target = join(DIRS.assets, asset.file)
  if (!owners.length) return await fileExists(target) ? 'conflict' : 'available'
  const [id, existing] = owners[0]
  if (owners.length !== 1 || id !== asset.id || existing.id !== id || existing.file !== asset.file ||
      existing.width !== asset.width || existing.height !== asset.height || existing.size !== bytes.length) return 'conflict'
  try {
    const file = await lstat(target)
    if (!file.isFile() || file.size !== bytes.length) return 'conflict'
    return (await boundedImageBytes(target, bytes.length)).equals(bytes) ? 'alreadyPresent' : 'conflict'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'conflict'
    throw error
  }
}

function checkedAsset(asset: Asset) {
  const id = safeId(asset.id)
  if (asset.file !== id + '.jpg' && asset.file !== id + '.png') throw new Error('素材文件名与编号不一致')
}

async function applyArchivedAsset(input: ArchivedAsset): Promise<'restored' | 'alreadyPresent' | 'conflict'> {
  const { asset, bytes } = input
  checkedAsset(asset)
  const idx = await strictIndex()
  const status = await archivedAssetStatus(idx, input)
  if (status !== 'available') return status
  const target = join(DIRS.assets, asset.file)
  const stage = await mkdtemp(join(DIRS.assets, '.asset-restore-'))
  let owned = false
  try {
    const complete = join(stage, 'image')
    await writeFile(complete, bytes, { flag: 'wx' })
    try {
      await link(complete, target)
      owned = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'conflict'
      throw error
    }
    Object.defineProperty(idx, asset.id, { value: asset, enumerable: true, configurable: true, writable: true })
    await writeJson(META, idx)
    return 'restored'
  } catch (error) {
    if (owned) {
      try { await rm(target) }
      catch { if (error instanceof Error) Object.assign(error, { cleanupFailed: true }) }
    }
    throw error
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => {})
  }
}

export const assetRestoreStore = {
  status(input: ArchivedAsset) {
    checkedAsset(input.asset)
    return serializeIndex(async () => archivedAssetStatus(await strictIndex(), input))
  },
  // Keep normal uploads and deletion out while projects that depend on the
  // accepted asset snapshot are published. Work here must not reenter the queue.
  withApplyLock<T>(apply: (restore: typeof applyArchivedAsset, check: (asset: ArchivedAsset) => Promise<AssetStatus>) => Promise<T>): Promise<T> {
    return serializeIndex(() => apply(applyArchivedAsset, async asset => {
      checkedAsset(asset.asset)
      return archivedAssetStatus(await strictIndex(), asset)
    }))
  },
}

async function index(): Promise<Record<string, Asset>> {
  return readJson(META, {})
}

export async function listAssets(): Promise<Asset[]> {
  return Object.values(await index()).sort((a, b) => b.createdAt - a.createdAt)
}

/** 保存上传图片：纠正 EXIF 方向、限制最长边、统一为 jpg/png */
export async function saveAsset(buf: Buffer, name: string, sourceUrl?: string): Promise<Asset> {
  return withImageBudget(async () => {
    const id = nanoid(12).replace(/[^\w-]/g, '_')
    const img = sharp(buf, { animated: false, limitInputPixels: MAX_INPUT_PIXELS }).rotate()
    const meta = await img.metadata()
    // 透明的 PNG、GIF、WebP 存成 PNG（GIF 只保留第一帧），其余统一为 JPG
    const keepPng = ['png', 'gif', 'webp'].includes(meta.format ?? '') && !!meta.hasAlpha
    const ext = keepPng ? '.png' : '.jpg'
    const file = `${id}${ext}`
    const pipeline = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    return serializeIndex(async () => {
      const target = join(DIRS.assets, file)
      const idx = await index()
      if (Object.hasOwn(idx, id) || await fileExists(target)) throw new Error('素材编号冲突')
      try {
        const info = await (keepPng ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 86, mozjpeg: true })).toFile(target)
        const asset: Asset = { id, file, name, width: info.width, height: info.height, size: info.size, ...(sourceUrl ? { sourceUrl } : {}), createdAt: Date.now() }
        idx[id] = asset
        await writeJson(META, idx)
        return asset
      } catch (error) {
        try { await rm(target, { force: true }) }
        catch {
          if (error instanceof Error) Object.assign(error, { cleanupFailures: 1 })
          console.warn('Image output cleanup failed for a newly created asset')
        }
        throw error
      }
    })
  })
}

export async function deleteAsset(id: string) {
  safeId(id)
  await updateIndex(async idx => {
    const a = idx[id]
    if (!a) return
    await rm(join(DIRS.assets, a.file), { force: true })
    delete idx[id]
  })
}

/** 裁剪（像素坐标）后另存为新素材，原图保留 */
export async function cropAsset(id: string, box: { x: number; y: number; width: number; height: number }) {
  const a = (await index())[safeId(id)]
  if (!a) throw Object.assign(new Error('素材不存在'), { status: 404 })
  const r = (n: number) => Math.max(0, Math.round(n))
  const buf = await withImageBudget(() => sharp(join(DIRS.assets, a.file), { limitInputPixels: MAX_INPUT_PIXELS })
    .extract({ left: r(box.x), top: r(box.y), width: Math.min(r(box.width), a.width - r(box.x)), height: Math.min(r(box.height), a.height - r(box.y)) })
    .toBuffer())
  return saveAsset(buf, a.name.replace(/(\.\w+)?$/, '-crop$1'))
}

const MAX_VARIANT_PIXELS = 64_000_000
const FIT_RE = /^(\d{1,3}):(\d{1,3})$/

function sourceGeneration(file: string, snapshot: BigIntStats): string {
  // All managed publications create a new file, including legacy restores
  // reusing a historical name. Bind cached output to that file generation.
  const { dev, ino, size, birthtimeNs, mtimeNs, ctimeNs } = snapshot
  return createHash('sha256').update([file, dev, ino, size, birthtimeNs, mtimeNs, ctimeNs].join(':')).digest('hex')
}

async function pinMediaGeneration(path: string, file: string, snapshotKey: string, expected: string) {
  if (!validMediaGeneration(expected)) throw Object.assign(new Error('素材版本无效'), { status: 400 })
  const output = join(DIRS.cache, `source-${snapshotKey}-${expected}${extname(file)}`)
  if (existsSync(output)) return output
  return withImageBudget(async () => {
    if (existsSync(output)) return output
    const fd = await open(path, 'r')
    let bytes: Buffer
    const renamed = () => Object.assign(new Error('素材版本不可用'), { status: 404 })
    try {
      if (sourceGeneration(file, await fd.stat({ bigint: true })) !== snapshotKey) throw renamed()
      bytes = await readImageStream(fd.createReadStream({ autoClose: false }), MAX_VARIANT_SOURCE_BYTES)
      if (sourceGeneration(file, await fd.stat({ bigint: true })) !== snapshotKey ||
          createHash('sha256').update(bytes).digest('hex') !== expected) throw renamed()
    } finally {
      await fd.close()
    }
    // The HTTP sender must open the verified snapshot, never the reusable
    // source filename. Publish only complete copies; concurrent readers share.
    const temporary = join(DIRS.cache, `.${nanoid()}.media-snapshot.tmp`)
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      try { await link(temporary, output) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
    return output
  })
}

/**
 * 返回素材的变体文件路径：w = 目标宽度，fit = 宽高比（居中裁切，利用 attention 策略保留主体）
 * 结果缓存到 data/cache。
 */
export async function variantPath(file: string, fit?: string, w?: number, expectedGeneration?: string): Promise<string> {
  if (!/^[\w-]+\.(jpg|png)$/.test(file)) throw Object.assign(new Error('非法文件名'), { status: 400 })
  const src = join(DIRS.assets, file)
  if (!existsSync(src)) throw Object.assign(new Error('素材不存在'), { status: 404 })
  const width = Math.round(Math.min(2400, Math.max(64, Number(w) || 1080)))
  const m = fit ? fit.match(FIT_RE) : null
  const height = m ? Math.round((width * Number(m[2])) / Number(m[1])) : undefined
  if (height !== undefined) {
    if (!Number.isSafeInteger(height) || height < 1) throw Object.assign(new Error('Image aspect ratio must produce a positive integer height.'), { status: 400 })
    if (width * height > MAX_VARIANT_PIXELS) throw Object.assign(new Error('Image variant exceeds the 64-megapixel output limit. Reduce its width or choose a less extreme aspect ratio.'), { status: 413 })
  }
  if (!m && width >= 2400 && expectedGeneration === undefined) return src
  const generation = sourceGeneration(file, await stat(src, { bigint: true }))
  const sourcePath = expectedGeneration === undefined ? src : await pinMediaGeneration(src, file, generation, expectedGeneration)
  if (!m && width >= 2400) return sourcePath
  const suffix = `${m ? `${m[1]}x${m[2]}` : 'o'}_${width}${extname(file)}`
  const codec = (generation: string) => `${generation}_${expectedGeneration ? expectedGeneration + '_' : ''}${suffix}`
  const warm = join(DIRS.cache, codec(generation))
  // Warm cache reads need no source-byte reads, allocation, or Sharp slot.
  if (existsSync(warm)) return warm
  return withImageBudget(async () => {
    const fd = await open(sourcePath, 'r')
    let source: Buffer
    let key: string
    try {
      const current = sourceGeneration(file, await fd.stat({ bigint: true }))
      key = codec(expectedGeneration === undefined ? current : generation)
      const queuedHit = join(DIRS.cache, key)
      if (existsSync(queuedHit)) return queuedHit
      source = await readImageStream(fd.createReadStream({ autoClose: false }), MAX_VARIANT_SOURCE_BYTES)
      if (sourceGeneration(file, await fd.stat({ bigint: true })) !== current) {
        throw Object.assign(new Error('图片在生成预览时被修改，请重试'), { status: 409 })
      }
    } finally {
      await fd.close()
    }
    const out = join(DIRS.cache, key)
    let img = sharp(source, { limitInputPixels: MAX_INPUT_PIXELS })
    img = m
      ? img.resize({ width, height, fit: 'cover', position: sharp.strategy.attention })
      : img.resize({ width, withoutEnlargement: true })
    const temporary = join(DIRS.cache, `.${key}.${nanoid()}.tmp`)
    try {
      await (file.endsWith('.png') ? img.png() : img.jpeg({ quality: 84, mozjpeg: true })).toFile(temporary)
      await rename(temporary, out)
    } catch (error) {
      try { await rm(temporary, { force: true }) }
      catch {
        if (error instanceof Error) Object.assign(error, { cleanupFailures: 1 })
        console.warn('Image variant cleanup failed for a newly created output')
      }
      throw error
    }
    return out
  })
}

/** 微信 uploadimg 要求 jpg/png 且 ≤1MB：逐级降低质量与尺寸 */
export async function wechatReady(path: string): Promise<{ buf: Buffer; mime: string; name: string }> {
  const s = await stat(path)
  if (s.size <= 1_000_000) return { buf: await readFile(path), mime: path.endsWith('.png') ? 'image/png' : 'image/jpeg', name: path.split(/[\\/]/).pop()! }
  for (const [q, w] of [[80, 1600], [72, 1280], [65, 1080], [60, 900]] as const) {
    const buf = await withImageBudget(() => sharp(path, { limitInputPixels: MAX_INPUT_PIXELS }).flatten({ background: '#ffffff' }).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toBuffer())
    if (buf.length <= 1_000_000) return { buf, mime: 'image/jpeg', name: 'image.jpg' }
  }
  throw new Error('图片压缩后仍超过 1MB')
}

export async function cleanCache() {
  for (const f of await readdir(DIRS.cache)) await rm(join(DIRS.cache, f), { force: true })
}

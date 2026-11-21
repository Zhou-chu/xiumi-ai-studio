// Deliberately no route, credential access, or live transport in this module.
import sharp from 'sharp'
import { snapshotHostedRaster } from './assets'
import { MAX_INPUT_PIXELS, withImageBudget } from './imageBudget'
import { isHostedReplayImage } from '../src/core/hostedReplayMedia'
import { validMediaGeneration } from '../src/core/managedMediaUrl'

const MAX_VARIANTS = 32
const MAX_SOURCE = 8 * 1024 * 1024
const MAX_SOURCE_TOTAL = 24 * 1024 * 1024
const MAX_OUTPUT = 1_000_000
const MAX_OUTPUT_TOTAL = 12_000_000
const MAX_VARIANT_PIXELS = 6_000_000
const invalid = () => new Error('无法验证整批本机回放素材；没有开始上传。')
type Variant = { source: string; file: string; width: number; height?: number; generation: string | null }
type Raster = Readonly<{ source: string; blob: Blob; filename: string; generation: string }>
type Transport = (raster: Raster) => Promise<unknown>

function parse(source: string): Variant {
  const matched = /^\/media\/([\w-]{1,64}\.(?:png|jpg))(?:\?([\w%=&:.-]{1,160}))?$/.exec(source)
  if (!matched) throw invalid()
  const [, file, query] = matched
  const params = new URLSearchParams(query)
  const keys = [...params.keys()]
  if (new Set(keys).size !== keys.length || keys.some(key => !['fit', 'w', 'gen'].includes(key))) throw invalid()
  const generation = params.get('gen')
  if (generation !== null && !validMediaGeneration(generation)) throw invalid()
  return { source, file, generation, ...dimensions(params.get('w') ?? '1080', params.get('fit')) }
}

function dimensions(w: string, fit: string | null) {
  const width = Number(w)
  if (!/^\d{2,4}$/.test(w) || width < 64 || width > 2400) throw invalid()
  if (fit === null) return { width }
  const ratio = /^(\d{1,3}):(\d{1,3})$/.exec(fit)
  if (!ratio) throw invalid()
  const height = Math.round(width * Number(ratio[2]) / Number(ratio[1]))
  if (!Number.isSafeInteger(height) || height < 1 || height * width > MAX_VARIANT_PIXELS) throw invalid()
  return { width, height }
}

async function frozenVariant(input: Variant, bytes: Buffer, generation: string): Promise<Raster> {
  return withImageBudget(async () => {
    const png = input.file.endsWith('.png')
    const image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    const { format } = await image.metadata()
    if (format !== (png ? 'png' : 'jpeg')) throw invalid()
    const resized = input.height === undefined
      ? image.resize({ width: input.width, withoutEnlargement: true })
      : image.resize({ width: input.width, height: input.height, fit: 'cover', position: sharp.strategy.attention })
    const output = png ? await resized.png().toBuffer() : await resized.jpeg({ quality: 84, mozjpeg: true }).toBuffer()
    if (!output.length || output.length > MAX_OUTPUT) throw invalid()
    const blob = new Blob([new Uint8Array(output)], { type: png ? 'image/png' : 'image/jpeg' })
    return Object.freeze({ source: input.source, blob, filename: input.file, generation })
  })
}

/** Read and validate *all* inputs before any transfer is even accepted. */
export async function prepareHostedReplayBatch(sources: readonly string[]) {
  if (!sources.length || sources.length > MAX_VARIANTS || new Set(sources).size !== sources.length) throw invalid()
  const variants = sources.map(parse)
  const captured = new Map<string, Awaited<ReturnType<typeof snapshotHostedRaster>>>()
  const rasters: Raster[] = []
  let inputBytes = 0
  let outputBytes = 0
  for (const variant of variants) {
    let source = captured.get(variant.file)
    if (!source) {
      source = await snapshotHostedRaster(variant.file, Math.min(MAX_SOURCE, MAX_SOURCE_TOTAL - inputBytes))
      inputBytes += source.bytes.length
      captured.set(variant.file, source)
    }
    if (variant.generation !== null && variant.generation !== source.digest) throw invalid()
    const raster = await frozenVariant(variant, source.bytes, source.digest)
    outputBytes += raster.blob.size
    if (outputBytes > MAX_OUTPUT_TOTAL) throw invalid()
    rasters.push(raster)
  }
  let used = false
  return Object.freeze({
    sources: Object.freeze(variants.map(variant => variant.source)),
    async transfer(consent: boolean, send: Transport) {
      if (used) throw new Error('此回放上传计划已使用。')
      used = true
      if (consent !== true) return null
      const mapping: Record<string, string> = {}
      let confirmedImages = 0
      for (const raster of rasters) {
        try {
          const url = await send(raster)
          if (!isHostedReplayImage(url)) throw new Error('图床没有返回允许的地址。')
          mapping[raster.source] = url
          confirmedImages++
        } catch (cause) {
          throw Object.assign(new Error(
            `已确认上传 ${confirmedImages} 项图片；本次失败的请求仍可能产生上传，已上传的图片无法撤回。未生成下载。`,
            { cause },
          ), { confirmedImages, attemptedImages: confirmedImages + 1, sideEffectsUnknown: true })
        }
      }
      return Object.freeze(mapping)
    },
  })
}

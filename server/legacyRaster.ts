import sharp from 'sharp'
import { withImageBudget } from './imageBudget'
import type { Asset } from './assets'

const MAX_ARCHIVED_IMAGE_PIXELS = 2400 * 2400
const invalid = () => Object.assign(new Error('备份格式无效或项目文件已损坏'), { status: 400 })
export function isAssetCatalog(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readAssetMetadata(id: string, value: unknown): Asset {
  if (!/^[\w-]{1,64}$/.test(id) || !isAssetCatalog(value)) throw invalid()
  const { file, name, width, height, size, createdAt } = value
  if (value.id !== id || !(file === id + '.jpg' || file === id + '.png') ||
      typeof name !== 'string' || typeof width !== 'number' || typeof height !== 'number' ||
      typeof size !== 'number' || typeof createdAt !== 'number' ||
      [width, height, size].some(item => !Number.isSafeInteger(item) || item < 1) ||
      !Number.isFinite(createdAt) || width > 2400 || height > 2400) throw invalid()
  // Preserve only local display metadata; legacy source URL/key fields are
  // not used to fetch content or trusted as a new external-cache identity.
  return { id, file, name, width, height, size, createdAt }
}

export async function validateArchivedRaster(asset: Asset, bytes: Buffer) {
  if (asset.size !== bytes.length) throw invalid()
  await withImageBudget(async () => {
    const img = sharp(bytes, { limitInputPixels: MAX_ARCHIVED_IMAGE_PIXELS, failOn: 'warning' })
    const actual = await img.metadata()
    if (actual.format !== (asset.file.endsWith('.png') ? 'png' : 'jpeg') ||
        actual.width !== asset.width || actual.height !== asset.height ||
        (actual.pages ?? 1) !== 1) throw invalid()
    await img.raw().toBuffer()
  })
}

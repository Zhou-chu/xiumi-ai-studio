import JSZip from 'jszip'
import type { Doc } from '../core/types'
import { api, type Asset } from './api'

const validId = /^[\w-]{1,64}$/
const managedImage = /^[\w-]{1,64}\.(?:jpg|png)$/
const maxBytes = 128 * 1024 * 1024
// Keep the file cap aligned with the portable offline reader.
const maxEntries = 2000

const projectData = ({ id, title, author, digest, themeId, themeOverrides, cover, blocks, createdAt, updatedAt, revision }: Doc) =>
  ({ id, title, author, digest, themeId, themeOverrides, cover, blocks, createdAt, updatedAt, revision })
const assetData = ({ id, file, name, width, height, size, createdAt }: Asset) =>
  ({ id, file, name, width, height, size, createdAt })

/** Read only already exposed application records; no filesystem paths or settings. */
export async function createProjectBackup(): Promise<ArrayBuffer> {
  const [projects, assets] = await Promise.all([api.projects(), api.assets()])
  if (projects.length + assets.length + 2 > maxEntries) {
    throw new Error('项目和素材超过 2000 个备份文件，无法生成浏览器备份。')
  }
  const zip = new JSZip()
  const assetIndex = new Map<string, Asset>()
  let byteCount = 0
  const count = (bytes: number) => {
    byteCount += bytes
    if (byteCount > maxBytes) throw new Error('项目和素材超过 128 MB，无法生成浏览器备份。')
  }
  const addJson = (path: string, value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    count(bytes.byteLength)
    zip.file(path, bytes)
  }

  addJson('xiumi-backup.json', { app: 'xiumi-ai-studio', createdAt: new Date().toISOString(), scope: 'projects-and-assets' })
  for (const { id } of projects) {
    if (!validId.test(id)) throw new Error('项目标识无效，未生成备份。')
    const doc = await api.project(id)
    if (doc.id !== id) throw new Error('项目已变化，未生成备份。')
    addJson(`projects/${id}.json`, projectData(doc))
  }
  for (const asset of assets) {
    if (!validId.test(asset.id) || !managedImage.test(asset.file)) throw new Error('素材标识无效，未生成备份。')
    if (asset.size > maxBytes - byteCount) throw new Error('项目和素材超过 128 MB，无法生成浏览器备份。')
    const res = await fetch(`/media/${asset.file}?w=2400`, { mode: 'same-origin', redirect: 'error', cache: 'no-store' })
    if (!res.ok) throw new Error('有素材无法读取，未生成备份。')
    const bytes = await res.arrayBuffer()
    count(bytes.byteLength)
    zip.file(`assets/${asset.file}`, bytes)
    assetIndex.set(asset.id, assetData(asset))
  }
  addJson('assets/_index.json', Object.fromEntries(assetIndex))
  return zip.generateAsync({ type: 'arraybuffer' })
}

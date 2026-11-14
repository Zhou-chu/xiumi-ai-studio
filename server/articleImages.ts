import { listAssets, saveAsset, type Asset } from './assets'
import { IMAGE_HOST, safeFetch } from './net'
export interface ArticleImageResult { url: string; status: 'imported' | 'existing' | 'failed'; asset?: Asset; error?: string }
interface Dependencies { list: typeof listAssets; save: typeof saveAsset; fetch: (url: string) => Promise<Response> }
const MAX = 30 * 1024 * 1024
const defaults: Dependencies = { list: listAssets, save: saveAsset, fetch: url => safeFetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, allowHost: host => IMAGE_HOST.test(host), maxBytes: MAX }) }
// Serialize batches to make repeated clicks/retries idempotent against persisted source metadata.
let tail: Promise<unknown> = Promise.resolve()
export function importArticleImages(input: unknown, deps: Dependencies = defaults): Promise<ArticleImageResult[]> {
  if (!Array.isArray(input) || input.length > 80 || input.some(u => typeof u !== 'string' || !u || u.length > 8192)) return Promise.reject(Object.assign(new Error('请选择最多 80 张图片'), { status: 400 }))
  const urls = [...new Set(input as string[])]
  const run = async () => {
    const results: ArticleImageResult[] = []
    for (const raw of urls) {
      try {
        const existing = await deps.list()
        const local = raw.match(/^\/media\/([\w-]+\.(?:png|jpg))(?:\?[^#]*)?$/)
        if (local) {
          const found = existing.find(a => a.file === local[1])
          if (!found) throw new Error('本地素材已不存在，请重新上传原图')
          results.push({ url: raw, status: 'existing', asset: found }); continue
        }
        const url = new URL(raw)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !IMAGE_HOST.test(url.hostname)) throw new Error('目前仅支持微信／秀米图床；其他来源请上传原图')
        url.hash = ''
        const sourceUrl = url.href
        const found = existing.find(a => a.sourceUrl === sourceUrl)
        if (found) { results.push({ url: raw, status: 'existing', asset: found }); continue }
        const response = await deps.fetch(sourceUrl)
        if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`)
        const bytes = Buffer.from(await response.arrayBuffer())
        if (!bytes.length || bytes.length > MAX) throw new Error('图片为空或超过 30 MB')
        const asset = await deps.save(bytes, '文稿图片', sourceUrl)
        results.push({ url: raw, status: 'imported', asset })
      } catch (error) {
        // Do not leak credential-bearing URLs or network internals into diagnostics.
        const message = error instanceof Error ? error.message : '导入失败'
        const safe = /^(目前仅支持|本地素材|图片下载失败|图片为空)/.test(message) ? message : '图片无法读取或格式不受支持，请上传原图后重试'
        results.push({ url: raw, status: 'failed', error: safe })
      }
    }
    return results
  }
  const promise = tail.then(run, run)
  tail = promise.catch(() => {})
  return promise
}

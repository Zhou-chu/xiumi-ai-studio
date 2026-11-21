// Owned replay only: adapt the staged immutable bytes, never reopen a path.
import { isHostedReplayImage } from '../src/core/hostedReplayMedia'

type Exchange = (body: FormData, signal: AbortSignal) => Promise<unknown>
type StagedBlob = Readonly<{ blob: Blob; filename: string }>
const MAX_TIMEOUT = 10_000
const MAX_BYTES = 1_000_000

function multipart({ blob, filename }: StagedBlob) {
  if (!/^[\w-]{1,64}\.(?:jpg|png)$/.test(filename) ||
      blob.type !== (filename.endsWith('.png') ? 'image/png' : 'image/jpeg') ||
      blob.size < 1 || blob.size > MAX_BYTES) throw new Error('回放图片或 MIME 无效。')
  const body = new FormData()
  body.append('media', blob, filename)
  return body
}

/** No chosen URL/account/token, live default, path cache, retries, or second send. */
export function createHostedReplayMultipartTransport(exchange: Exchange, { timeoutMs = MAX_TIMEOUT } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT) throw new RangeError('Invalid hosted replay exchange timeout')
  return async (raster: StagedBlob) => {
    const body = multipart(raster)
    const abort = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('图床传输超时；本次图片可能已上传。')
        reject(error)
        abort.abort(error)
      }, timeoutMs)
    })
    try {
      const response = await Promise.race([exchange(body, abort.signal), timeout])
      const url = response && typeof response === 'object' && Object.hasOwn(response, 'url') ? (response as { url: unknown }).url : undefined
      if (!isHostedReplayImage(url)) throw new Error('图床地址缺失或不允许。')
      return url
    } finally {
      clearTimeout(timer)
    }
  }
}

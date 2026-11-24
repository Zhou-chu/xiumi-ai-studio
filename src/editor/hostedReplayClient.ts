import { HOSTED_REPLAY_PATH } from '../core/hostedReplayMedia'
import { ApiError } from './api'

async function post(action: 'prepare' | 'transfer' | 'cancel', data: object) {
  const response = await fetch(HOSTED_REPLAY_PATH + '/' + action, {
    method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    signal: AbortSignal.timeout(action === 'transfer' ? 60_000 : 15_000),
  })
  if (!response.ok) {
    const reply = await response.json().catch(() => null)
    throw new ApiError(typeof reply?.error === 'string' ? reply.error : '未收到有效的回放回复。', response.status)
  }
  return response
}

/** Dedicated to the owner-gated bridge; never uses the ordinary publication API. */
export async function stageHostedReplayUpload(sources: readonly string[]) {
  const { token, images } = await (await post('prepare', { sources })).json()
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !Number.isSafeInteger(images) || images < 1 || images > 32) {
    throw new Error('未收到有效的回放计划。')
  }
  let used = false
  return Object.freeze({
    images,
    async cancel() {
      if (used) return
      used = true
      await post('cancel', { token })
    },
    async transfer(): Promise<unknown> {
      if (used) throw new Error('回放素材计划已使用。')
      used = true
      try {
        return (await (await post('transfer', { token, confirm: true })).json()).mapping
      } catch (error) {
        if (error instanceof ApiError && [400, 403, 404, 429, 502].includes(error.status)) throw error
        throw new Error('未收到上传确认。图片可能已上传，无法撤回；未生成下载。', { cause: error })
      }
    },
  })
}

// Desktop-only bridge. Not registered by createApp; no default transport.
import { randomBytes } from 'node:crypto'
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express'
import { HOSTED_REPLAY_PATH } from '../src/core/hostedReplayMedia'
import { isOwnedDesktopRequest } from './desktopActions'
import { prepareHostedReplayBatch } from './hostedReplayBatch'

const COOKIE = 'xiumi_replay_owner'
const cookie = { httpOnly: true, sameSite: 'strict' as const, path: HOSTED_REPLAY_PATH }
const MAX_TTL = 2 * 60_000
const secret = () => randomBytes(32).toString('hex')
const secureToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

type Batch = Awaited<ReturnType<typeof prepareHostedReplayBatch>>
type Transport = Parameters<Batch['transfer']>[1]
type Plan = { owner: string; token: string; expiresAt: number; batch: Batch; timer: NodeJS.Timeout }
const fail = (res: Response, status: number, error: string) => res.status(status).json({ error })

export function isOwnedReplayBrowser(req: Request, requireOrigin: boolean) {
  const { localPort, remoteAddress, localAddress } = req.socket
  return !!localPort && localAddress === '127.0.0.1' && remoteAddress === '127.0.0.1' &&
    isOwnedDesktopRequest(req.headers, `http://127.0.0.1:${localPort}`, requireOrigin)
}

function ownerOnly(req: Request, res: Response, next: Parameters<RequestHandler>[2]) {
  res.setHeader('Cache-Control', 'no-store')
  if (!isOwnedReplayBrowser(req, true)) return fail(res, 403, '仅允许同源本机桌面使用回放上传。')
  if (!req.is('application/json') || Object.keys(req.query).length) return fail(res, 400, '回放操作只接受指定 JSON 参数。')
  next()
}

function fields(req: Request, ...expected: string[]) {
  const body: unknown = req.body
  return !!body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === expected.length && expected.every(key => Object.hasOwn(body, key))
}

function requestOwner(req: Request) {
  const values = (req.get('cookie') ?? '').split(';').map(item => item.trim()).filter(item => item.startsWith(COOKIE + '='))
  return values.length === 1 ? values[0].slice(COOKIE.length + 1) : undefined
}

function sendTransferError(res: Response, cause: unknown) {
  const error = cause as Partial<{ confirmedImages: number; attemptedImages: number; sideEffectsUnknown: boolean }>
  if (error?.sideEffectsUnknown !== true || typeof error.confirmedImages !== 'number' || typeof error.attemptedImages !== 'number') {
    return fail(res, 502, '未生成回放导入包。上传状态未知，已上传的图片无法撤回。')
  }
  return res.status(502).json({
    error: `已确认上传 ${error.confirmedImages} 项；失败的请求仍可能产生上传，已上传的图片无法撤回。未生成下载。`,
    confirmedImages: error.confirmedImages,
    attemptedImages: error.attemptedImages,
    sideEffectsUnknown: true,
  })
}

/** Mount only on the owner-controlled loopback desktop. Caller supplies all external behavior. */
export function createHostedReplayConsentRouter(send: Transport, { now = Date.now, ttlMs = MAX_TTL } = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL) throw new RangeError('Invalid replay plan timeout')
  const router = express.Router({ caseSensitive: true, strict: true })
  let pending: Plan | undefined
  let busy = false
  const discard = () => {
    if (pending) clearTimeout(pending.timer)
    pending = undefined
  }
  const current = () => {
    if (pending && pending.expiresAt <= now()) discard()
    return pending
  }

  router.use(ownerOnly, express.json({ limit: '9kb', strict: true, inflate: false }))
  router.post('/prepare', async (req, res) => {
    if (!fields(req, 'sources') || !Array.isArray(req.body.sources) ||
        req.body.sources.some((source: unknown) => typeof source !== 'string')) return fail(res, 400, '只接受本机回放素材列表。')
    if (busy || current()) return fail(res, 429, '另一个回放素材计划正在使用。')
    busy = true
    try {
      const batch = await prepareHostedReplayBatch(req.body.sources)
      if (res.destroyed) return
      const token = secret()
      const owner = secret()
      const expiresAt = now() + ttlMs
      const timer = setTimeout(() => { if (pending?.token === token) discard() }, ttlMs)
      timer.unref()
      pending = { token, owner, batch, expiresAt, timer }
      res.cookie(COOKIE, owner, { ...cookie, maxAge: ttlMs })
      return res.json({ token, images: batch.sources.length, expiresAt })
    } catch {
      return fail(res, 400, '无法验证整批本机回放素材；没有开始上传。')
    } finally {
      busy = false
    }
  })

  function consume(req: Request, res: Response) {
    const plan = current()
    if (!plan || plan.token !== req.body.token || plan.owner !== requestOwner(req)) {
      fail(res, 404, '回放素材计划不存在或已经结束。')
      return undefined
    }
    discard()
    res.clearCookie(COOKIE, cookie)
    return plan.batch
  }

  router.post('/cancel', (req, res) => {
    if (!fields(req, 'token') || !secureToken(req.body.token)) return fail(res, 400, '需要有效的回放计划。')
    if (consume(req, res)) return res.status(204).end()
  })

  router.post('/transfer', async (req, res) => {
    if (!fields(req, 'token', 'confirm') || !secureToken(req.body.token) || req.body.confirm !== true) {
      return fail(res, 400, '上传需要用户明确确认。')
    }
    const batch = consume(req, res)
    if (!batch) return
    busy = true
    try {
      return res.json({ mapping: await batch.transfer(true, send) })
    } catch (error) {
      return sendTransferError(res, error)
    } finally {
      busy = false
    }
  })
  router.use(((error, _req, res, _next) => {
    const status = [400, 413, 415].includes(error?.status) ? error.status : 500
    return fail(res, status, '无法读取回放请求。')
  }) satisfies ErrorRequestHandler)
  return router
}

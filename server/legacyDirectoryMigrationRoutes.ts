import { randomBytes } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Express, Request, RequestHandler, Response } from 'express'
import { assetRestoreStore } from './assets'
import { isOwnedDesktopRequest } from './desktopActions'
import { createLegacyDirectoryPreview } from './legacyDirectoryMigration'
import { stageLegacyDirectoryProjects } from './legacyProjectRestore'

const route = '/api/data/migrate'
const cookieName = 'xiumi_migration_owner'
const ttl = 10 * 60_000
type Store = Parameters<typeof stageLegacyDirectoryProjects>[1]
type Stage = ReturnType<typeof stageLegacyDirectoryProjects>
type Snapshot = Awaited<ReturnType<ReturnType<typeof createLegacyDirectoryPreview>['snapshotProjects']>>
type Pending = { owner: string; token: string; stage: Stage; sourceVersion: string; summaries: Snapshot['summaries']; timeout: NodeJS.Timeout }

const secret = () => randomBytes(32).toString('hex')
const cookieOptions = { path: route, httpOnly: true, sameSite: 'strict' as const }
const requestOwner = (req: Request) => /(?:^|;\s*)xiumi_migration_owner=([a-f0-9]{64})(?:;|$)/.exec(req.get('cookie') ?? '')?.[1]
const bodyKeys = (body: unknown) => body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null

function ownerOnly(req: Request, res: Response, next: Parameters<RequestHandler>[2]) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.socket.localAddress !== '127.0.0.1' || req.socket.remoteAddress !== '127.0.0.1' ||
      !req.socket.localPort || !isOwnedDesktopRequest(req.headers, 'http://127.0.0.1:' + req.socket.localPort, req.method !== 'GET')) {
    res.status(403).json({ error: '仅允许本机桌面页面迁移旧版数据' })
    return
  }
  next()
}

function respondError(res: Response, error: unknown) {
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
  if (error instanceof Error && (status === 400 || status === 409 || status === 413)) {
    res.status(status).json({ error: error.message })
  } else {
    res.status(500).json({ error: '无法迁移这份本机旧版数据，请重新检测。' })
  }
}

/** The source is supplied only by the owner-controlled portable launch. */
export function registerLegacyDirectoryMigrationRoutes(app: Express, projects: Store, configuredSource: string, target: string) {
  const source = createLegacyDirectoryPreview({ configuredSource, target, maxEntries: 5000 })
  let pending: Pending | undefined
  let busy = false
  const discard = () => {
    if (pending) clearTimeout(pending.timeout)
    pending = undefined
  }

  app.get(route, ownerOnly, (_req, res) => res.json({ available: true }))
  app.post(route, ownerOnly, async (req, res) => {
    if (bodyKeys(req.body)?.length !== 0 || Object.keys(req.query).length) {
      return res.status(400).json({ error: '不接受迁移路径或额外参数' })
    }
    if (busy || (pending && pending.owner !== requestOwner(req))) {
      return res.status(429).json({ error: '另一个迁移会话正在运行' })
    }
    busy = true
    const controller = new AbortController()
    const close = () => { if (!res.writableFinished) controller.abort() }
    res.once('close', close)
    try {
      const { sourceLayout, sourceVersion, projects: candidates, assets, summaries, verifyDestination } = await source.snapshotProjects(controller.signal)
      const verifyAssetDestination = async () => {
        await verifyDestination()
        const info = await lstat(join(target, 'assets', '_index.json')).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        if (info && (!info.isFile() || info.nlink !== 1)) {
          throw Object.assign(new Error('无法安全使用当前素材索引'), { status: 409 })
        }
      }
      const stage = stageLegacyDirectoryProjects(candidates, {
        occupied: async id => { await verifyDestination(); return projects.occupied(id) },
        // Shares the ordinary store queue and writes only after checking our
        // pinned target again. No portable atomic OS directory handle claimed.
        restore: (doc, prepare) => projects.restore(doc, async () => {
          await verifyDestination()
          const ready = await prepare?.() ?? true
          await verifyDestination()
          return ready
        }),
      }, assets, {
        status: asset => assetRestoreStore.withApplyLock(async (_restore, check) => {
          await verifyAssetDestination()
          return check(asset)
        }),
        withApplyLock: apply => assetRestoreStore.withApplyLock((restore, check) => apply(
          async asset => { await verifyAssetDestination(); return restore(asset) },
          async asset => { await verifyAssetDestination(); return check(asset) },
        )),
      })
      const plan = (await stage.preview()).projects
      if (controller.signal.aborted) return
      discard()
      const token = secret()
      const owner = secret()
      const timeout = setTimeout(() => { if (pending?.token === token) discard() }, ttl)
      timeout.unref()
      pending = { owner, token, stage, sourceVersion, summaries, timeout }
      res.cookie(cookieName, owner, { ...cookieOptions, maxAge: ttl })
      return res.json({ token, plan: {
        sourceLayout, add: plan.add.length, skip: plan.skip.length, unsupported: plan.unsupported.length, invalid: summaries.invalid, ignored: summaries.ignored,
      } })
    } catch (error) {
      if (!controller.signal.aborted) respondError(res, error)
    } finally {
      res.removeListener('close', close)
      busy = false
    }
  })

  app.post(route + '/:token/:action', ownerOnly, async (req, res) => {
    const action = req.params.action
    if (!pending || pending.token !== req.params.token || pending.owner !== requestOwner(req) || (action !== 'apply' && action !== 'cancel')) {
      return res.status(404).json({ error: '迁移会话不存在或已经结束' })
    }
    const keys = bodyKeys(req.body)
    if (Object.keys(req.query).length || (action === 'apply' ? keys?.length !== 1 || req.body.confirm !== true : keys?.length !== 0)) {
      return res.status(400).json({ error: '需要明确确认或取消迁移' })
    }
    if (busy) return res.status(429).json({ error: '另一个迁移操作正在运行' })
    const { stage, sourceVersion, summaries } = pending
    discard()
    res.clearCookie(cookieName, cookieOptions)
    if (action === 'cancel') return res.status(204).end()
    busy = true
    try {
      let currentVersion: string
      try { currentVersion = (await source.snapshotProjects()).sourceVersion }
      catch { return res.status(409).json({ error: '旧版目录已更改或不可读，请重新检测' }) }
      if (currentVersion !== sourceVersion) return res.status(409).json({ error: '旧版目录已更改，请重新检测' })
      const result = (await stage.apply()).projects
      return res.json({
        restored: result.restored.length, skipped: result.skipped.length, failed: result.failed.length, unsupported: result.unsupported.length,
        invalid: summaries.invalid, ignored: summaries.ignored,
      })
    } catch (error) {
      respondError(res, error)
    } finally { busy = false }
  })
}

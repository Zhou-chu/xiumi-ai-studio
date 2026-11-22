import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import type { Express, Request, RequestHandler } from 'express'
import multer from 'multer'
import { stageLegacyTextProjects } from './legacyProjectRestore'
import { assetRestoreStore } from './assets'
import { localArchiveOrigin } from './localArchiveOrigin'
import { createUploadGate } from './uploadGate'
import { archiveUploadStorage } from './archiveUploadStorage'
import { MAX_RESTORE_ARCHIVE_UPLOAD } from '../src/core/backupLimits'

const route = '/api/data/restore'
const COOKIE = 'xiumi_restore_owner'
type Store = Parameters<typeof stageLegacyTextProjects>[1]
type Stage = Awaited<ReturnType<typeof stageLegacyTextProjects>>
type Pending = { owner: string; token: string; stage: Stage; timeout: NodeJS.Timeout }

const randomSecret = () => randomBytes(32).toString('hex')
function ownerCookie(req: Request) {
  const header = req.get('cookie') ?? ''
  return /(?:^|;\s*)xiumi_restore_owner=([a-f0-9]{64})(?:;|$)/.exec(header)?.[1]
}
const localOnly: RequestHandler = (req, res, next) => {
  if (!localArchiveOrigin(req)) {
    res.status(403).json({ error: '只允许从同源本机恢复备份' })
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  next()
}

export function registerLegacyRestoreRoutes(
  app: Express,
  projects: Store,
  tempRoot = tmpdir(),
  history?: Parameters<typeof stageLegacyTextProjects>[2],
  design?: Parameters<typeof stageLegacyTextProjects>[4],
) {
  let pending: Pending | undefined
  let applying = false
  const ttl = 10 * 60 * 1000
  const clear = () => {
    if (pending) clearTimeout(pending.timeout)
    pending = undefined
  }
  const archives = archiveUploadStorage(tempRoot)
  const upload = multer({
    storage: archives.storage,
    limits: { fileSize: MAX_RESTORE_ARCHIVE_UPLOAD, files: 1, fields: 0, parts: 2 },
  })
  const uploadRoute = createUploadGate({ concurrency: 1 })
  app.post(route, localOnly, (req, res, next) => {
    if (applying || (pending && pending.owner !== ownerCookie(req))) {
      req.resume()
      res.status(429).json({ error: '另一个恢复会话正在运行' })
      return
    }
    next()
  }, uploadRoute(upload.single('file'), async (req, res) => {
    const archive = archives.take(req)
    if (!archive) {
      res.status(400).json({ error: '缺少备份文件' })
      return
    }
    let stage: Stage
    try {
      const projectImages = req.query.indexedImages === '1'
      const standaloneImages = req.query.standaloneImages === '1'
      const components = req.query.components === '1' ? (await import('./components')).componentRestoreStore : undefined
      stage = await stageLegacyTextProjects(archive.path, projects, history, projectImages || standaloneImages || components ? assetRestoreStore : undefined,
        req.query.design === '1' ? design : undefined, { components, projectImages, standaloneImages, modelCards: req.query.modelCards === '1', crossSvgPreview: req.query.crossSvgPreview === '1' })
    } finally {
      await archive.dispose()
    }
    if (res.destroyed) return
    const plan = await stage.preview()
    if (res.destroyed) return
    if (applying) {
      res.status(429).json({ error: '恢复正在运行，请先等待结束' })
      return
    }
    clear()
    const token = randomSecret()
    const owner = randomSecret()
    const timeout = setTimeout(() => { if (pending?.token === token) clear() }, ttl)
    timeout.unref()
    pending = { token, owner, stage, timeout }
    res.cookie(COOKIE, owner, { httpOnly: true, sameSite: 'strict', path: route, maxAge: ttl, secure: req.secure })
    res.json({ token, plan })
  }))
  app.post(route + '/:token/cancel', localOnly, (req, res) => {
    if (!pending || pending.token !== req.params.token || pending.owner !== ownerCookie(req)) {
      res.status(404).json({ error: '恢复会话已过期，请重新选择备份文件' })
      return
    }
    clear()
    res.clearCookie(COOKIE, { sameSite: 'strict', httpOnly: true, path: route, secure: req.secure })
    res.status(204).end()
  })
  app.post(route + '/:token/apply', localOnly, async (req, res, next) => {
    if (!pending || pending.token !== req.params.token || pending.owner !== ownerCookie(req)) {
      res.status(404).json({ error: '恢复会话已过期，请重新选择备份文件' })
      return
    }
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: '需要确认恢复' })
      return
    }
    const stage = pending.stage
    clear()
    applying = true
    try {
      res.clearCookie(COOKIE, { sameSite: 'strict', httpOnly: true, path: route, secure: req.secure })
      res.json(await stage.apply())
    } catch (error) {
      next(error)
    } finally {
      applying = false
    }
  })
}

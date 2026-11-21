import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Request } from 'express'
import type { StorageEngine } from 'multer'
import { trackUpload, uploadContext } from './uploadGate'

type Archive = { path: string; dispose: () => Promise<void> }

/**
 * Keep the bounded multipart body on disk until the archive reader takes
 * ownership. No user-supplied filename or uploaded Buffer enters this path.
 * Use with Multer's single-file limit and the shared upload admission gate.
 */
export function archiveUploadStorage(tempRoot: string) {
  const leases = new WeakMap<Request, { archive: Archive; detach: () => void }>()

  function take(req: Request): Archive | undefined {
    const lease = leases.get(req)
    leases.delete(req)
    lease?.detach()
    return lease?.archive
  }

  const storage: StorageEngine = {
    _handleFile(req, file, callback) {
      const done = trackUpload(req)
      const admission = uploadContext(req).controller.signal
      const limited = new AbortController()
      const onLimit = () => limited.abort(Object.assign(new Error('备份超过上传容量'), { status: 413 }))
      file.stream.once('limit', onLimit)
      const signal = AbortSignal.any([admission, limited.signal])
      void (async () => {
        let archive: Archive | undefined
        let size = 0
        let error: unknown
        try {
          signal.throwIfAborted()
          const directory = await mkdtemp(join(tempRoot, 'xiumi-restore-archive-'))
          let cleanup: Promise<void> | undefined
          archive = { path: join(directory, 'source'), dispose: () => cleanup ??= rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) }
          signal.throwIfAborted()
          const output = createWriteStream(archive.path, { flags: 'wx', mode: 0o600 })
          await pipeline(file.stream, output, { signal })
          signal.throwIfAborted()
          size = output.bytesWritten
          const onAbort = () => {
            const orphan = take(req)
            if (!orphan) return
            const cleaned = trackUpload(req)
            void orphan.dispose().catch(() => { console.warn('Could not remove the canceled archive spool.') }).finally(cleaned)
          }
          leases.set(req, { archive, detach: () => admission.removeEventListener('abort', onAbort) })
          admission.addEventListener('abort', onAbort, { once: true })
        } catch (cause) {
          error = signal.aborted ? signal.reason : cause
          try { await archive?.dispose() } catch (cleanupError) { error ??= cleanupError }
        } finally {
          file.stream.off('limit', onLimit)
          done()
        }
        if (error) {
          file.stream.resume()
          const e = error as NodeJS.ErrnoException
          callback(e.code === 'ENOSPC' ? Object.assign(new Error('备份临时目录空间不足'), { status: 507 }) : error)
        } else {
          callback(null, { path: archive!.path, size })
        }
      })()
    },
    _removeFile(req, _file, callback) {
      const archive = take(req)
      if (!archive) { callback(null); return }
      void archive.dispose().then(() => callback(null), callback)
    },
  }
  return { storage, take }
}

import type { Request } from 'express'
import type { StorageEngine } from 'multer'

type Budget = { bytes: number; error?: Error; pending: Set<(error: Error) => void> }
const exceeded = (bytes: number) => Object.assign(new Error(`Total upload exceeds the ${bytes} byte request memory budget; upload fewer files at once.`), { status: 413 })

/** Bound cumulative file bytes, independent of Content-Length and multipart chunking. */
export function boundedMemoryStorage(maxBytes = 64 * 1024 * 1024): StorageEngine {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid upload budget')
  const requests = new WeakMap<Request, Budget>()
  return {
    _handleFile(req, file, callback) {
      let budget = requests.get(req)
      if (!budget) { budget = { bytes: 0, pending: new Set() }; requests.set(req, budget) }
      const state = budget
      let chunks: Buffer[] = [], size = 0, finished = false
      const failAll = (error: Error) => {
        state.error ??= error
        for (const fail of [...state.pending]) fail(state.error)
      }
      const cleanup = () => {
        file.stream.off('data', onData)
        file.stream.off('end', onEnd)
        file.stream.off('limit', onLimit)
        req.off('aborted', onAbort)
        state.pending.delete(fail)
        chunks = []
      }
      const fail = (error: Error) => {
        if (finished) return
        finished = true
        cleanup()
        callback(error)
        // Drain rather than destroy: Multer owns request termination and cleanup.
        file.stream.resume()
      }
      const onData = (chunk: Buffer) => {
        if (finished) return
        if (state.error) return fail(state.error)
        if (chunk.length > maxBytes - state.bytes) return failAll(exceeded(maxBytes))
        state.bytes += chunk.length
        size += chunk.length
        chunks.push(chunk)
      }
      const onEnd = () => {
        if (finished) return
        finished = true
        const buffer = Buffer.concat(chunks, size)
        cleanup()
        callback(null, { buffer, size })
      }
      const onLimit = () => failAll(Object.assign(new Error('Single upload exceeds the file size limit.'), { status: 413 }))
      const onAbort = () => failAll(Object.assign(new Error('Upload was interrupted.'), { status: 400 }))
      state.pending.add(fail)
      file.stream.on('data', onData)
      file.stream.once('end', onEnd)
      file.stream.once('limit', onLimit)
      // Retain a listener after settlement so late stream errors cannot crash Node.
      file.stream.on('error', failAll)
      req.once('aborted', onAbort)
      if (state.error) fail(state.error)
    },
    _removeFile(_req, file, callback) {
      delete (file as Partial<Express.Multer.File>).buffer
      callback(null)
    },
  }
}

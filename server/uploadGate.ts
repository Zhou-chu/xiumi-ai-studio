import type { Request, Response, RequestHandler } from 'express'

const contexts = new WeakMap<Request, { controller: AbortController; pending: Set<Promise<void>> }>()
export function uploadContext(req: Request) {
  let context = contexts.get(req)
  if (!context) { context = { controller: new AbortController(), pending: new Set() }; contexts.set(req, context) }
  return context
}
export function trackUpload(req: Request): () => void {
  const context = uploadContext(req)
  let resolve!: () => void
  const task = new Promise<void>(done => { resolve = done })
  context.pending.add(task)
  return () => { context.pending.delete(task); resolve() }
}
const failure = (status: number, message: string) => Object.assign(new Error(message), { status })

/** Admission spans upload AND non-cancellable downstream processing, even after client disconnect. */
export function createUploadGate({ concurrency = 2, timeoutMs = 120000 }: { concurrency?: number; timeoutMs?: number } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('Invalid upload gate budget')
  let active = 0
  return (parser: RequestHandler, handle: (req: Request, res: Response) => Promise<void>): RequestHandler => (req, res, next) => {
    if (active >= concurrency) { res.setHeader('Retry-After', '1'); req.resume(); next(failure(429, 'Two uploads are already being processed. Retry shortly.')); return }
    active++
    const context = uploadContext(req)
    let responseOver = false, uploaded = false, processing = false, released = false, delivered = false
    const deliver = (error: unknown) => { if (!delivered && !responseOver) { delivered = true; next(error) } }
    const release = () => {
      if (released || !responseOver || !uploaded || processing || context.pending.size) return
      released = true; active--; clearTimeout(timer)
      req.off('aborted', onAbort); res.off('finish', onFinish); res.off('close', onClose)
    }
    const cancel = (error: Error) => {
      if (!context.controller.signal.aborted) context.controller.abort(error)
      if (!processing) void Promise.all([...context.pending]).then(() => { uploaded = true; deliver(error); release() })
    }
    const onAbort = () => cancel(failure(400, 'Upload was interrupted.'))
    const onFinish = () => { responseOver = true; release() }
    const onClose = () => { responseOver = true; if (!uploaded) cancel(failure(400, 'Upload connection closed.')); release() }
    const timer = setTimeout(() => cancel(failure(408, 'Upload exceeded its 120-second deadline.')), timeoutMs)
    timer.unref?.()
    req.once('aborted', onAbort); res.once('finish', onFinish); res.once('close', onClose)
    const parsed = (error?: unknown) => {
      clearTimeout(timer); uploaded = true
      if (context.controller.signal.aborted) { deliver(context.controller.signal.reason); release(); return }
      if (error) { deliver(error); release(); return }
      processing = true
      try { void handle(req, res).catch(deliver).finally(() => { processing = false; release() }) }
      catch (cause) { processing = false; deliver(cause); release() }
    }
    try { parser(req, res, parsed) } catch (cause) { parsed(cause) }
  }
}

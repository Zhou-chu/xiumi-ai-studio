import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import type { Request } from 'express'
import { beforeEach, expect, it, vi } from 'vitest'
import { boundedDiskStorage } from '../../server/uploadStorage'

const h = vi.hoisted(() => ({
  uniqueDir: vi.fn(), open: vi.fn(), read: vi.fn(), unlink: vi.fn(), rmdir: vi.fn(),
  uploadContext: vi.fn(), start: vi.fn(), done: vi.fn(), wrote: vi.fn(),
}))
vi.mock('node:fs', () => ({ default: { createWriteStream: h.open } }))
vi.mock('node:fs/promises', () => ({ mkdtemp: h.uniqueDir, readFile: h.read, unlink: h.unlink, rmdir: h.rmdir }))
vi.mock('../../server/uploadGate', () => ({ trackUpload: h.start, uploadContext: h.uploadContext }))
vi.mock('node:os', () => ({ tmpdir: () => '/virtual-temp' }))
const outputs = new Map<string, Buffer>()
const fixtureRoot = '/unit-fixture-root'
const incoming = () => new EventEmitter() as Request
const result = (storage: ReturnType<typeof boundedDiskStorage>, req: Request, stream: PassThrough, filename = 'display name.txt') => {
  const callback = vi.fn<(error?: (Error & { status?: number }) | null, info?: Partial<Express.Multer.File>) => void>()
  const finished = new Promise<void>(resolve => callback.mockImplementation(() => resolve()))
  storage._handleFile(req, { stream, originalname: filename } as unknown as Express.Multer.File, callback)
  return { callback, finished }
}
function writers(onWrite?: (chunk: Buffer) => Error | undefined) {
  return (path: string) => {
    outputs.set(path, Buffer.alloc(0))
    return new Writable({
      write(chunk: Buffer, _encoding, done) {
        const failure = onWrite?.(chunk)
        if (failure) { done(failure); return }
        const previous = outputs.get(path)
        if (!previous) { done(Error('Unexpected write target')); return }
        outputs.set(path, Buffer.concat([previous, chunk]))
        h.wrote(path, chunk)
        done()
      },
    })
  }
}
beforeEach(() => {
  const contexts = new WeakMap<Request, { controller: AbortController }>()
  const unexpected = () => { throw Error('Unconfigured virtual upload boundary') }
  for (const f of Object.values(h)) f.mockReset().mockImplementation(unexpected)
  outputs.clear()
  let id = 0
  h.uniqueDir.mockImplementation(async (prefix: string) => prefix + (++id))
  h.open.mockImplementation(writers())
  h.read.mockImplementation(async (path: string) => {
    const data = outputs.get(path)
    if (!data) throw Error('Unknown virtual upload output')
    return data
  })
  h.unlink.mockImplementation(async (path: string) => { outputs.delete(path) })
  h.rmdir.mockResolvedValue(undefined)
  h.uploadContext.mockImplementation((req: Request) => {
    if (!contexts.has(req)) contexts.set(req, { controller: new AbortController() })
    return contexts.get(req)
  })
  h.done.mockReturnValue(undefined)
  h.wrote.mockReturnValue(undefined)
  h.start.mockReturnValue(h.done)
})
it('rejects invalid budgets and removes retained buffers without performing disk actions', () => {
  for (const invalid of [0, -1, NaN, 1.2, Number.MAX_SAFE_INTEGER+1]) expect(() => boundedDiskStorage(invalid)).toThrow(RangeError)
  const file = { buffer: Buffer.from('retained') } as Express.Multer.File
  const callback = vi.fn()
  boundedDiskStorage()._removeFile(incoming(), file, callback)
  expect(callback).toHaveBeenCalledExactlyOnceWith(null)
  expect(file.buffer).toBeUndefined()
  expect(h.uniqueDir).not.toHaveBeenCalled()
  expect(h.unlink).not.toHaveBeenCalled()
})
it('opens only a private content path, reads a complete buffer and releases after cleanup', async () => {
  const storage = boundedDiskStorage(5, fixtureRoot), req = incoming(), stream = new PassThrough()
  const { callback, finished } = result(storage, req, stream)
  stream.write(Buffer.from('ab')); stream.end(Buffer.from('cde'))
  await finished
  const directory = join(fixtureRoot, 'xiumi-upload-1'), disk = join(directory, 'content')
  expect(h.uniqueDir).toHaveBeenCalledExactlyOnceWith(join(fixtureRoot,'xiumi-upload-'))
  expect(h.open).toHaveBeenCalledExactlyOnceWith(disk, { flags:'wx', mode:0o600 })
  expect(h.read).toHaveBeenCalledExactlyOnceWith(disk, { signal: expect.any(AbortSignal) })
  expect(h.unlink).toHaveBeenCalledExactlyOnceWith(disk)
  expect(h.rmdir).toHaveBeenCalledExactlyOnceWith(directory)
  expect(callback).toHaveBeenCalledExactlyOnceWith(null,{buffer:Buffer.from('abcde'),size:5})
  expect(h.rmdir.mock.invocationCallOrder[0]).toBeLessThan(h.done.mock.invocationCallOrder[0])
  expect(h.done.mock.invocationCallOrder[0]).toBeLessThan(callback.mock.invocationCallOrder[0])
  expect(outputs.size).toBe(0)
  expect(req.listenerCount('aborted')).toBe(0)
  expect(stream.listenerCount('limit')).toBe(0)
  expect(() => stream.emit('error',Error('after finish'))).not.toThrow()
  expect(callback).toHaveBeenCalledTimes(1)
})
it('rejects request-wide overflow across synthetic files and accepts a different request afterward', async () => {
  const storage = boundedDiskStorage(5), req = incoming(), first = new PassThrough(), second = new PassThrough()
  const a = result(storage,req,first), b = result(storage,req,second)
  first.write('abc')
  second.end('def')
  await Promise.all([a.finished,b.finished])
  for (const consume of [a,b]) {
    expect(consume.callback).toHaveBeenCalledTimes(1)
    expect(consume.callback.mock.calls[0][0]).toMatchObject({status:413})
    expect(consume.callback.mock.calls[0][1]).toBeUndefined()
  }
  expect(h.read).not.toHaveBeenCalled()
  expect(outputs.size).toBe(0)
  const next = new PassThrough(), ok = result(storage,incoming(),next)
  next.end('abc')
  await ok.finished
  expect(ok.callback).toHaveBeenCalledExactlyOnceWith(null,{buffer:Buffer.from('abc'),size:3})
})
it('maps no-space stream failures to a recoverable storage error and never reads partial content', async () => {
  const storage = boundedDiskStorage(10), stream = new PassThrough(), req = incoming()
  h.open.mockImplementationOnce(writers(() => Object.assign(Error('Virtual disk full'),{code:'ENOSPC'})))
  const out = result(storage,req,stream)
  stream.end('file')
  await out.finished
  expect(out.callback.mock.calls[0][0]).toMatchObject({status:507, message:'Temporary upload storage is full. Retry after freeing disk space.'})
  expect(h.read).not.toHaveBeenCalled()
  expect(h.done).toHaveBeenCalledTimes(1)
  expect(outputs.size).toBe(0)
})
it('stops before opening when an upload is aborted while its directory is being created', async () => {
  const storage = boundedDiskStorage(10), stream = new PassThrough(), req = incoming()
  let complete!: (directory: string) => void
  h.uniqueDir.mockReturnValueOnce(new Promise<string>(resolve => { complete = resolve }))
  const out = result(storage,req,stream)
  req.emit('aborted')
  complete('/unit-fixture/interrupted')
  stream.end('ignored')
  await out.finished
  expect(h.open).not.toHaveBeenCalled()
  expect(h.read).not.toHaveBeenCalled()
  expect(h.rmdir).toHaveBeenCalledExactlyOnceWith('/unit-fixture/interrupted')
  expect(out.callback.mock.calls[0][0]).toMatchObject({status:400,message:'Upload was interrupted.'})
  expect(req.listenerCount('aborted')).toBe(0)
})
it('preserves gate cancellation and avoids touching storage on an already cancelled request', async () => {
  const storage = boundedDiskStorage(10), stream = new PassThrough(), req = incoming()
  const reason = Error('Virtual gate cancelled')
  h.uploadContext(req).controller.abort(reason)
  const out = result(storage,req,stream)
  stream.end('ignored')
  await out.finished
  expect(out.callback).toHaveBeenCalledExactlyOnceWith(reason)
  expect(h.start).not.toHaveBeenCalled()
  expect(h.uniqueDir).not.toHaveBeenCalled()
})
it('honors the per-file limit and benign absent-temp cleanup before releasing tracking', async () => {
  const storage = boundedDiskStorage(10), stream = new PassThrough(), req = incoming()
  h.unlink.mockRejectedValueOnce(Object.assign(Error('Already absent'),{code:'ENOENT'}))
  const out = result(storage,req,stream)
  stream.emit('limit')
  stream.end('ignored')
  await out.finished
  expect(out.callback.mock.calls[0][0]).toMatchObject({status:413,message:'Single upload exceeds the file size limit.'})
  expect(h.read).not.toHaveBeenCalled()
  expect(h.rmdir).toHaveBeenCalledTimes(1)
  expect(h.done).toHaveBeenCalledTimes(1)
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readVerificationReadyUrl, verificationApi, verificationUpload, waitForVerification } from '../../scripts/verificationRuntime'

const origin = 'http://127.0.0.1:5390'
const denyFetch = vi.fn(() => { throw Error('Unexpected default verification fetch') })
beforeEach(() => { denyFetch.mockClear(); vi.stubGlobal('fetch', denyFetch) })
afterEach(() => {
  try { expect(denyFetch).not.toHaveBeenCalled() }
  finally { vi.useRealTimers(); vi.unstubAllGlobals() }
})

it('preserves JSON methods, exact origin/request bytes, content type and decoded result', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":"synthetic"}', { status: 201, headers: { 'content-type': 'application/json' } }))
  const data = { name: '合成测试' }
  const result = await verificationApi(origin, '/api/items', { method: 'POST', headers: { 'x-fixture': 'still-here', 'content-type': 'text/plain' }, json: data }, request)
  expect(result).toEqual({ status: 201, data: { id: 'synthetic' }, type: 'application/json' })
  expect(request).toHaveBeenCalledExactlyOnceWith(origin + '/api/items', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-fixture': 'still-here' },
    json: data, body: '{"name":"合成测试"}',
  })
})

it('keeps non-JSON responses as text and retains raw requests and error status', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('synthetic failed', { status: 422, headers: { 'content-type': 'text/plain' } }))
  const init: RequestInit = { method: 'POST', body: 'raw body' }
  expect(await verificationApi(origin, '/fixtures', init, request)).toEqual({ status: 422, data: 'synthetic failed', type: 'text/plain' })
  expect(request).toHaveBeenCalledExactlyOnceWith(origin + '/fixtures', { ...init, headers: { origin } })
  request.mockResolvedValueOnce(new Response(null, { status: 204 }))
  expect(await verificationApi(origin, '/fixtures', {}, request)).toEqual({ status: 204, data: '', type: '' })
})

it.each([['buffer', Buffer.from([4, 6, 8])], ['text', 'text fixture']] as const)('builds one real memory %s multipart part without dispatching HTTP', async (_kind, data) => {
  const send = vi.fn<typeof verificationApi>().mockResolvedValue({ status: 202, data: 'accepted', type: '' })
  const reply = await verificationUpload(origin, '/api/import', 'file', 'fixture.bin', data, 'application/octet-stream', send)
  expect(reply).toEqual({ status: 202, data: 'accepted', type: '' })
  expect(send).toHaveBeenCalledExactlyOnceWith(origin, '/api/import', { method: 'POST', body: expect.any(FormData) })
  const parts = [...(send.mock.calls[0][2]!.body as FormData)]
  expect(parts).toHaveLength(1)
  expect(parts[0][0]).toBe('file')
  const blob = parts[0][1] as File
  expect(blob.name).toBe('fixture.bin')
  expect(blob.type).toBe('application/octet-stream')
  expect(Buffer.from(await blob.arrayBuffer())).toEqual(typeof data === 'string' ? Buffer.from(data) : data)
})

it('accepts only the expected app-ready message with a local HTTP URL', () => {
  expect(readVerificationReadyUrl('日志 1\n 已启动：http://127.0.0.1:5401/\n退出说明')).toBe('http://127.0.0.1:5401')
  for (const value of ['http://127.0.0.1:5401/', '已启动：https://127.0.0.1:5401/', '已启动：http://fixture.invalid:5401/', '已启动：http://127.0.0.1:5401']) {
    expect(readVerificationReadyUrl(value)).toBeUndefined()
  }
})

it('polls at the original interval until ready and propagates the final value once', async () => {
  vi.useFakeTimers()
  const fn = vi.fn<() => string|undefined>().mockReturnValueOnce(undefined).mockReturnValueOnce(undefined).mockReturnValueOnce('ready')
  const pending = waitForVerification(fn, 1_000, '启动')
  await vi.advanceTimersByTimeAsync(199); expect(fn).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1); expect(fn).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(200); await expect(pending).resolves.toBe('ready')
  expect(fn).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves the existing bounded polling deadline and contextual diagnostic', async () => {
  vi.useFakeTimers()
  const fn = vi.fn(() => false as const)
  const pending = expect(waitForVerification(fn, 400, '合成就绪阶段')).rejects.toThrow('等待超时：合成就绪阶段')
  await vi.advanceTimersByTimeAsync(400)
  expect(fn).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(200)
  await pending
  expect(fn).toHaveBeenCalledTimes(4)
  expect(vi.getTimerCount()).toBe(0)
})

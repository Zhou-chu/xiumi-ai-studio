import { afterEach, expect, it, vi } from 'vitest'
import { createHostedReplayMultipartTransport } from '../../server/hostedReplayMultipart'
const approved = 'https://mmbiz.qpic.cn/mock/owned/0'
const raster = (body: Uint8Array<ArrayBuffer>) => Object.freeze({
  source: '/media/ras.jpg?w=96', filename: 'ras.jpg', generation: 'a'.repeat(64),
  blob: new Blob([body], { type: 'image/jpeg' }),
})
afterEach(() => vi.useRealTimers())

it('writes the exact immutable Blob bytes and MIME in one multipart media part', async () => {
  const fetch = vi.fn(async (body: FormData, signal: AbortSignal) => {
    expect(signal.aborted).toBe(false)
    const serialized = new Request('http://127.0.0.1/inert', { method: 'POST', body })
    expect(serialized.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
    const form = await serialized.formData()
    expect([...form.keys()]).toEqual(['media'])
    const media = form.get('media')
    expect(media).toMatchObject({ name: 'ras.jpg', type: 'image/jpeg' })
    if (!(media instanceof Blob)) throw new Error('missing synthetic media part')
    expect([...new Uint8Array(await media.arrayBuffer())]).toEqual([255, 216, 1, 2, 255, 217])
    return { url: approved }
  })
  const send = createHostedReplayMultipartTransport(fetch)
  expect(await send(raster(Uint8Array.of(255, 216, 1, 2, 255, 217)))).toBe(approved)
  expect(fetch).toHaveBeenCalledOnce()
})

it('aborts and reports a timeout instead of waiting on an uncooperative exchange or retrying', async () => {
  vi.useFakeTimers()
  const exchange = vi.fn((_body: FormData, _signal: AbortSignal) => new Promise<never>(() => {}))
  const send = createHostedReplayMultipartTransport(exchange, { timeoutMs: 25 })
  const pending = expect(send(raster(Uint8Array.of(1)))).rejects.toThrow(/超时/)
  await vi.advanceTimersByTimeAsync(25)
  await pending
  expect(exchange).toHaveBeenCalledOnce()
  expect(exchange.mock.calls[0][1].aborted).toBe(true)
})

it('rejects unapproved or malformed response destinations without retry', async () => {
  const exchange = vi.fn().mockResolvedValueOnce({ url: 'https://foreign.invalid/unsafe' }).mockRejectedValueOnce(new Error('synthetic exchange error'))
  const send = createHostedReplayMultipartTransport(exchange)
  const input = raster(Uint8Array.of(1))
  await expect(send(input)).rejects.toThrow(/图床地址/)
  await expect(send(input)).rejects.toThrow(/synthetic exchange error/)
  expect(exchange).toHaveBeenCalledTimes(2)
})

it.each([
  { filename: '/outside/fixture.jpg', blob: new Blob(['abc'], { type: 'image/jpeg' }) },
  { filename: 'wrong.png', blob: new Blob(['abc'], { type: 'image/jpeg' }) },
  { filename: 'empty.png', blob: new Blob([], { type: 'image/png' }) },
  { filename: 'huge.png', blob: new Blob([new Uint8Array(1_000_001)], { type: 'image/png' }) },
])('rejects invalid media without invoking exchange', async candidate => {
  const exchange = vi.fn()
  await expect(createHostedReplayMultipartTransport(exchange)(candidate)).rejects.toThrow(/MIME/)
  expect(exchange).not.toHaveBeenCalled()
})

it('checks response shape and accepts a transparent PNG payload without conversion away from PNG', async () => {
  const exchange = vi.fn(async (body: FormData) => {
    const media = body.get('media')
    expect(media).toMatchObject({ name: 'ras.png', type: 'image/png' })
    return { url: 'https://mmbiz.qlogo.cn/mock/transparent' }
  }).mockResolvedValueOnce(null as never)
  const send = createHostedReplayMultipartTransport(exchange)
  const candidate = { filename: 'ras.png', blob: new Blob(['fixture'], { type: 'image/png' }) }
  await expect(send(candidate)).rejects.toThrow(/图床地址/)
  await expect(send(candidate)).resolves.toMatch(/qlogo/)
  expect(() => createHostedReplayMultipartTransport(exchange, { timeoutMs: 10_001 })).toThrow(RangeError)
})

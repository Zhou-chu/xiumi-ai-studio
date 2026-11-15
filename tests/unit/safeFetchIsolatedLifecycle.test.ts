import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { safeFetch } from '../../server/net'

const doubles = vi.hoisted(() => ({
  agents: [] as { options: unknown; destroy: ReturnType<typeof vi.fn> }[],
  transport: vi.fn(),
  dns: vi.fn(),
}))
vi.mock('node:dns/promises', () => ({ lookup: doubles.dns }))
vi.mock('undici', () => ({
  Agent: class {
    destroy = vi.fn(async () => undefined)
    constructor(options: unknown) { doubles.agents.push({ options, destroy: this.destroy }) }
  },
  fetch: doubles.transport,
}))
const publicDns = async (_host: string) => [{ address: '8.8.8.8' }]
beforeEach(() => {
  doubles.agents.length = 0
  doubles.transport.mockReset().mockImplementation(() => { throw Error('Unexpected default transport') })
  doubles.dns.mockReset().mockImplementation(() => { throw Error('Unexpected default DNS') })
})
afterEach(() => { vi.useRealTimers() })

it('handles a normal redirect with new resolution and closes each dispatcher once', async () => {
  const resolve = vi.fn(publicDns)
  const redirectCancel = vi.fn()
  const first = new Response(new ReadableStream({ cancel: redirectCancel }), {
    status: 302, headers: { location: 'https://next.example.test/path' },
  })
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(first)
    .mockResolvedValueOnce(new Response(null, { status: 204, headers: { 'content-type': 'text/plain' } }))
  const response = await safeFetch('https://origin.example.test/', { resolve, fetcher })
  expect(resolve.mock.calls).toEqual([['origin.example.test'], ['next.example.test']])
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['https://origin.example.test/', 'https://next.example.test/path'])
  expect(fetcher.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true)
  expect(redirectCancel).toHaveBeenCalledOnce()
  expect(doubles.agents).toHaveLength(2)
  for (const agent of doubles.agents) expect(agent.destroy).toHaveBeenCalledOnce()
  expect(response.status).toBe(204)
  expect(response.body).toBeNull()
  expect(response.headers.get('content-type')).toBe('text/plain')
})

it('keeps the DNS deadline even when the isolated resolver rejects after cleanup', async () => {
  vi.useFakeTimers()
  let reject!: (error: Error) => void
  const dns = new Promise<{ address: string }[]>((_resolve, no) => { reject = no })
  const result = expect(safeFetch('https://origin.example.test/', { resolve: () => dns, timeoutMs: 20 })).rejects.toMatchObject({ status: 504 })
  await vi.advanceTimersByTimeAsync(20)
  await result
  reject(Error('late resolver error'))
  await vi.advanceTimersByTimeAsync(0)
  expect(doubles.transport).not.toHaveBeenCalled()
  expect(doubles.agents).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('aborts a pending isolated transport, releases its dispatcher, and leaves no deadlines', async () => {
  vi.useFakeTimers()
  const onAbort = vi.fn()
  const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { onAbort(); reject(init.signal?.reason) }, { once: true })
  }))
  const result = expect(safeFetch('https://origin.example.test/', { resolve: publicDns, fetcher, timeoutMs: 20 })).rejects.toMatchObject({ status: 504 })
  await vi.advanceTimersByTimeAsync(20)
  await result
  expect(fetcher).toHaveBeenCalledOnce()
  expect(onAbort).toHaveBeenCalledOnce()
  expect(doubles.agents).toHaveLength(1)
  expect(doubles.agents[0].destroy).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('wraps a resolver rejection without exposing internal details or opening a dispatcher', async () => {
  const failure = Error('synthetic resolver details')
  await expect(safeFetch('https://origin.example.test/', { resolve: async () => { throw failure } }))
    .rejects.toMatchObject({ status: 502, message: '无法解析该域名' })
  expect(doubles.agents).toHaveLength(0)
  expect(doubles.transport).not.toHaveBeenCalled()
})

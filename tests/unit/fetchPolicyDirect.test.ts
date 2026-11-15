import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const network = vi.hoisted(() => ({ agent: vi.fn(function () { return { destroy: async () => {} } }), fetch: vi.fn(() => { throw Error('Unexpected transport fetch') }), lookup: vi.fn(() => { throw Error('Unexpected DNS lookup') }) }))
vi.mock('undici', () => ({ Agent: network.agent, fetch: network.fetch }))
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }))
import { safeFetch } from '../../server/net'
const publicDns = async () => [{ address: '93.184.216.34' }]
beforeEach(() => { for (const stub of Object.values(network)) stub.mockClear() })
afterEach(() => { try { expect(network.fetch).not.toHaveBeenCalled(); expect(network.lookup).not.toHaveBeenCalled() } finally { vi.restoreAllMocks() } })
describe('safeFetch injected policy boundaries',()=>{
it('shares one deadline across delayed redirects', async () => {
    const signals = new Set<AbortSignal>()
    const fetcher = (async (_url: URL, init: RequestInit) => {
      signals.add(init.signal!)
      await new Promise((done) => setTimeout(done, 40))
      return new Response(null, { status: 302, headers: { location: '/next' } })
    }) as unknown as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, timeoutMs: 100, maxRedirects: 10 })).rejects.toMatchObject({ status: 504, message: expect.stringContaining('超时') })
    expect(signals.size).toBe(1)
  })

it('applies the deadline while DNS resolution is stalled', async () => {
    await expect(safeFetch('https://example.com/', { resolve: () => new Promise(() => {}), timeoutMs: 30 })).rejects.toThrow()
  }, 1000)

it('rejects an oversized stream and cancels it before reading the tail', async () => {
    let pulled = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled++; controller.enqueue(new Uint8Array(4)) },
      cancel() { cancelled = true },
    }, { highWaterMark: 0 })
    const fetcher = (async () => new Response(body)) as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, maxBytes: 5 })).rejects.toThrow('大小')
    expect(pulled).toBe(2)
    expect(cancelled).toBe(true)
  })

it('rejects an oversized Content-Length without reading any body', async () => {
    let pulled = false
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled = true; controller.enqueue(new Uint8Array(1)) },
      cancel() { cancelled = true },
    }, { highWaterMark: 0 })
    const fetcher = (async () => new Response(body, { headers: { 'content-length': '1000' } })) as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, maxBytes: 5 })).rejects.toThrow('大小')
    expect(pulled).toBe(false)
    expect(cancelled).toBe(true)
  })

it('allows an exact byte limit and preserves status and content type', async () => {
    const fetcher = (async () => new Response('你好', { status: 201, headers: { 'content-type': 'text/plain' } })) as typeof fetch
    const response = await safeFetch('https://example.com/', { resolve: publicDns, fetcher, maxBytes: 6 })
    expect(await response.text()).toBe('你好')
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('text/plain')
  })

it('cancels redirect bodies rather than buffering them', async () => {
    let cancelled = false
    const redirect = new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 302, headers: { location: '/next' } })
    const fetcher = vi.fn().mockResolvedValueOnce(redirect).mockResolvedValueOnce(new Response('ok'))
    expect(await (await safeFetch('https://example.com/', { resolve: publicDns, fetcher })).text()).toBe('ok')
    expect(cancelled).toBe(true)
  })

it('stops waiting for a stalled response body at the deadline', async () => {
    let cancelled = false
    const fetcher = (async () => new Response(new ReadableStream({ cancel() { cancelled = true } }))) as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, timeoutMs: 30, bodyTimeoutMs: 30 })).rejects.toMatchObject({ status: 504 })
    expect(cancelled).toBe(true)
  }, 1000)
})

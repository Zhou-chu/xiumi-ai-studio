import net from 'node:net'
import tls from 'node:tls'
import { gzipSync } from 'node:zlib'
import { MockAgent, fetch as transportFetch } from 'undici'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeFetch } from '../../server/net'

const publicDns = async () => [{ address: '93.184.216.34' }]
afterEach(() => vi.restoreAllMocks())

describe('red team: fetch transport boundaries',()=>{
it('pins the validated DNS answer to the actual socket lookup', async () => {
    // Stop only the external TCP connection. Exercise safeFetch and its real dispatcher.
    let connection: { host?: string; lookup?: (host: string, options: { all: boolean }, cb: (...args: unknown[]) => void) => void } | undefined
    vi.spyOn(net, 'connect').mockImplementation(((options: typeof connection) => {
      connection = options
      const socket = new net.Socket()
      queueMicrotask(() => socket.destroy(new Error('test transport stopped')))
      return socket
    }) as typeof net.connect)
    const resolve = vi.fn().mockResolvedValueOnce([{ address: '93.184.216.34' }]).mockResolvedValue([{ address: '127.0.0.1' }])
    await expect(safeFetch('http://rebind.example/path', { resolve })).rejects.toThrow()
    expect(connection?.host).toBe('rebind.example')
    expect(connection?.lookup).toBeTypeOf('function')
    const addresses = await new Promise((done) => connection!.lookup!('rebind.example', { all: true }, (_error, result) => done(result)))
    expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }])
    expect(resolve).toHaveBeenCalledTimes(1)
  })

it('retains the HTTPS hostname and SNI while pinning the socket address', async () => {
    let connection: { host?: string; servername?: string; rejectUnauthorized?: boolean; lookup?: unknown } | undefined
    vi.spyOn(tls, 'connect').mockImplementation(((options: typeof connection) => {
      connection = options
      const socket = new net.Socket()
      queueMicrotask(() => socket.destroy(new Error('test TLS transport stopped')))
      return socket
    }) as typeof tls.connect)
    await expect(safeFetch('https://secure.example/path', { resolve: publicDns })).rejects.toThrow()
    expect(connection?.host).toBe('secure.example')
    expect(connection?.servername).toBe('secure.example')
    expect(connection?.rejectUnauthorized).not.toBe(false)
    expect(connection?.lookup).toBeTypeOf('function')
  })

it('limits decompressed bytes, not only the small compressed payload', async () => {
    const dispatcher = new MockAgent()
    dispatcher.disableNetConnect()
    const compressed = gzipSync(Buffer.alloc(100_000, 'a'))
    expect(compressed.byteLength).toBeLessThan(1000)
    dispatcher.get('https://example.com').intercept({ path: '/' }).reply(200, compressed, {
      headers: { 'content-encoding': 'gzip', 'content-length': String(compressed.byteLength) },
    })
    const fetcher = ((url: URL, init: RequestInit) => transportFetch(url, { signal: init.signal, redirect: init.redirect, dispatcher })) as unknown as typeof fetch
    try {
      await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher, maxBytes: 1000 })).rejects.toThrow('大小')
    } finally { await dispatcher.close() }
  })
})

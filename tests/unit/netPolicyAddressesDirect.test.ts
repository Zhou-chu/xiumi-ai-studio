import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assertPublicUrl, isPrivateAddress, safeFetch } from '../../server/net'

const h = vi.hoisted(() => { const deny = vi.fn(() => { throw Error('Unexpected real network operation') }); return { deny, agent: vi.fn(function () { return { destroy: async () => {} } }) } })

vi.mock('undici', () => ({ Agent: h.agent, fetch: h.deny }))

vi.mock('node:dns/promises', () => ({ lookup: h.deny }))

beforeEach(() => { h.deny.mockClear(); vi.stubGlobal('fetch', h.deny) })

afterEach(() => { try { expect(h.deny).not.toHaveBeenCalled() } finally { vi.unstubAllGlobals() } })

const publicDns = async () => [{ address: '93.184.216.34' }]

describe('red team: alternate IP representations', () => {
  it.each([
    'http://[::ffff:127.0.0.1]/',
    'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://[::ffff:10.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:198.18.0.5]/',
  ])('rejects mapped private or literal proxy target %s', async (url) => {
    await expect(assertPublicUrl(new URL(url), publicDns)).rejects.toThrow('内网')
  })

  it('rejects mapped private addresses returned by DNS', async () => {
    await expect(assertPublicUrl(new URL('https://example.com/'), async () => [{ address: '::ffff:a00:1' }])).rejects.toThrow('内网')
  })

  it('does not send a redirected request to mapped loopback', async () => {
    const seen: string[] = []
    const fetcher = (async (url: URL) => {
      seen.push(String(url))
      return new Response(null, { status: 302, headers: { location: 'http://[::ffff:127.0.0.1]/' } })
    }) as unknown as typeof fetch
    await expect(safeFetch('https://example.com/', { resolve: publicDns, fetcher })).rejects.toThrow('内网')
    expect(seen).toEqual(['https://example.com/'])
  })

  it('rejects scoped link-local DNS addresses without a URL parsing error', () => {
    expect(isPrivateAddress('fe80::1%eth0')).toBe(true)
  })

  it.each(['198.19.0.5', '::ffff:c613:5'])('preserves fake-IP proxy DNS compatibility for %s', async (address) => {
    await expect(assertPublicUrl(new URL('https://example.com/'), async () => [{ address }])).resolves.toBeUndefined()
    await expect(assertPublicUrl(new URL(address.includes(':') ? `http://[${address}]/` : `http://${address}/`))).rejects.toThrow('内网')
  })

  it('continues allowing public mapped IPv4 addresses', async () => {
    await expect(assertPublicUrl(new URL('https://[::ffff:8.8.8.8]/'), publicDns)).resolves.toBeUndefined()
  })
})

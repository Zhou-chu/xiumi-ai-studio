import { describe, it, expect, vi } from 'vitest'
import { importArticleImages } from '../../server/articleImages'
const asset = { id: 'a', file: 'a.png', name: 'photo', width: 1, height: 1, size: 4, createdAt: 1 }
const url = 'https://mmbiz.qpic.cn/a'
function deps(existing: object[] = []) {
  const list = vi.fn(async () => existing)
  const save = vi.fn(async (_buf: Buffer, _name: string, sourceUrl?: string) => ({ ...asset, sourceUrl }))
  const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
  return { list, save, fetch } as any
}
describe('safe article image import', () => {
  it('imports allowed originals and deduplicates the request', async () => {
    const d = deps()
    expect(await importArticleImages([url, url], d)).toMatchObject([{ url, status: 'imported', asset: { sourceUrl: url } }])
    expect(d.fetch).toHaveBeenCalledTimes(1)
  })
  it('reports already present source and local assets without downloading again', async () => {
    const d = deps([{ ...asset, sourceUrl: url }])
    expect(await importArticleImages([url, '/media/a.png?w=200'], d)).toMatchObject([{ status: 'existing' }, { status: 'existing' }])
    expect(d.fetch).not.toHaveBeenCalled()
  })
  it('does not fetch arbitrary hosts, local files, credentials, or missing local media', async () => {
    const d = deps()
    const result = await importArticleImages(['https://evil.example/a', 'file:///etc/passwd', 'https://user:pass@mmbiz.qpic.cn/a', '/media/gone.png'], d)
    expect(result).toHaveLength(4)
    expect(result.every(r => r.status === 'failed')).toBe(true)
    expect(d.fetch).not.toHaveBeenCalled()
  })
  it('keeps per-image failure instead of claiming success for an empty map', async () => {
    const d = deps()
    d.fetch.mockResolvedValueOnce(new Response('denied', { status: 403 }))
    expect(await importArticleImages([url], d)).toMatchObject([{ status: 'failed', error: expect.stringContaining('403') }])
  })
  it('rejects oversized/non-array payloads, rather than silently truncating', async () => {
    await expect(importArticleImages(Array(81).fill(url), deps())).rejects.toThrow()
    await expect(importArticleImages('anything', deps())).rejects.toThrow()
  })
})

it('serializes concurrent repeated imports using persisted source identity', async () => {
  const stored: any[] = []
  const d = deps(stored)
  d.save.mockImplementation(async (_buf: Buffer, _name: string, sourceUrl: string) => {
    const saved = { ...asset, sourceUrl }; stored.push(saved); return saved
  })
  const results = await Promise.all([importArticleImages([url], d), importArticleImages([url], d)])
  expect(results.flat().map(r => r.status)).toEqual(['imported', 'existing'])
  expect(d.fetch).toHaveBeenCalledTimes(1)
  expect(d.save).toHaveBeenCalledTimes(1)
})

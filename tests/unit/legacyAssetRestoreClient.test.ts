import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, assetMediaSrc, type Asset } from '../../src/editor/api'

const token = '7'.repeat(64)
const plan = { projects: { add: ['project'], skip: [], unsupported: [] }, unsupported: [] }
const result = { projects: { restored: ['project'], skipped: [], failed: [], unsupported: [] }, unsupported: [] }
const planAssets = { add: ['image'], skip: [], alreadyPresent: [] }
const resultAssets = { restored: ['image'], skipped: [], failed: [], alreadyPresent: [] }
const plannedHistory = { add: ['project/version'], skip: [] }
const appliedHistory = { restored: ['project/version'], skipped: [], failed: [] }
const archive = new File(['synthetic fixture'], 'test.zip')
const fetchReply = (body: unknown) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body)))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
afterEach(() => vi.unstubAllGlobals())

describe('restore client preview and confirm contract', () => {
  it('explicitly opts in, decodes independent asset and history plans, and submits the same token', async () => {
    const preview = fetchReply({ token, plan: { ...plan, assets: planAssets, versions: plannedHistory } })
    await expect(api.previewLegacyRestore(archive, undefined, true))
      .resolves.toEqual({ token, plan: { ...plan, assets: planAssets, versions: plannedHistory } })
    expect(preview.mock.calls[0]).toMatchObject(['/api/data/restore?indexedImages=1', expect.objectContaining({ body: expect.any(FormData) })])
    const apply = fetchReply({ ...result, assets: resultAssets, versions: appliedHistory })
    await expect(api.applyLegacyRestore(token)).resolves.toEqual({ ...result, assets: resultAssets, versions: appliedHistory })
    expect(apply.mock.calls[0]).toMatchObject([`/api/data/restore/${token}/apply`, expect.objectContaining({ body: '{"confirm":true}' })])
  })

  it.each([
    null,
    { add: 0 },
    { add: [], skip: false },
    { add: [], skip: [], alreadyPresent: [9] },
  ])('does not silently discard malformed optional asset preview %o', async assets => {
    fetchReply({ token, plan: { ...plan, assets } })
    await expect(api.previewLegacyRestore(archive, undefined, true)).rejects.toThrow('无法读取素材恢复预览')
  })

  it.each([
    null,
    { restored: false },
    { restored: [], skipped: null },
    { restored: [], skipped: [], failed: {} },
    { restored: [], skipped: [], failed: [], alreadyPresent: [9] },
  ])('does not silently discard malformed optional asset result %o', async assets => {
    fetchReply({ ...result, assets })
    await expect(api.applyLegacyRestore(token)).rejects.toThrow('无法读取素材恢复结果')
  })

  it('keeps only valid cache generations in new asset refs', () => {
    const asset: Asset = { id: 'image', file: 'image.png', name: '', width: 1, height: 1, size: 1, createdAt: 1 }
    expect(assetMediaSrc(asset)).toBe('/media/image.png')
    expect(assetMediaSrc({ ...asset, generation: 'invalid' })).toBe('/media/image.png')
    expect(assetMediaSrc({ ...asset, generation: token })).toBe('/media/image.png?gen=' + token)
  })
})

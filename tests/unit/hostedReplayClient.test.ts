import { afterEach, expect, it, vi } from 'vitest'
import { stageHostedReplayUpload } from '../../src/editor/hostedReplayClient'
const token = 'a'.repeat(64)
const source = '/media/fixture.jpg?w=1500'
const root = '/api/replay/hosted-xiumi'
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
afterEach(() => vi.unstubAllGlobals())

it('does not send until transfer is requested, and cancels only its one-shot local plan', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ token, images: 1, expiresAt: 20_000 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const staged = await stageHostedReplayUpload([source])
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenLastCalledWith(root + '/prepare', expect.objectContaining({
    method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', body: JSON.stringify({ sources: [source] }),
  }))
  await staged.cancel()
  expect(fetch).toHaveBeenLastCalledWith(root + '/cancel', expect.objectContaining({ body: JSON.stringify({ token }) }))
  await expect(staged.transfer()).rejects.toThrow(/已使用/)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('preserves an explicit partial-transfer error and marks missing replies potentially irreversible', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ token, images: 1, expiresAt: 20_000 }))
    .mockResolvedValueOnce(json({ error: '已确认上传 0 项；图片无法撤回。' }, 502))
    .mockResolvedValueOnce(json({ token, images: 1, expiresAt: 20_000 }))
    .mockRejectedValueOnce(new Error('network failed'))
  vi.stubGlobal('fetch', fetch)
  await expect((await stageHostedReplayUpload([source])).transfer()).rejects.toThrow(/已确认上传 0 项/)
  expect(fetch).toHaveBeenLastCalledWith(root + '/transfer', expect.objectContaining({ body: JSON.stringify({ token, confirm: true }) }))
  await expect((await stageHostedReplayUpload([source])).transfer()).rejects.toThrow(/可能已上传，无法撤回/)
})

it.each([
  { token: 1, images: 2 },
  { token: 'x'.repeat(64), images: 2 },
  { token, images: 1.5 },
  { token, images: 0 },
  { token, images: 33 },
])('rejects an unsafe or inconsistent stage response without additional requests', async response => {
  const fetch = vi.fn().mockResolvedValueOnce(json(response))
  vi.stubGlobal('fetch', fetch)
  await expect(stageHostedReplayUpload([source])).rejects.toThrow(/有效的回放计划/)
  expect(fetch).toHaveBeenCalledOnce()
})

it('reports unstructured prepare errors without attempting publication', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('not json', { status: 403 }))
  vi.stubGlobal('fetch', fetch)
  await expect(stageHostedReplayUpload([source])).rejects.toThrow(/未收到有效的回放回复/)
  expect(fetch).toHaveBeenCalledOnce()
})

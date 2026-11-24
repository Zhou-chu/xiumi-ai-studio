import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, it, type Mock, vi } from 'vitest'
const fakeCdn = 'https://mmbiz.qpic.cn/mock/photo/0'
let directory: string
let server: Server
let base: string
type Sender = Parameters<typeof import('../../server/hostedReplayConsent').createHostedReplayConsentRouter>[0]
let send: Mock<Sender>
let clock: number
let sources: string[]
const root = '/api/replay/hosted-xiumi'
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'replay-consent-'))
  vi.stubEnv('DATA_DIR', directory)
  vi.resetModules()
  const { createHostedReplayConsentRouter } = await import('../../server/hostedReplayConsent')
  const { saveAsset } = await import('../../server/assets')
  sources = []
  for (const background of ['red', 'blue']) {
    const bytes = await sharp({ create: { width: 128, height: 100, channels: 3, background } }).jpeg().toBuffer()
    const a = await saveAsset(bytes, 'fixture.jpg')
    sources.push('/media/' + a.file + '?w=64')
  }
  send = vi.fn<Sender>().mockResolvedValue(fakeCdn)
  clock = 1000
  const app = express()
  app.use(root, createHostedReplayConsentRouter(send, { now: () => clock, ttlMs: 500 }))
  server = createServer(app).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected loopback port')
  base = 'http://127.0.0.1:' + address.port
})
afterEach(async () => {
  server?.closeAllConnections()
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})
const post = (path: string, payload: unknown, headers: Record<string, string> = {}) => fetch(base + root + path, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin', ...headers },
  body: JSON.stringify(payload),
})
async function prepare() {
  const response = await post('/prepare', { sources })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const cookie = response.headers.get('set-cookie')!
  expect(cookie).toMatch(/HttpOnly; SameSite=Strict/)
  return { token: (await response.json()).token, cookie: cookie.split(';', 1)[0] }
}

it('prepares without transferring; requires same-origin owner and actual confirmation; consumes the plan once', async () => {
  const p = await prepare()
  expect(send).not.toHaveBeenCalled()
  expect((await post('/transfer', { token: p.token, confirm: true })).status).toBe(404)
  expect((await post('/transfer', { token: p.token, confirm: true }, { cookie: p.cookie, origin: 'https://outside.invalid' })).status).toBe(403)
  expect((await post('/transfer', { token: p.token, confirm: true }, { cookie: p.cookie, 'sec-fetch-site': 'same-site' })).status).toBe(403)
  expect((await post('/transfer', { token: p.token, confirm: false }, { cookie: p.cookie })).status).toBe(400)
  expect((await post('/transfer', { token: p.token, confirm: true, destination: 'https://outside.invalid' }, { cookie: p.cookie })).status).toBe(400)
  expect(send).not.toHaveBeenCalled()
  const result = await post('/transfer', { token: p.token, confirm: true }, { cookie: p.cookie })
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual({ mapping: Object.fromEntries(sources.map(source => [source, fakeCdn])) })
  expect(send).toHaveBeenCalledTimes(2)
  expect((await post('/transfer', { token: p.token, confirm: true }, { cookie: p.cookie })).status).toBe(404)
  expect(send).toHaveBeenCalledTimes(2)
})

it('expires, rejects unowned cancellation, and lets cancellation burn before any transfer', async () => {
  const p = await prepare()
  expect((await post('/prepare', { sources })).status).toBe(429)
  expect((await post('/cancel', { token: p.token })).status).toBe(404)
  expect((await post('/cancel', { token: p.token }, { cookie: p.cookie })).status).toBe(204)
  expect((await post('/transfer', { token: p.token, confirm: true }, { cookie: p.cookie })).status).toBe(404)
  const after = await prepare()
  clock += 501
  expect((await post('/transfer', { token: after.token, confirm: true }, { cookie: after.cookie })).status).toBe(404)
  expect(send).not.toHaveBeenCalled()
})

it('rejects late invalid prep with zero side effects and surfaces partial irreversible transport failure', async () => {
  expect((await post('/prepare', { sources: [sources[0], '/media/unindexed.jpg'] })).status).toBe(400)
  expect(send).not.toHaveBeenCalled()
  const p = await prepare()
  send.mockResolvedValueOnce(fakeCdn).mockRejectedValueOnce(new Error('sensitive carrier diagnostic'))
  const result = await post('/transfer', { token: p.token, confirm: true }, { cookie: p.cookie })
  expect(result.status).toBe(502)
  const message = await result.json()
  expect(message).toEqual({ error: expect.stringContaining('无法撤回'), confirmedImages: 1, attemptedImages: 2, sideEffectsUnknown: true })
  expect(JSON.stringify(message)).not.toContain('sensitive carrier diagnostic')
  expect((await post('/transfer', { token: p.token, confirm: true }, { cookie: p.cookie })).status).toBe(404)
})

it('rejects query, body pollution, missing secure metadata, and oversized messages at the mounted boundary', async () => {
  expect((await post('/prepare?path=a', { sources })).status).toBe(400)
  expect((await post('/prepare', { sources, path: '/owner/private' })).status).toBe(400)
  expect((await post('/prepare', { sources: [sources[0], 123] })).status).toBe(400)
  expect((await post('/prepare', { sources }, { origin: '' })).status).toBe(403)
  expect((await post('/prepare', { sources }, { 'sec-fetch-site': '' })).status).toBe(403)
  expect((await post('/prepare', { sources: ['a'.repeat(10_000)] })).status).toBe(413)
  expect(send).not.toHaveBeenCalled()
})

it('connects real loopback prep and confirmed inert transfer to the staged client download boundary', async () => {
  const { defaultReplay, makeItem, makeScene } = await import('../../src/core/replay/schema')
  const { prepareHostedReplayXiumi } = await import('../../src/editor/wechatOutput')
  const { listAssets } = await import('../../server/assets')
  const assets = await listAssets()
  const replay = defaultReplay()
  const image = { src: '/media/' + assets[0].file, assetId: assets[0].id }
  replay.scenes = [makeScene([makeItem('title', { content: 'Mounted staged replay' }), makeItem('image', { image })])]
  const doc = { id: 'staged', title: 'Staged', author: '', digest: '', themeId: 'tsinghua-purple' as const, createdAt: 1, updatedAt: 1,
    blocks: [{ id: 'replay', type: 'replay' as const, props: replay }] }
  const download = vi.fn()
  const stage = async (requested: readonly string[]) => {
    const p = await post('/prepare', { sources: requested })
    expect(p.ok).toBe(true)
    const { token, images } = await p.json()
    const cookie = p.headers.get('set-cookie')!.split(';', 1)[0]
    return { images, cancel: async () => { expect((await post('/cancel', { token }, { cookie })).status).toBe(204) },
      transfer: async () => {
        const result = await post('/transfer', { token, confirm: true }, { cookie })
        expect(result.ok).toBe(true)
        return (await result.json()).mapping
      } }
  }
  const hooks = {
    stage, confirmUpload: vi.fn(() => false), confirmDownload: vi.fn(() => false), download,
  }
  expect(await prepareHostedReplayXiumi(doc, assets).run(hooks)).toBe('cancelled-before-upload')
  expect(send).not.toHaveBeenCalled()
  hooks.confirmUpload.mockReturnValue(true)
  expect(await prepareHostedReplayXiumi(doc, assets).run(hooks)).toBe('cancelled-after-upload')
  expect(hooks.confirmDownload).toHaveBeenCalledWith({ plannedParts: 1, actualParts: 1, uploadedImages: 1 })
  expect(download).not.toHaveBeenCalled()
  expect(send).toHaveBeenCalledOnce()
  hooks.confirmDownload.mockReturnValue(true)
  expect(await prepareHostedReplayXiumi(doc, assets).run(hooks)).toBe('downloaded')
  expect(await download.mock.calls[0][0].blob.text()).toContain('<image href="' + fakeCdn)
})

it('advertises and mounts the bridge only with an explicit sender, restricted to the owned browser', async () => {
  vi.stubEnv('WECHAT_APPID', '')
  vi.stubEnv('WECHAT_APPSECRET', '')
  const { createApp } = await import('../../server/app')
  for (const enabled of [false, true]) {
    const app = createApp(enabled ? { ownedReplayTransport: send } : undefined)
    const listener = createServer(app).listen(0, '127.0.0.1')
    try {
      await once(listener, 'listening')
      const address = listener.address()
      if (!address || typeof address === 'string') throw new Error('expected owner loopback port')
      const origin = 'http://127.0.0.1:' + address.port
      const status = origin + '/api/wechat/status'
      expect(await (await fetch(status)).json()).toEqual({ configured: false, appid: '' })
      expect(await (await fetch(status, { headers: { 'sec-fetch-site': 'same-origin' } })).json()).toEqual({
        configured: false, appid: '', ...(enabled ? { ownedReplay: true } : {}),
      })
      const staged = await fetch(origin + root + '/prepare', {
        method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin }, body: JSON.stringify({ sources }),
      })
      expect(staged.status).toBe(enabled ? 200 : 404)
      if (enabled) {
        const { token } = await staged.json()
        const cookie = staged.headers.get('set-cookie')!.split(';', 1)[0]
        const cancelled = await fetch(origin + root + '/cancel', {
          method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin, cookie }, body: JSON.stringify({ token }),
        })
        expect(cancelled.status).toBe(204)
      }
      expect(send).not.toHaveBeenCalled()
    } finally {
      listener.closeAllConnections()
      await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
    }
  }
})

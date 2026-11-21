import { once } from 'node:events'
import { request } from 'node:http'
import { resolve } from 'node:path'
import express from 'express'
import { expect, it, vi } from 'vitest'
import { mountDesktopDataRoutes } from '../../server/desktopRoutes'

it('exposes only the owned data folder on the actual loopback listener', async () => {
  const app = express()
  app.use(express.json())
  const folder = resolve('owned-xiumi-temp')
  const openFolder = vi.fn(async (_folder: string) => {})
  const listener = app.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const bound = listener.address()
  if (!bound || typeof bound === 'string') throw new Error('Expected loopback socket')
  const origin = `http://127.0.0.1:${bound.port}`
  mountDesktopDataRoutes(app, () => ({ origin, dataDir: folder, openFolder }))
  const call = (method: string, path: string, headers: Record<string, string>, body?: string) =>
    new Promise<{ status: number | undefined; body: string; cache?: string }>((ok, fail) => {
      const req = request(origin + path, { method, headers }, (res) => {
        const parts: Buffer[] = []
        res.on('data', chunk => parts.push(chunk))
        res.on('error', fail)
        res.on('end', () => ok({
          status: res.statusCode, body: Buffer.concat(parts).toString('utf8'), cache: res.headers['cache-control'],
        }))
      })
      req.on('error', fail)
      req.end(body)
    })
  const local = { 'sec-fetch-site': 'same-origin' }
  const post = { ...local, origin, 'content-type': 'application/json' }
  try {
    const info = await call('GET', '/api/app/info', local)
    expect(info.status).toBe(200)
    expect(info.cache).toBe('no-store')
    expect(JSON.parse(info.body)).toEqual({ dataDir: folder, logDir: null, canOpenFolder: true })
    expect((await call('POST', '/api/app/open', post, '{"target":"logs"}')).status).toBe(404)
    expect((await call('POST', '/api/app/open', { ...post, origin: 'http://127.0.0.1:1' }, '{"target":"data"}')).status).toBe(403)
    expect((await call('POST', '/api/app/open', post, '{"target":"data"}')).status).toBe(200)
    expect(openFolder.mock.calls).toEqual([[folder]])
    expect((await call('POST', '/api/app/quit', post)).status).toBe(404)
  } finally {
    await new Promise<void>((ok, fail) => listener.close(error => error ? fail(error) : ok()))
  }
})

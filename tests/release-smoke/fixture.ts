import { once } from 'node:events'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { test as base } from '@playwright/test'
import { exercisePortable } from './portable'

export { expect } from '@playwright/test'

const isolatedEnv = ['DATA_DIR', 'NODE_ENV', 'AI_API_KEY', 'WECHAT_APPID', 'WECHAT_APPSECRET'] as const

export const test = base.extend<object, { origin: string; smoke: { origin: string; distPath: string } }>({
  smoke: [async ({ browserName }, provide) => {
    if (browserName !== 'chromium') throw new Error('Release smoke requires Chromium')
    const data = await mkdtemp(join(tmpdir(), 'xiumi-release-smoke-'))
    const previous = new Map(isolatedEnv.map(key => [key, process.env[key]]))
    let server: Server | undefined
    try {
      if (process.env.XIUMI_PORTABLE_ROOT) {
        await exercisePortable(process.env.XIUMI_PORTABLE_ROOT, data, (origin, distPath) => provide({ origin, distPath }))
        return
      }
      await access('dist/index.html')
      process.env.DATA_DIR = data
      process.env.NODE_ENV = 'production'
      delete process.env.AI_API_KEY
      delete process.env.WECHAT_APPID
      delete process.env.WECHAT_APPSECRET
      // Same Express app as the desktop entry point; do not load a developer's .env.
      const { createApp } = await import('../../server/app')
      server = createApp().listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing smoke server address')
      await provide({ origin: `http://127.0.0.1:${address.port}`, distPath: 'dist/index.html' })
    } finally {
      try {
        if (server?.listening) {
          await new Promise<void>((resolve, reject) => {
            server!.close(error => error ? reject(error) : resolve())
            server!.closeAllConnections()
          })
        }
      } finally {
        for (const [key, value] of previous) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        await rm(data, { recursive: true, force: true, maxRetries: 3 })
      }
    }
  }, { scope: 'worker' }],
  origin: [async ({ smoke }, provide) => provide(smoke.origin), { scope: 'worker' }],
  context: async ({ context, origin }, provide) => {
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort('blockedbyclient'))
    await provide(context)
  },
})

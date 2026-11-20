import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!existsSync('dist/index.html')) throw new Error('Run pnpm build before running built E2E')
const data = mkdtempSync(join(tmpdir(), 'xiumi-built-e2e-'))
process.once('exit', () => rmSync(data, { recursive: true, force: true, maxRetries: 3 }))
process.env.DATA_DIR = data
process.env.NODE_ENV = 'production'
for (const key of Object.keys(process.env)) {
  if (/^(?:AI_|WECHAT_)/i.test(key)) delete process.env[key]
}

// Import after isolating storage; unlike server/index.ts this never loads .env.
const { createApp } = await import('../../server/app')
const port = Number(process.env.API_PORT ?? 5273)
const server = createApp().listen(port, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close()
    server.closeAllConnections()
  })
}

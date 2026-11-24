// An isolated, image-only source for browser backup/restore round trips.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const data = mkdtempSync(join(tmpdir(), 'xiumi-asset-source-'))
process.env.DATA_DIR = data
for (const key of Object.keys(process.env)) if (/^(?:AI_|WECHAT_)/i.test(key)) delete process.env[key]
process.once('exit', () => rmSync(data, { recursive: true, force: true, maxRetries: 3 }))

const { createApp } = await import('../../server/app')
const server = createApp().listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Expected an isolated loopback server')
  process.send?.(address.port)
})
process.once('disconnect', () => { server.close(); server.closeAllConnections() })

import { createHash } from 'node:crypto'
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
const inert = process.argv.includes('--owned-replay-inert')
const server = createApp(inert ? { ownedReplayTransport: await inertOwnedReplay() } : undefined).listen(port, '127.0.0.1')
if (inert && process.send) server.once('listening', () => process.send?.({ address: server.address(), data }))

async function inertOwnedReplay() {
  const { createHostedReplayMultipartTransport } = await import('../../server/hostedReplayMultipart')
  const { default: sharp } = await import('sharp')
  return createHostedReplayMultipartTransport(async body => {
    // Serialize and decode the real multipart wire shape locally. Do not call fetch.
    const form = await new Request('http://127.0.0.1/inert-replay', { method: 'POST', body }).formData()
    const part = form.get('media')
    if (!part || typeof part === 'string' || form.getAll('media').length !== 1) throw new Error('Expected one replay media part')
    const bytes = Buffer.from(await part.arrayBuffer())
    const { width, height, format } = await sharp(bytes).metadata()
    if (part.type !== 'image/' + format) throw new Error('Unexpected replay media MIME')
    const digest = createHash('sha256').update(bytes).digest('hex')
    return { url: `https://mmbiz.qpic.cn/inert-owned-replay/${part.name}/${width}x${height}/${digest}` }
  })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close()
    server.closeAllConnections()
  })
}

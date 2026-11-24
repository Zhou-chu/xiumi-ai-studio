// A disposable built-app instance for the owner-local browser tests.
const [source, target] = process.argv.slice(2)
if (!source || !target) throw new Error('Expected test-owned source and target')
process.env.DATA_DIR = target
process.env.NODE_ENV = 'production'
process.env.XIUMI_SKIP_ENV_FILES = '1'
for (const key of Object.keys(process.env)) if (/^(?:AI_|WECHAT_)/i.test(key)) delete process.env[key]

const { createApp } = await import('../../server/app')
const server = createApp({ legacyMigrationSource: source }).listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Expected an isolated loopback server')
  process.send?.(address.port)
})
process.once('disconnect', () => { server.close(); server.closeAllConnections() })

export {}

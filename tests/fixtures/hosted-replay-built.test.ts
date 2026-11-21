// Run after vite build: node --import tsx --test tests/fixtures/hosted-replay-built.test.ts
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import { HOSTED_REPLAY_PATH } from '../../src/core/hostedReplayMedia'

type Boot = { address: { port: number }; data: string }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const raster = (color: string) => sharp({ create: { width: 112, height: 80, channels: 4, background: color } }).png().toBuffer()
const cropDigest = async (source: Buffer) => hash(await sharp(source)
  .resize({ width: 64, height: 64, fit: 'cover', position: sharp.strategy.attention }).png().toBuffer())

test('built loopback transports the staged exact multipart variant after replace and delete; same source restage uses new bytes', { timeout: 15_000 }, async () => {
  const child = fork('tests/fixtures/start-built-e2e.ts', ['--owned-replay-inert'], {
    execArgv: ['--import', 'tsx'], env: { ...process.env, API_PORT: '0' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  const stopped = once(child, 'exit')
  try {
    const [boot] = await Promise.race([once(child, 'message'), stopped.then(() => { throw new Error('Built fixture failed to launch') })]) as [Boot]
    const base = 'http://127.0.0.1:' + boot.address.port
    const headers = { origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }
    const post = (action: string, value: unknown, cookie?: string) => fetch(base + HOSTED_REPLAY_PATH + '/' + action, {
      method: 'POST', headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(value),
    })
    const built = await fetch(base + '/')
    assert.equal(built.status, 200)
    assert.match(await built.text(), /\/assets\//)
    const status = await fetch(base + '/api/wechat/status', { headers: { 'sec-fetch-site': 'same-origin' } })
    assert.deepEqual(await status.json(), { configured: false, appid: '', ownedReplay: true })

    const form = new FormData()
    form.append('files', new Blob([new Uint8Array(await raster('#ff000080'))], { type: 'image/png' }), 'synthetic.png')
    const uploaded = await fetch(base + '/api/assets', { method: 'POST', body: form })
    assert.equal(uploaded.status, 200)
    const [asset] = await uploaded.json()
    const assetFile = join(boot.data, 'assets', asset.file)
    const assetIndex = join(boot.data, 'assets', '_index.json')
    const original = await readFile(assetFile)
    const replacement = await raster('#0000ff80')
    assert.notEqual(hash(original), hash(replacement))

    const source = '/media/' + asset.file + '?fit=1%3A1&w=64'
    const prepare = async () => {
      const result = await post('prepare', { sources: [source] })
      assert.equal(result.status, 200)
      const details = await result.json()
      assert.equal(details.images, 1)
      return { token: details.token, cookie: result.headers.get('set-cookie')!.split(';', 1)[0] }
    }
    const transfer = async ({ token, cookie }: Awaited<ReturnType<typeof prepare>>) => {
      const response = await post('transfer', { token, confirm: true }, cookie)
      assert.equal(response.status, 200)
      return (await response.json()).mapping[source]
    }

    const first = await prepare()
    await writeFile(assetFile, replacement)
    const index = JSON.parse(await readFile(assetIndex, 'utf8'))
    index[asset.id].size = replacement.length
    await writeFile(assetIndex, JSON.stringify(index))
    const receivedFirst = await transfer(first)
    const second = await prepare()
    await rm(assetFile)
    const receivedSecond = await transfer(second)
    const sink = 'https://mmbiz.qpic.cn/inert-owned-replay/' + asset.file + '/64x64/'
    assert.equal(receivedFirst, sink + await cropDigest(original))
    assert.equal(receivedSecond, sink + await cropDigest(replacement))
    assert.notEqual(receivedFirst, receivedSecond)
    assert.equal((await post('prepare', { sources: [source] })).status, 400)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await stopped.catch(() => {})
  }
})

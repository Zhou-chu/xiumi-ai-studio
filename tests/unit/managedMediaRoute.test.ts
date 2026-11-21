import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'

it('serves only the requested image bytes generation and revalidates unqualified media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-generation-route-'))
  vi.stubEnv('DATA_DIR', root)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp()).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen address')
    const url = `http://127.0.0.1:${address.port}/media/fixture.png?w=2400`
    const fixture = join(root, 'assets', 'fixture.png')
    const png = (background: string) => sharp({ create: { width: 1, height: 1, channels: 3, background } }).png().toBuffer()
    const first = await png('red')
    const latest = await png('blue')
    const sign = (payload: Buffer) => createHash('sha256').update(payload).digest('hex')
    const missing = await fetch(url)
    expect(missing.status).toBe(404)
    await missing.text()
    await writeFile(fixture, first)
    const original = await fetch(url)
    expect(original.headers.get('cache-control')).toBe('public, no-cache')
    await original.arrayBuffer()
    await writeFile(fixture, latest)
    for (const query of ['&gen=not-a-digest', '&gen=' + sign(latest) + '&gen=' + sign(latest)]) {
      const rejected = await fetch(url + query)
      expect(rejected.status).toBe(400)
      await rejected.text()
    }
    const stale = await fetch(url + '&gen=' + sign(first))
    expect(stale.status).toBe(404)
    await stale.text()
    const matched = await fetch(url + '&gen=' + sign(latest))
    expect(matched.status).toBe(200)
    expect(Buffer.from(await matched.arrayBuffer())).toEqual(latest)
    const wrongWarm = await fetch(url + '&gen=' + sign(first))
    expect(wrongWarm.status).toBe(404)
    await wrongWarm.text()
    const { variantPath } = await import('../../server/assets')
    // The response opens this returned path after validation. Replace the
    // reusable source name in that interval and verify the resolved bytes.
    const unqualifiedVariant = await variantPath('fixture.png', '1:1', 160)
    const qualifiedVariant = await variantPath('fixture.png', '1:1', 160, sign(latest))
    expect(qualifiedVariant).not.toBe(unqualifiedVariant)
    expect(basename(qualifiedVariant)).not.toContain(sign(latest))
    await expect(variantPath('fixture.png', '1:1', 160, sign(first))).rejects.toMatchObject({ status: 404 })
    const pinned = await variantPath('fixture.png', undefined, 2400, sign(latest))
    expect(basename(pinned)).not.toContain(sign(latest))
    await writeFile(fixture, first)
    expect(pinned).not.toBe(fixture)
    await expect(readFile(pinned)).resolves.toEqual(latest)
    const replacementVariant = await variantPath('fixture.png', '1:1', 160, sign(first))
    expect(replacementVariant).not.toBe(qualifiedVariant)
    const current = await variantPath('fixture.png', undefined, 2400, sign(first))
    await writeFile(current, latest)
    const changedPin = await fetch(url + '&gen=' + sign(first))
    expect(changedPin.status).toBe(404)
    expect(changedPin.headers.get('cache-control')).toBeNull()
    await changedPin.text()

  } finally {
    server.close()
    await once(server, 'close')
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})

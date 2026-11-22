import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'

const fixture = new URL('../fixtures/legacy-backup/upstream-library.zip', import.meta.url)

it.each(['apply', 'cancel', 'changed', 'redirected-target', 'disabled'] as const)('guards a real legacy directory migration (%s)', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-migration-route-'))
  const source = join(root, 'legacy')
  const sourceData = join(source, 'data')
  const target = join(root, 'target')
  await mkdir(join(sourceData, 'projects'), { recursive: true })
  const zip = await JSZip.loadAsync(await readFile(fixture))
  for (const name of ['edited', 'corrupt', 'archived']) {
    const entry = zip.file('projects/' + name + '.json')!
    await writeFile(join(sourceData, entry.name), await entry.async('nodebuffer'))
  }
  const fixturePath = join(sourceData, 'projects', 'edited.json')
  const expected = await readFile(fixturePath)
  await writeFile(join(source, '.env'), 'TEST_SENTINEL=do-not-read')
  await writeFile(join(sourceData, 'settings.json'), 'invalid JSON must not be read')
  await writeFile(join(sourceData, 'projects', 'broken.json'), '{')
  vi.stubEnv('DATA_DIR', target)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const app = createApp(mode === 'disabled' ? {} : { legacyMigrationSource: source })
  const server = createServer(app).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('missing loopback address')
    const origin = 'http://127.0.0.1:' + address.port
    const path = origin + '/api/data/migrate'
    const send = (suffix: string, data: unknown = {}, cookie = '', headers?: HeadersInit) => fetch(path + suffix, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin, 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }), ...headers },
      body: JSON.stringify(data),
    })
    if (mode === 'disabled') {
      expect((await send('')).status).toBe(404)
      return
    }
    const capability = await fetch(path, { headers: { 'Sec-Fetch-Site': 'same-origin' } })
    expect(await capability.json()).toEqual({ available: true })
    expect((await send('', {}, '', { Origin: 'https://example.invalid' })).status).toBe(403)
    expect((await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: '{}' })).status).toBe(403)
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request(path, {
        method: 'POST',
        headers: { Host: 'localhost:' + address.port, Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'Content-Length': 2 },
      }, response => {
        response.resume()
        response.once('end', () => resolve(response.statusCode))
      })
      outgoing.once('error', reject)
      outgoing.end('{}')
    })
    expect(wrongHost).toBe(403)
    expect((await fetch(path, { headers: { Origin: 'https://example.invalid', 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(403)
    expect((await send('', {}, '', { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403)
    expect((await send('', { path: 'not an accepted field' })).status).toBe(400)
    expect((await send('?path=browser-controlled')).status).toBe(400)
    expect((await send('', null)).status).toBe(400)
    const response = await send('')
    expect(response.status).toBe(200)
    const { token, plan } = await response.json()
    expect(plan).toEqual({ sourceLayout: 'checkout', add: 2, skip: 0, unsupported: 1, invalid: 1, ignored: 0 })
    expect(JSON.stringify(plan)).not.toContain(source)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    expect(await readdir(join(target, 'projects'))).toEqual([])
    expect((await send('')).status).toBe(429)
    const applyPath = '/' + token + '/apply'
    expect((await send('/' + token + '/unknown', {}, cookie)).status).toBe(404)
    expect((await send('/' + token + '/cancel', { confirm: true }, cookie)).status).toBe(400)
    expect((await send(applyPath + '?path=inapplicable', { confirm: true }, cookie)).status).toBe(400)
    expect((await send(applyPath, { confirm: true })).status).toBe(404)
    expect((await send(applyPath, { confirm: false }, cookie)).status).toBe(400)
    if (mode === 'cancel') {
      expect((await send('/' + token + '/cancel', {}, cookie)).status).toBe(204)
      expect(await readdir(join(target, 'projects'))).toEqual([])
    }
    if (mode === 'changed') {
      const doc = JSON.parse(expected.toString('utf8'))
      await writeFile(fixturePath, JSON.stringify({ ...doc, title: 'Changed since preview' }))
      expect((await send(applyPath, { confirm: true }, cookie)).status).toBe(409)
      expect(await readdir(join(target, 'projects'))).toEqual([])
    }
    if (mode === 'redirected-target') {
      const redirect = join(root, 'outside')
      await mkdir(redirect)
      const projects = join(target, 'projects')
      await rm(projects, { recursive: true })
      await symlink(redirect, projects, process.platform === 'win32' ? 'junction' : 'dir')
      expect((await send(applyPath, { confirm: true }, cookie)).status).toBe(409)
      expect(await readdir(redirect)).toEqual([])
    }
    if (mode === 'apply') {
      const collision = join(target, 'projects', 'corrupt.json')
      await writeFile(collision, 'occupied malformed target')
      const applied = await send(applyPath, { confirm: true }, cookie)
      expect(applied.status).toBe(200)
      expect(await applied.json()).toEqual({ restored: 1, skipped: 1, failed: 0, unsupported: 1, invalid: 1, ignored: 0 })
      expect(await readFile(collision, 'utf8')).toBe('occupied malformed target')
      const restored = await (await fetch(origin + '/api/projects/edited')).json()
      expect(restored).toMatchObject({ id: 'edited', title: JSON.parse(expected.toString('utf8')).title })
      expect(await readFile(fixturePath)).toEqual(expected)
      expect(await readdir(target)).not.toContain('.env')
      expect(await readdir(target)).not.toContain('settings.json')
    }
    expect((await send(applyPath, { confirm: true }, cookie)).status).toBe(404)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['stable', 'raster-changed', 'index-changed', 'assets-moved', 'asset-collision', 'missing-raster', 'unindexed-raster', 'invalid-raster', 'invalid-index', 'oversized-index'] as const)('binds directory-image migration to the reviewed data (%s)', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-photo-'))
  const source = join(root, 'legacy')
  const target = join(root, 'target')
  const png = 'current-only.png'
  const filename = join(source, 'assets', png)
  const index = join(source, 'assets', '_index.json')
  const project = join(source, 'projects', 'visual-history.json')
  let server: ReturnType<typeof createServer> | undefined
  try {
    const zip = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-image-history.zip', import.meta.url)))
    await Promise.all(['projects', 'assets', 'versions'].map(name => mkdir(join(source, name), { recursive: true })))
    for (const name of ['projects/visual-history.json', 'assets/_index.json', 'assets/' + png, 'assets/history-only.png']) {
      await writeFile(join(source, name), await zip.file(name)!.async('nodebuffer'))
    }
    const originalImage = await readFile(filename)
    if (mode === 'missing-raster') await rm(filename)
    if (mode === 'unindexed-raster') await writeFile(index, '{}')
    if (mode === 'invalid-raster') await writeFile(filename, Buffer.alloc(originalImage.length))
    if (mode === 'invalid-index') await writeFile(index, '{')
    if (mode === 'oversized-index') await writeFile(index, Buffer.alloc(4 * 1024 * 1024 + 1))
    const originalProject = await readFile(project)
    const originalIndex = await readFile(index)
    vi.stubEnv('DATA_DIR', target)
    vi.resetModules()
    const { createApp } = await import('../../server/app')
    server = createServer(createApp({ legacyMigrationSource: source })).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('missing loopback address')
    const origin = 'http://127.0.0.1:' + address.port
    const send = (suffix = '', cookie = '') => fetch(origin + '/api/data/migrate' + suffix, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) },
      body: suffix ? '{"confirm":true}' : '{}',
    })
    const preview = await send()
    if (mode === 'oversized-index') {
      expect(preview.status).toBe(413)
      expect(await readdir(join(target, 'projects'))).toEqual([])
      expect(await readdir(join(target, 'assets'))).toEqual([])
      return
    }
    expect(preview.status).toBe(200)
    const { token, plan } = await preview.json()
    const unsupported = ['missing-raster', 'unindexed-raster', 'invalid-raster', 'invalid-index'].includes(mode)
    expect(plan).toMatchObject({ add: unsupported ? 0 : 1, unsupported: unsupported ? 1 : 0 })
    const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
    expect(await readdir(join(target, 'projects'))).toEqual([])
    expect(await readdir(join(target, 'assets'))).toEqual([])
    if (unsupported) {
      expect((await (await send('/' + token + '/apply', cookie)).json())).toMatchObject({ restored: 0, unsupported: 1 })
      expect(await readdir(join(target, 'projects'))).toEqual([])
      expect(await readdir(join(target, 'assets'))).toEqual([])
      return
    }
    if (mode === 'raster-changed') {
      const replacement = await readFile(join(source, 'assets', 'history-only.png'))
      expect(replacement).toHaveLength(originalImage.length)
      expect(replacement).not.toEqual(originalImage)
      await writeFile(filename, replacement)
    } else if (mode === 'index-changed') {
      await writeFile(index, originalIndex.toString('utf8').replace('"createdAt":10', '"createdAt":11'))
    } else if (mode === 'assets-moved') {
      await rename(join(target, 'assets'), join(root, 'previous-assets'))
      await mkdir(join(target, 'assets'))
    } else if (mode === 'asset-collision') {
      await writeFile(join(target, 'assets', png), 'existing data')
    }
    const applied = await send('/' + token + '/apply', cookie)
    expect(await readFile(project)).toEqual(originalProject)
    if (mode === 'asset-collision') {
      expect(applied.status).toBe(200)
      expect(await applied.json()).toMatchObject({ restored: 0, skipped: 1 })
      expect(await readdir(join(target, 'projects'))).toEqual([])
      expect(await readdir(join(target, 'assets'))).toEqual([png])
      expect(await readFile(join(target, 'assets', png), 'utf8')).toBe('existing data')
      return
    }
    if (mode !== 'stable') {
      expect(applied.status).toBe(409)
      expect(await applied.json()).toMatchObject({ error: expect.stringContaining('目录已更改') })
      expect(await readdir(join(target, 'projects'))).toEqual([])
      expect(await readdir(join(target, 'assets'))).toEqual([])
      return
    }
    expect(applied.status).toBe(200)
    expect(await applied.json()).toMatchObject({ restored: 1, skipped: 0, failed: 0 })
    expect(await readFile(filename)).toEqual(originalImage)
    expect(await readFile(index)).toEqual(originalIndex)
    expect((await readdir(join(target, 'assets'))).sort()).toEqual(['_index.json', png])
    const doc = await (await fetch(origin + '/api/projects/visual-history')).json()
    const served = await fetch(origin + doc.blocks[0].props.image.src)
    expect(served.status).toBe(200)
    const sharp = (await import('sharp')).default
    expect(await sharp(Buffer.from(await served.arrayBuffer())).raw().toBuffer()).toEqual(await sharp(originalImage).raw().toBuffer())
    const secondPreview = await send()
    const second = await secondPreview.json()
    expect(second.plan).toMatchObject({ add: 0, skip: 1 })
    const secondCookie = secondPreview.headers.get('set-cookie')!.split(';', 1)[0]
    expect(await (await send('/' + second.token + '/apply', secondCookie)).json()).toMatchObject({ restored: 0, skipped: 1 })
    expect(await readFile(join(target, 'assets', png))).toEqual(originalImage)
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})

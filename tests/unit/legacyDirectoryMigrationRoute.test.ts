import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
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

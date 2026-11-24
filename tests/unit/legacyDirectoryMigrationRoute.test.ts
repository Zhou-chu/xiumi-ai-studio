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

it.each(['stable', 'version-changed', 'history-image-changed', 'history-root-moved', 'directory-conflict', 'source-history-arrives', 'preexisting-orphan'] as const)('keeps directory history tied to its reviewed project and bytes (%s)', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-history-'))
  const source = join(root, 'legacy')
  const target = join(root, 'target')
  const pid = 'visual-history'
  const path = 'versions/' + pid + '/visual.json'
  const assetPath = 'assets/history-only.png'
  const currentPath = 'projects/' + pid + '.json'
  let server: ReturnType<typeof createServer> | undefined
  try {
    const zip = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-image-history.zip', import.meta.url)))
    for (const dir of ['projects', 'assets', 'versions/' + pid]) await mkdir(join(source, dir), { recursive: true })
    for (const name of [currentPath, path, 'versions/' + pid + '/text.json', 'assets/_index.json', 'assets/current-only.png', assetPath]) {
      await writeFile(join(source, name), await zip.file(name)!.async('nodebuffer'))
    }
    const current = await readFile(join(source, currentPath))
    const snapshot = await readFile(join(source, path))
    const pixels = await readFile(join(source, assetPath))
    vi.stubEnv('DATA_DIR', target)
    vi.resetModules()
    const { createApp } = await import('../../server/app')
    server = createServer(createApp({ legacyMigrationSource: source })).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('missing loopback address')
    const origin = 'http://127.0.0.1:' + address.port
    const send = (suffix = '', cookie = '') => fetch(origin + '/api/data/migrate' + suffix, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': origin, 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) },
      body: suffix ? '{"confirm":true}' : '{}',
    })
    const incoming = origin + '/api/projects/' + pid
    const apply = async (verifyPreview: boolean) => {
      const response = await send()
      expect(response.status).toBe(200)
      const { token, plan } = await response.json()
      if (verifyPreview) expect(plan).toMatchObject({ add: 1, versions: { add: 2, skip: 0 } })
      return { token, cookie: response.headers.get('set-cookie')!.split(';', 1)[0] }
    }
    if (mode === 'source-history-arrives') await rename(join(source, 'versions', pid), join(source, 'not-yet-present'))
    if (mode === 'preexisting-orphan') {
      await mkdir(join(target, 'versions', pid))
      await writeFile(join(target, path), 'sealed unrelated history')
      const orphan = await apply(false)
      expect(await (await send('/' + orphan.token + '/apply', orphan.cookie)).json()).toMatchObject({
        restored: 0, skipped: 1, versions: { restored: 0, skipped: 2, failed: 0 },
      })
      expect(await readFile(join(target, path), 'utf8')).toBe('sealed unrelated history')
      expect(await readdir(join(target, 'projects'))).toEqual([])
      expect(await readdir(join(target, 'assets'))).toEqual([])
      return
    }
    const first = await apply(mode === 'stable')
    expect((await fetch(incoming)).status).toBe(404)
    expect(await readdir(join(target, 'versions'))).toEqual([])
    if (mode === 'version-changed') {
      const entry = JSON.parse(snapshot.toString('utf8'))
      await writeFile(join(source, path), JSON.stringify({ ...entry, label: entry.label + ' revised' }))
    } else if (mode === 'history-image-changed') {
      const alternate = await zip.file('assets/current-only.png')!.async('nodebuffer')
      expect(alternate).toHaveLength(pixels.length)
      expect(alternate).not.toEqual(pixels)
      await writeFile(join(source, assetPath), alternate)
    } else if (mode === 'history-root-moved') {
      await rename(join(target, 'versions'), join(root, 'old-versions'))
      await mkdir(join(target, 'versions'))
    } else if (mode === 'source-history-arrives') {
      await rename(join(source, 'not-yet-present'), join(source, 'versions', pid))
    } else if (mode === 'directory-conflict') {
      await mkdir(join(target, 'versions', pid))
      await writeFile(join(target, path), 'existing unrelated history')
    }
    const result = await send('/' + first.token + '/apply', first.cookie)
    expect(await readFile(join(source, currentPath))).toEqual(current)
    if (mode !== 'stable') {
      expect(result.status).toBe(409)
      expect(await readdir(join(target, 'projects'))).toEqual([])
      expect(await readdir(join(target, 'assets'))).toEqual([])
      if (mode === 'directory-conflict') expect(await readFile(join(target, path), 'utf8')).toBe('existing unrelated history')
      else expect(await readdir(join(target, 'versions'))).toEqual([])
      return
    }
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ restored: 1, versions: { restored: 2, skipped: 0, failed: 0 } })
    const draft = await (await fetch(incoming)).json()
    expect(draft.blocks[0].props.image.src).toMatch(/^\/media\/current-only\.png\?gen=/)
    const item = await (await fetch(incoming + '/versions/visual')).json()
    expect(item.doc.blocks[0].props.image.src).toMatch(/^\/media\/history-only\.png\?gen=/)
    const served = await fetch(origin + item.doc.blocks[0].props.image.src)
    expect(served.status).toBe(200)
    expect(Buffer.from(await served.arrayBuffer())).toEqual(pixels)
    expect(await readFile(join(source, path))).toEqual(snapshot)
    expect(await readFile(join(source, assetPath))).toEqual(pixels)
    const replay = await apply(false)
    expect(await (await send('/' + replay.token + '/apply', replay.cookie)).json()).toMatchObject({
      restored: 0, skipped: 1, versions: { restored: 0, skipped: 2, failed: 0 },
    })
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['matching', 'divergent', 'unreadable', 'late-edit', 'full', 'current-source-changed', 'historical-source-changed', 'historical-PNG-changed'] as const)(
  'adds only reviewed missing directory history to an existing manuscript (%s)', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-existing-history-'))
    const source = join(root, 'legacy')
    const target = join(root, 'target')
    const pid = 'visual-history'
    const record = 'versions/' + pid + '/visual.json'
    const bitmap = 'assets/history-only.png'
    const manuscript = 'projects/' + pid + '.json'
    let server: ReturnType<typeof createServer> | undefined
    try {
      const zip = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-image-history.zip', import.meta.url)))
      for (const dir of ['projects', 'assets', 'versions/' + pid]) await mkdir(join(source, dir), { recursive: true })
      const entry = (path: string) => zip.file(path)!.async('nodebuffer')
      for (const name of [manuscript, 'assets/_index.json', 'assets/current-only.png', bitmap]) await writeFile(join(source, name), await entry(name))
      vi.stubEnv('DATA_DIR', target)
      vi.resetModules()
      const { createApp } = await import('../../server/app')
      server = createServer(createApp({ legacyMigrationSource: source })).listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw Error('missing loopback address')
      const origin = 'http://127.0.0.1:' + address.port
      const send = (suffix = '', cookie = '') => fetch(origin + '/api/data/migrate' + suffix, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': origin, 'Sec-Fetch-Site': 'same-origin', ...(cookie && { Cookie: cookie }) },
        body: suffix ? '{"confirm":true}' : '{}',
      })
      const preview = async () => {
        const response = await send()
        expect(response.status).toBe(200)
        return { ...await response.json(), cookie: response.headers.get('set-cookie')!.split(';', 1)[0] }
      }
      const apply = ({ token, cookie }: { token: string; cookie: string }) => send('/' + token + '/apply', cookie)
      const seed = await preview()
      expect((await (await apply(seed)).json()).restored).toBe(1)
      await mkdir(join(target, 'versions', pid))
      const collision = 'versions/' + pid + '/text.json'
      const local = Buffer.from(JSON.stringify({ id: 'text', label: 'Local unchanged collision', createdAt: 10, doc: { blocks: [] } }))
      await writeFile(join(target, collision), local)
      if (mode === 'full') for (let i = 0; i < 49; i++) await writeFile(join(target, 'versions', pid, 'extra-' + i + '.json'), local)
      for (const name of [record, collision]) await writeFile(join(source, name), await entry(name))
      const endpoint = origin + '/api/projects/' + pid
      const edit = async () => {
        const current = await (await fetch(endpoint)).json()
        expect((await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...current, title: 'A local edit' }) })).status).toBe(200)
      }
      if (mode === 'divergent') await edit()
      if (mode === 'unreadable') await writeFile(join(target, manuscript), 'malformed retained local bytes')
      const before = await readFile(join(target, manuscript))
      if (mode !== 'unreadable') expect(JSON.parse(before.toString('utf8')).revision)
        .not.toBe(JSON.parse((await entry(manuscript)).toString('utf8')).revision)
      const beforeVersions = (await readdir(join(target, 'versions', pid))).sort()
      const beforeAssets = (await readdir(join(target, 'assets'))).sort()
      const review = await preview()
      const eligible = mode !== 'divergent' && mode !== 'unreadable' && mode !== 'full'
      expect(review.plan).toMatchObject({ add: 0, skip: 1, versions: { add: eligible ? 1 : 0, skip: eligible ? 1 : 2 } })
      expect(await readFile(join(target, manuscript))).toEqual(before)
      expect((await readdir(join(target, 'versions', pid))).sort()).toEqual(beforeVersions)
      expect((await readdir(join(target, 'assets'))).sort()).toEqual(beforeAssets)
      if (mode === 'late-edit') await edit()
      const changedSource = mode === 'current-source-changed' ? manuscript : mode === 'historical-source-changed' ? record
        : mode === 'historical-PNG-changed' ? bitmap : undefined
      if (changedSource) {
        const bytes = await entry(changedSource)
        const changed = changedSource === bitmap ? await entry('assets/current-only.png') : Buffer.from(bytes.toString('utf8') + '\n')
        if (changedSource === bitmap) expect(changed).toHaveLength(bytes.length)
        expect(changed).not.toEqual(bytes)
        await writeFile(join(source, changedSource), changed)
      }
      const active = await readFile(join(target, manuscript))
      const response = await apply(review)
      if (changedSource) expect(response.status).toBe(409)
      else {
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          restored: 0, skipped: 1, versions: { restored: mode === 'matching' ? 1 : 0, skipped: mode === 'matching' ? 1 : 2, failed: 0 },
        })
      }
      expect(await readFile(join(target, manuscript))).toEqual(active)
      expect(await readFile(join(target, collision))).toEqual(local)
      for (const name of [manuscript, record, bitmap]) if (name !== changedSource) expect(await readFile(join(source, name))).toEqual(await entry(name))
      if (mode === 'matching') {
        const old = await (await fetch(endpoint + '/versions/visual')).json()
        const image = await fetch(origin + old.doc.blocks[0].props.image.src)
        expect(image.status).toBe(200)
        expect(Buffer.from(await image.arrayBuffer())).toEqual(await entry(bitmap))
      } else {
        expect((await readdir(join(target, 'versions', pid))).sort()).toEqual(beforeVersions)
        expect((await readdir(join(target, 'assets'))).sort()).toEqual(beforeAssets)
      }
    } finally {
      if (server) {
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
      }
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  },
)

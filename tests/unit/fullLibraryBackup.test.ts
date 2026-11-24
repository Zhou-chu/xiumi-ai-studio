import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { createServer, get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'

it('downloads an upstream-readable library archive containing only owned categories and redacted settings', async () => {
  const data = await mkdtemp(join(tmpdir(), 'xiumi-library-export-'))
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp()).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const base = `http://127.0.0.1:${address.port}`
    const payloads = new Map<string, string>([
      ['projects/example.json', '{"id":"example","title":"Owned project","blocks":[]}'],
      ['versions/example/v1.json', '{"id":"v1","projectId":"example","doc":{"id":"example","blocks":[]}}'],
      ['templates/fixture.json', '{"id":"fixture","name":"Template","blocks":[]}'],
      ['components/piece.json', '{"id":"piece","name":"Component","blocks":[]}'],
      ['themes/custom-fixture.json', '{"id":"custom-fixture","name":"Theme"}'],
      ['assets/image.png', 'owned-asset-bytes'],
      ['assets/_index.json', '{"image":{"id":"image","file":"image.png","name":"Image","size":17,"width":1,"height":1,"createdAt":1,"sourceUrl":"https://example.invalid/image?token=synthetic-asset-secret"}}'],
      ['settings.json', '{"private":"synthetic-other-secret","ai":{"activeId":"profile","profiles":[{"id":"profile","name":"Test AI","provider":"openai","baseUrl":"https://name:synthetic-userinfo@example.invalid/v1?token=synthetic-url-secret","apiKey":"synthetic-ai-secret","extraBody":"{\\"token\\":\\"synthetic-extra-secret\\"}","model":"demo","jsonMode":true}]}}'],
      ['.env', 'WECHAT_APPSECRET=synthetic-env-secret'],
      ['logs/private.json', '{"secret":"synthetic-logs-secret"}'],
      ['assets/temp-staged.txt', 'unowned'],
    ])
    for (const [path, value] of payloads) {
      await mkdir(join(data, path, '..'), { recursive: true })
      await writeFile(join(data, path), value)
    }
    const denied = await fetch(base + '/api/data/backup', { headers: { Origin: 'https://example.invalid', 'Sec-Fetch-Site': 'cross-site' } })
    expect(denied.status).toBe(403)
    await denied.text()
    // Node fetch rewrites the Host header; raw HTTP still connects only to
    // the fixture's loopback listener while exercising Host validation.
    const alternateHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(base + '/api/data/backup', { headers: { Host: 'example.invalid' } }, response => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      }).on('error', reject)
    })
    expect(alternateHostStatus).toBe(403)
    const sameSite = await fetch(base + '/api/data/backup', { headers: { 'Sec-Fetch-Site': 'same-site' } })
    expect(sameSite.status).toBe(403)
    await sameSite.text()
    const result = await fetch(base + '/api/data/backup')
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toBe('application/zip')
    expect(result.headers.get('content-disposition')).toMatch(/attachment; filename="xiumi-backup-/)
    expect(result.headers.get('cache-control')).toBe('no-store')
    const archive = await JSZip.loadAsync(await result.arrayBuffer(), { checkCRC32: true })
    expect(Object.keys(archive.files).sort()).toEqual([
      'assets/_index.json', 'assets/image.png', 'components/piece.json', 'projects/example.json',
      'settings.json', 'templates/fixture.json', 'themes/custom-fixture.json', 'versions/example/v1.json', 'xiumi-backup.json',
    ])
    expect(JSON.parse(await archive.file('xiumi-backup.json')!.async('string'))).toMatchObject({ app: 'xiumi-ai-studio', version: '0.1.0' })
    for (const [path, value] of payloads) {
      if (path !== 'settings.json' && path !== 'assets/_index.json' && archive.file(path)) {
        expect(await archive.file(path)!.async('string')).toBe(value)
      }
    }
    const settings = await archive.file('settings.json')!.async('string')
    const metadata = await archive.file('assets/_index.json')!.async('string')
    expect(JSON.parse(settings)).toMatchObject({ ai: { activeId: 'profile', profiles: [{ id: 'profile', model: 'demo', apiKey: '', baseUrl: 'https://example.invalid/v1' }] } })
    expect(settings).not.toContain('synthetic-')
    expect(metadata).not.toContain('synthetic-')
    await expect(readFile(join(data, '.env'), 'utf8')).resolves.toContain('synthetic-env-secret')
    await writeFile(join(data, 'settings.json'), 'synthetic-parser-error-secret')
    const malformed = await fetch(base + '/api/data/backup')
    expect(malformed.status).toBe(400)
    expect(await malformed.text()).not.toContain('synthetic-parser-error-secret')
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(data, { recursive: true, force: true })
  }
})


it('rejects overlapping backup transfers and releases its slot after client disconnect', async () => {
  const data = await mkdtemp(join(tmpdir(), 'xiumi-library-abort-'))
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp()).listen(0, '127.0.0.1')
  const controller = new AbortController()
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const endpoint = `http://127.0.0.1:${address.port}/api/data/backup`
    const large = join(data, 'assets', 'buffered.png')
    await writeFile(large, '')
    await truncate(large, 32 * 1024 * 1024)
    const first = await fetch(endpoint, { signal: controller.signal })
    expect(first.status).toBe(200)
    const overlap = await fetch(endpoint)
    expect(overlap.status).toBe(429)
    await overlap.text()
    controller.abort()
    await rm(large)
    await vi.waitFor(async () => {
      const next = await fetch(endpoint)
      if (next.status !== 200) {
        await next.text()
        expect(next.status).toBe(200)
      }
      expect((await next.arrayBuffer()).byteLength).toBeGreaterThan(0)
    })
  } finally {
    controller.abort()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(data, { recursive: true, force: true })
  }
})

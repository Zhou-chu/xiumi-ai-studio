import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('archived model cards', () => {
  it('retains only inert descriptors; ignores reserved and duplicate IDs', async () => {
    const { archivedModelCards } = await import('../../server/modelRestore')
    const fake = { id: 'archived-1', name: 'Archived model', provider: 'openai', model: 'local-model', apiKey: 'synthetic-token', baseUrl: 'https://example.invalid/auth-path', extraBody: '{"token":"synthetic"}', authorization: 'synthetic' }
    expect(archivedModelCards({ ai: { activeId: fake.id, profiles: [fake, { ...fake, id: 'DUP' }, { ...fake, id: 'dup' }, { ...fake, id: 'env' }] } }))
      .toEqual([{ id: fake.id, name: fake.name, provider: 'openai', model: fake.model }])
  })
})

it('previews a genuine settings-only backup and adds passive cards without changing live settings', async () => {
  const data = await mkdtemp(join(tmpdir(), 'model-cards-'))
  vi.stubEnv('DATA_DIR', data)
  vi.stubEnv('AI_API_KEY', '')
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp()).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
    const path = join(data, 'settings.json')
    const fixture = { id: 'a', name: 'Archived model', provider: 'openai', model: 'fixture-model', baseUrl: 'https://example.invalid/synthetic-path', apiKey: 'synthetic-secret', jsonMode: true }
    await writeFile(path, JSON.stringify({ ai: { activeId: 'a', profiles: [fixture, { ...fixture, id: 'b' }] } }))
    const backup = await fetch(base + '/api/data/backup')
    expect(backup.status).toBe(200)
    const zip = await backup.blob()
    const existing = JSON.stringify({ ai: { activeId: 'b', profiles: [{ ...fixture, id: 'b', name: 'Existing model' }] } })
    await writeFile(path, existing)
    const headers = { Origin: base, 'Sec-Fetch-Site': 'same-origin' }
    let previewCookie = ''
    async function preview(include = true) {
      const body = new FormData()
      body.append('file', zip, 'backup.zip')
      const response = await fetch(base + '/api/data/restore' + (include ? '?modelCards=1' : ''), { method: 'POST', headers: previewCookie ? { ...headers, Cookie: previewCookie } : headers, body })
      expect(response.status).toBe(200)
      previewCookie = response.headers.get('set-cookie')!.split(';')[0]
      return { data: await response.json(), cookie: previewCookie }
    }
    const settings = async () => (await fetch(base + '/api/settings/ai')).json()
    expect((await preview(false)).data.plan).toMatchObject({ unsupported: ['settings.json'] })
    expect((await settings()).modelCards).toEqual([])
    const { data: { plan, token }, cookie } = await preview()
    expect(plan.modelCards).toEqual({ add: ['a'], alreadyPresent: [], conflicts: ['b'] })
    expect((await settings()).modelCards).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(existing)
    const response = await fetch(base + '/api/data/restore/' + token + '/apply', {
      method: 'POST', body: '{"confirm":true}', headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json' },
    })
    expect(response.status).toBe(200)
    expect((await response.json()).modelCards).toEqual({ restored: ['a'], alreadyPresent: [], conflicts: ['b'], failed: [] })
    expect(await readFile(path, 'utf8')).toBe(existing)
    expect(JSON.parse(await readFile(join(data, 'model-cards', 'a.json'), 'utf8'))).toEqual({
      id: 'a', name: fixture.name, provider: fixture.provider, model: fixture.model,
    })
    expect(await settings()).toMatchObject({ activeId: 'b', modelCards: [{ id: 'a', name: fixture.name, model: fixture.model, provider: fixture.provider }], profiles: [{ id: 'b', hasKey: true }] })
    expect((await preview()).data.plan.modelCards).toEqual({ add: [], conflicts: ['b'], alreadyPresent: ['a'] })
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(data, { recursive: true, force: true })
  }
}, 15_000)

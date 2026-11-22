import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { registerTheme, THEMES } from '../../src/core/themes'
import type { Doc, Theme } from '../../src/core/types'

const styleFixture = new URL('../fixtures/legacy-backup/upstream-design.zip', import.meta.url)
const customId = 'custom-fixture'
const snapshotStyleId = 'custom-snapshot-fixture'

it.each(['clean', 'reuse', 'conflict', 'late-conflict', 'cleared-conflict'] as const)('restores safely qualified project styles through a real ZIP round trip (%s)', async mode => {
  const temp = await mkdtemp(join(tmpdir(), 'xiumi-project-themes-'))
  vi.stubEnv('DATA_DIR', join(temp, 'data'))
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: temp })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('missing loopback port')
    const base = 'http://127.0.0.1:' + address.port
    const route = base + '/api/data/restore'
    const json = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
    let cookie = ''
    const preview = async (archive: Blob, flags = '?design=1') => {
      const form = new FormData()
      form.append('file', archive, 'library.zip')
      const res = await fetch(route + flags, { method: 'POST', body: form, headers: cookie ? { Cookie: cookie } : {} })
      expect(res.status).toBe(200)
      cookie = res.headers.get('set-cookie')?.split(';', 1)[0] ?? cookie
      return res.json()
    }
    const apply = async (token: string) => {
      const res = await fetch(route + '/' + token + '/apply', {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
      })
      expect(res.status).toBe(200)
      return res.json()
    }
    const listThemes = async (): Promise<Theme[]> => (await fetch(base + '/api/themes')).json()
    const currentTheme = async () => (await listThemes()).find(theme => theme.id === customId)
    const existing = await preview(new Blob([new Uint8Array(await readFile(styleFixture))]))
    expect((await apply(existing.token)).design.themes.restored).toEqual([customId])
    const style = (await currentTheme())!
    expect(style.colors.primary).toBe('#112233')
    const snapshotStyle = { ...style, id: snapshotStyleId, name: 'Historical archive style',
      colors: { ...style.colors, primary: '#246813' } }
    expect((await fetch(base + '/api/themes', { method: 'POST', ...json(snapshotStyle) })).ok).toBe(true)
    const doc = (id: string, themeId: string, themeOverrides?: Doc['themeOverrides']): Doc => ({
      id, title: id, author: '', digest: '', themeId, ...(themeOverrides && { themeOverrides }),
      blocks: [{ id: 'heading', type: 'heading', props: { title: 'Proof', index: '', subtitle: '', variant: 'bar' } }],
      createdAt: 1, updatedAt: 1,
    })
    const override = { colors: { ...THEMES[0].colors, primary: '#325476' }, fontSize: 17 }
    const documents = [
      doc('article-custom', customId),
      doc('article-independent', THEMES[0].id),
      doc('article-overrides', THEMES[0].id, override),
      doc('article-unavailable', 'custom-missing'),
      doc('article-invalid', THEMES[0].id, { fontSize: 20 }),
    ]
    for (const item of documents) expect((await fetch(base + '/api/projects/' + item.id, { method: 'PUT', ...json(item) })).status).toBe(200)
    const versionResponse = await fetch(base + '/api/projects/article-custom/versions', {
      method: 'POST', ...json({ label: 'before', doc: { ...documents[0], themeId: snapshotStyleId } }),
    })
    expect(versionResponse.status).toBe(200)
    const version = await versionResponse.json()
    const backup = await fetch(base + '/api/data/backup')
    expect(backup.status).toBe(200)
    const archive = await backup.blob()
    for (const item of documents) expect((await fetch(base + '/api/projects/' + item.id, { method: 'DELETE' })).ok).toBe(true)
    await rm(join(temp, 'data', 'versions', 'article-custom'), { recursive: true, force: true })
    for (const id of [customId, snapshotStyleId]) expect((await fetch(base + '/api/themes/' + id, { method: 'DELETE' })).ok).toBe(true)
    const conflictingStyle = { ...style, colors: { ...style.colors, primary: '#645432' } }
    const insertConflict = async () => expect((await fetch(base + '/api/themes', { method: 'POST', ...json(conflictingStyle) })).ok).toBe(true)
    const preexistingConflict = mode === 'conflict' || mode === 'cleared-conflict'
    const expectCustom = mode === 'clean' || mode === 'reuse'
    if (preexistingConflict) await insertConflict()
    if (mode === 'reuse') expect((await fetch(base + '/api/themes', { method: 'POST', ...json(style) })).ok).toBe(true)
    const noDesign = await preview(archive, '')
    expect([...noDesign.plan.projects.add].sort()).toEqual(['article-independent', 'article-overrides'])
    const selected = await preview(archive)
    expect(selected.plan.projects.unsupported).toEqual(expect.arrayContaining(['article-invalid', 'article-unavailable']))
    expect([...selected.plan.projects.add].sort()).toEqual(preexistingConflict
      ? ['article-independent', 'article-overrides'] : ['article-custom', 'article-independent', 'article-overrides'])
    expect((await fetch(base + '/api/projects/article-independent')).status).toBe(404)
    if (mode === 'late-conflict') await insertConflict()
    if (mode === 'cleared-conflict') expect((await fetch(base + '/api/themes/' + customId, { method: 'DELETE' })).ok).toBe(true)
    const result = await apply(selected.token)
    expect([...result.projects.restored].sort()).toEqual(expectCustom
      ? ['article-custom', 'article-independent', 'article-overrides'] : ['article-independent', 'article-overrides'])
    const opened: Doc = await (await fetch(base + '/api/projects/article-overrides')).json()
    expect(opened.themeOverrides).toEqual(override)
    expect(compileDoc(opened).html).toContain('#325476')
    if (expectCustom) {
      expect(result.versions.restored).toEqual(['article-custom/' + version.id])
      expect((await currentTheme())!.colors.primary).toBe('#112233')
      registerTheme((await currentTheme())!)
      const restored: Doc = await (await fetch(base + '/api/projects/article-custom')).json()
      expect(restored.themeId).toBe(customId)
      expect(compileDoc(restored).html).toContain('#112233')
      const loadedVersion = await fetch(base + '/api/projects/article-custom/versions/' + version.id)
      expect(loadedVersion.status).toBe(200)
      const historical: { doc: Doc } = await loadedVersion.json()
      expect(historical.doc.themeId).toBe(snapshotStyleId)
      const historicalStyle = (await listThemes()).find(theme => theme.id === snapshotStyleId)!
      registerTheme(historicalStyle)
      expect(compileDoc(historical.doc).html).toContain('#246813')
    } else {
      expect((await fetch(base + '/api/projects/article-custom')).status).toBe(404)
      expect((await currentTheme())!.colors.primary).toBe(mode === 'cleared-conflict' ? '#112233' : '#645432')
      expect(result.versions.restored).toEqual([])
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(temp, { recursive: true, force: true })
  }
}, 20000)

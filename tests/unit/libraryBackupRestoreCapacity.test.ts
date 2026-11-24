import { once } from 'node:events'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

async function withLibrary<T>(run: (base: string, data: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-backup-capacity-'))
  const data = join(root, 'data')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: root })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback port')
    return await run('http://127.0.0.1:' + address.port, data)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
}

it('downloads a capacity-safe native ZIP and rejects an over-limit manuscript before attachment headers', async () => {
  const zip = await withLibrary(async (source, data) => {
    const doc = JSON.stringify({ id: 'capacity', title: 'At the restore limit', blocks: [] })
    const bytes = 4 * 1024 * 1024
    const file = join(data, 'projects', 'capacity.json')
    const atLimit = Buffer.alloc(bytes, ' ')
    atLimit.write(doc)
    await writeFile(file, atLimit)
    const backup = await fetch(source + '/api/data/backup')
    expect(backup.status).toBe(200)
    expect(backup.headers.get('content-type')).toBe('application/zip')
    const archive = await backup.blob()

    await writeFile(file, Buffer.concat([atLimit, Buffer.from(' ')]))
    const oversized = await fetch(source + '/api/data/backup')
    expect(oversized.status).toBe(413)
    expect(oversized.headers.get('content-disposition')).toBeNull()
    expect(oversized.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await oversized.json()).toMatchObject({ error: expect.stringContaining('单个文稿') })
    return archive
  })
  await withLibrary(async (target, data) => {
    const form = new FormData()
    form.set('file', zip, 'at-restore-capacity.zip')
    const preview = await fetch(target + '/api/data/restore', { method: 'POST', body: form })
    expect(preview.status).toBe(200)
    const { token, plan } = await preview.json()
    expect(plan.projects.add).toEqual(['capacity'])
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual([])
    const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
    const applied = await fetch(target + '/api/data/restore/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
    })
    expect(applied.status).toBe(200)
    expect((await applied.json()).projects.restored).toEqual(['capacity'])
    const document = await fetch(target + '/api/projects/capacity')
    expect(document.status).toBe(200)
    expect(await document.json()).toMatchObject({ id: 'capacity', title: 'At the restore limit', blocks: [] })
  })
}, 20_000)

it('counts generated metadata among ZIP members and enforces the matching name and aggregate budgets', async () => {
  const { assertLibraryRestoreCapacity, LIBRARY_RESTORE_ZIP_BUDGET: budget, restoredZipNameBytes } = await import('../../server/libraryRestoreBudget')
  const member = { name: 'xiumi-backup.json', size: 32 }
  const entries = Array.from({ length: budget.maxEntries - 1 }, (_, i) => ({ name: 'projects/p' + i + '.json', size: 2 }))
  expect(() => assertLibraryRestoreCapacity([...entries, member])).not.toThrow()
  expect(() => assertLibraryRestoreCapacity([...entries, member, { name: 'settings.json', size: 2 }])).toThrow('备份条目')

  const versionName = (i: number) => 'versions/' + 'UpperCase'.repeat(7) + 'X/' + String(i).padStart(80, 'A') + '.json'
  const memberCost = restoredZipNameBytes(versionName(0), versionName(0).toLowerCase())
  const count = Math.floor((budget.maxNameBytes - member.name.length) / memberCost)
  const longNames = Array.from({ length: count }, (_, i) => ({ name: versionName(i), size: 2 }))
  expect(() => assertLibraryRestoreCapacity([...longNames, member])).not.toThrow()
  expect(() => assertLibraryRestoreCapacity([...longNames, member, { name: versionName(count), size: 2 }])).toThrow('备份文件名总量')

  const projects = Array.from({ length: budget.totalProjectBytes / budget.entryBytes },
    (_, i) => ({ name: 'projects/big-' + i + '.json', size: budget.entryBytes }))
  const optional = { name: 'versions/big-0/v1.json', size: budget.entryBytes + 1 }
  expect(() => assertLibraryRestoreCapacity([...projects, member, optional])).not.toThrow()
  expect(() => assertLibraryRestoreCapacity([...projects, member, { name: 'projects/extra.json', size: 1 }])).toThrow('文稿总大小')
})

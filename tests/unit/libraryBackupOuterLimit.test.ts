import { once } from 'node:events'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

it('refuses an encoded outer ZIP before response headers and leaves no temp files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-backup-outer-'))
  const data = join(root, 'data')
  const spool = join(root, 'backup-spool')
  await mkdir(spool)
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const options = { restoreTempRoot: root, backupZip: { maxBytes: 1024, tempRoot: spool } }
  const server = createServer(createApp(options)).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback port')
    // Owned file data is stored by the existing encoder; no huge fixture.
    await writeFile(join(data, 'assets', 'local.jpg'), Buffer.alloc(1200))
    const url = 'http://127.0.0.1:' + address.port + '/api/data/backup'
    const response = await fetch(url)
    expect(response.status).toBe(413)
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('ZIP') })
    await vi.waitFor(async () => expect(await readdir(spool)).toEqual([]))
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})

it('uses a strict measured ZIP boundary and keeps ordinary backups streaming', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-backup-exact-'))
  const data = join(root, 'data')
  const spool = join(root, 'spool')
  try {
    await mkdir(join(data, 'projects'), { recursive: true })
    await mkdir(spool)
    const doc = JSON.stringify({ id: 'check', title: 'Round trip', blocks: [] })
    // Larger than the injected exact limit but highly compressible; also goes
    // through two fixed-size deflate chunks and a final partial chunk.
    const original = doc + ' '.repeat(160_000)
    await writeFile(join(data, 'projects', 'check.json'), original)
    const { planLibraryBackup, libraryZip } = await import('../../server/fullLibraryBackup')
    const { prepareLibraryDownload } = await import('../../server/libraryBackupDownload')
    const signal = new AbortController().signal
    const plan = await planLibraryBackup(data, '0.1.0', signal)
    const bytes = async (stream: AsyncIterable<Uint8Array>) => {
      const chunks: Uint8Array[] = []
      for await (const chunk of stream) chunks.push(chunk)
      return Buffer.concat(chunks)
    }
    const exact = (await bytes(libraryZip(plan, signal))).length
    expect(exact).toBeLessThan(Buffer.byteLength(original))

    // A missing temp root proves the ordinary path does not touch disk for a spool.
    const streaming = await prepareLibraryDownload(plan, signal, { tempRoot: join(root, 'absent') })
    expect(streaming.size).toBeUndefined()
    expect(streaming.dispose).toBeUndefined()
    expect((await bytes(streaming.body())).length).toBe(exact)

    await expect(prepareLibraryDownload(plan, signal, { maxBytes: exact, tempRoot: spool })).rejects.toMatchObject({ status: 413 })
    expect(await readdir(spool)).toEqual([])
    const spooled = await prepareLibraryDownload(plan, signal, { maxBytes: exact + 1, tempRoot: spool })
    let restored: Buffer
    try {
      expect(spooled.size).toBe(exact)
      expect(await readdir(spool)).toHaveLength(1)
      restored = await bytes(spooled.body())
      expect(restored.length).toBe(exact)
    } finally {
      await spooled.dispose?.()
    }
    expect(await readdir(spool)).toEqual([])

    const target = join(root, 'target')
    vi.stubEnv('DATA_DIR', target)
    vi.resetModules()
    const { createApp } = await import('../../server/app')
    const server = createServer(createApp({ restoreTempRoot: root })).listen(0, '127.0.0.1')
    try {
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing loopback port')
      const url = 'http://127.0.0.1:' + address.port + '/api/data/restore'
      const form = new FormData()
      form.set('file', new Blob([new Uint8Array(restored)]), 'bound.zip')
      const preview = await fetch(url, { method: 'POST', body: form })
      expect(preview.status).toBe(200)
      const { token, plan: restorePlan } = await preview.json()
      expect(restorePlan.projects.add).toEqual(['check'])
      expect(await readdir(join(target, 'projects'))).toEqual([])
      expect(await readdir(join(target, 'assets'))).toEqual([])
      const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
      const applied = await fetch(url + '/' + token + '/apply', {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      expect(applied.status).toBe(200)
      expect((await applied.json()).projects.restored).toEqual(['check'])
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      vi.unstubAllEnvs()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)

it.each(['directory creation', 'owned file open'] as const)('removes the private spool if cancellation wins during %s', async (phase) => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-backup-spool-abort-'))
  const data = join(root, 'data')
  const spool = join(root, 'spool')
  const controller = new AbortController()
  const cancelled = new Error('Synthetic cancellation while preparing backup')
  vi.doMock('node:fs/promises', async importOriginal => {
    const fs = await importOriginal<typeof import('node:fs/promises')>()
    return {
      ...fs,
      async mkdtemp(prefix: string) {
        const directory = await fs.mkdtemp(prefix)
        if (phase === 'directory creation') controller.abort(cancelled)
        return directory
      },
      async open(...args: Parameters<typeof fs.open>) {
        const handle = await fs.open(...args)
        if (phase === 'owned file open') controller.abort(cancelled)
        return handle
      },
    }
  })
  try {
    await mkdir(join(data, 'assets'), { recursive: true })
    await mkdir(spool)
    await writeFile(join(data, 'assets', 'fixture.jpg'), 'private synthetic store data')
    vi.resetModules()
    const { planLibraryBackup } = await import('../../server/fullLibraryBackup')
    const { prepareLibraryDownload } = await import('../../server/libraryBackupDownload')
    const plan = await planLibraryBackup(data, '0.1.0', controller.signal)
    const error: unknown = await prepareLibraryDownload(plan, controller.signal, { maxBytes: 1024, tempRoot: spool })
      .then(() => null, (reason: unknown) => reason)
    expect(controller.signal.reason).toBe(cancelled)
    expect(error === cancelled || (error instanceof Error && error.name === 'AbortError' &&
      (error as NodeJS.ErrnoException).code === 'ABORT_ERR')).toBe(true)
    expect(await readdir(spool)).toEqual([])
  } finally {
    vi.doUnmock('node:fs/promises')
    vi.resetModules()
    await rm(root, { recursive: true, force: true })
  }
})

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

it('closes an owned file without starting a stream if disconnect wins during async file validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-backup-open-abort-'))
  const path = join(root, 'assets', 'bounded.png')
  const controller = new AbortController()
  const reason = new Error('Synthetic disconnect while opening owned file')
  const createStream = vi.fn(() => { throw Error('Started a read after disconnect') })
  const closeFile = vi.fn(async () => {})
  vi.doMock('node:fs/promises', async importOriginal => {
    const fs = await importOriginal<typeof import('node:fs/promises')>()
    return { ...fs, async open(...args: Parameters<typeof fs.open>) {
      const handle = await fs.open(...args)
      const stat = handle.stat.bind(handle)
      return {
        async stat(options: { bigint: true }) {
          const info = await stat(options)
          controller.abort(reason)
          return info
        },
        createReadStream: createStream,
        async close() {
          await handle.close()
          await closeFile()
        },
      }
    } }
  })
  try {
    await mkdir(join(root, 'assets'))
    await writeFile(path, 'synthetic bytes')
    const { planLibraryBackup, libraryZip } = await import('../../server/fullLibraryBackup')
    const plan = await planLibraryBackup(root, '0.1.0', controller.signal)
    expect(plan.files.map(file => file.name)).toEqual(['assets/bounded.png'])
    const drain = async () => { for await (const _chunk of libraryZip(plan, controller.signal)) { /* Consume until abort. */ } }
    await expect(drain()).rejects.toBe(reason)
    expect(controller.signal.aborted).toBe(true)
    expect(createStream).not.toHaveBeenCalled()
    expect(closeFile).toHaveBeenCalledOnce()
  } finally {
    vi.doUnmock('node:fs/promises')
    vi.resetModules()
    await rm(root, { recursive: true, force: true })
  }
})

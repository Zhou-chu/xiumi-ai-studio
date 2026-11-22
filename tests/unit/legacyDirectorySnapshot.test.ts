import { mkdirSync, renameSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import { createLegacyDirectoryPreview } from '../../server/legacyDirectoryMigration'

const directoryWitness = vi.hoisted(() => ({ watch: '', active: 0 }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, async opendir(...args: Parameters<typeof actual.opendir>) {
    const directory = await actual.opendir(...args)
    if (args[0] === directoryWitness.watch) {
      const iterate = directory[Symbol.asyncIterator].bind(directory)
      directory[Symbol.asyncIterator] = async function *() {
        directoryWitness.active++
        try { return yield* iterate() }
        finally { directoryWitness.active-- }
      }
    }
    return directory
  } }
})

const fixtureZip = new URL('../fixtures/legacy-backup/upstream-library.zip', import.meta.url)

async function inFixture(run: (root: string, source: string, data: string, target: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-source-snapshot-'))
  try {
    const source = join(root, '旧稿'), data = join(source, 'data'), target = join(root, 'new')
    await mkdir(join(data, 'projects'), { recursive: true })
    await mkdir(target)
    await run(root, source, data, target)
  } finally { await rm(root, { recursive: true, force: true }) }
}

it('reads bounded structural candidates from genuine original ZIP unpacked as checkout or data, without modifying either directory', () =>
  inFixture(async (_root, source, data, target) => {
    const zip = await JSZip.loadAsync(await readFile(fixtureZip))
    const eligible = zip.file('projects/edited.json')!
    const file = join(data, eligible.name)
    const payload = await eligible.async('nodebuffer')
    await writeFile(file, payload)
    await writeFile(join(source, '.env'), 'synthetic-credential-must-stay-local')
    await link(join(source, '.env'), join(data, 'projects', 'aliased.json'))
    await writeFile(join(data, 'settings.json'), 'not JSON - sentinel must not be parsed')
    await writeFile(join(data, 'projects', 'malformed.json'), '{')
    await writeFile(join(data, 'projects', 'mismatch.json'), '{"id":"someone-else","blocks":[]}')
    await writeFile(join(data, 'projects', 'notes.txt'), 'ignored')
    const checkout = await createLegacyDirectoryPreview({ configuredSource: source, target }).snapshotProjects()
    expect(checkout).toMatchObject({ sourceLayout: 'checkout', summaries: { candidates: 1, invalid: 2, ignored: 2 } })
    expect(checkout.projects).toEqual([JSON.parse(payload.toString('utf8'))])
    const direct = await createLegacyDirectoryPreview({ configuredSource: data, target }).snapshotProjects()
    expect(direct).toMatchObject({ ...checkout, sourceLayout: 'data', verifyDestination: expect.any(Function) })
    expect(JSON.stringify(checkout)).not.toContain('synthetic-credential')
    expect(await readFile(file)).toEqual(payload)
    expect(await readdir(target)).toEqual([])
  }))

it('refuses overlapping real roots and project category junctions', () => inFixture(async (root, source, data, target) => {
  const actual = await realpath(data)
  await expect(createLegacyDirectoryPreview({ configuredSource: source, target: actual }).snapshotProjects()).rejects.toMatchObject({ status: 400 })
  const other = join(root, 'elsewhere')
  await mkdir(other)
  await rm(join(data, 'projects'), { recursive: true })
  await symlink(other, join(data, 'projects'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(createLegacyDirectoryPreview({ configuredSource: data, target }).snapshotProjects()).rejects.toMatchObject({ status: 400 })
}))

it('counts all project entries against the scan quota and enforces separate item and byte limits', () => inFixture(async (_root, _source, data, target) => {
  const a = Buffer.from('{"id":"one","blocks":[]}')
  const b = Buffer.from('{"id":"two","blocks":[]}')
  await writeFile(join(data, 'projects', 'one.json'), a)
  await writeFile(join(data, 'projects', 'two.json'), b)
  const options = { configuredSource: data, target }
  await expect(createLegacyDirectoryPreview({ ...options, maxEntries: 1 }).snapshotProjects()).rejects.toMatchObject({ status: 413 })
  await expect(createLegacyDirectoryPreview({ ...options, maxProjectBytes: 8 }).snapshotProjects()).rejects.toMatchObject({ status: 413 })
  await expect(createLegacyDirectoryPreview({ ...options, maxTotalProjectBytes: a.length + 1 }).snapshotProjects()).rejects.toMatchObject({ status: 413 })
}))

it('rejects unconfigured, cancelled or alias-root requests without collecting candidates', () => inFixture(async (root, source, data, target) => {
  await expect(createLegacyDirectoryPreview({ configuredSource: undefined, target }).snapshotProjects()).rejects.toMatchObject({ status: 403 })
  await expect(createLegacyDirectoryPreview({ configuredSource: '//not-a-local-share/data', target }).snapshotProjects()).rejects.toMatchObject({ status: 400 })
  const alias = join(root, 'alias')
  await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(createLegacyDirectoryPreview({ configuredSource: alias, target }).snapshotProjects()).rejects.toMatchObject({ status: 400 })
  const abort = new AbortController()
  abort.abort()
  await expect(createLegacyDirectoryPreview({ configuredSource: data, target }).snapshotProjects(abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
}))

it.skipIf(process.platform === 'win32')('fails closed for duplicate candidate names with different casing', () =>
  inFixture(async (_root, _source, data, target) => {
    await writeFile(join(data, 'projects', 'same.json'), '{"id":"same","blocks":[]}')
    await writeFile(join(data, 'projects', 'SAME.json'), '{"id":"SAME","blocks":[]}')
    await expect(createLegacyDirectoryPreview({ configuredSource: data, target }).snapshotProjects()).rejects.toMatchObject({ status: 400 })
    expect(await readdir(target)).toEqual([])
  }))


it('returns an empty projection for a recognizable library containing only templates', () =>
  inFixture(async (_root, _source, data, target) => {
    await rm(join(data, 'projects'), { recursive: true })
    await mkdir(join(data, 'templates'))
    await expect(createLegacyDirectoryPreview({ configuredSource: data, target }).snapshotProjects()).resolves.toEqual({
      sourceLayout: 'data', projects: [], assets: [], sourceVersion: expect.stringMatching(/^[0-9a-f]{64}$/), verifyDestination: expect.any(Function), summaries: { candidates: 0, invalid: 0, ignored: 0 },
    })
    expect(await readdir(target)).toEqual([])
  }))

it.each([2, 6])('aborts on direct root replacement during the snapshot (checkpoint %i)', checkpoint =>
  inFixture(async (root, _source, data, target) => {
    await writeFile(join(data, 'projects', 'one.json'), '{"id":"one","blocks":[]}')
    const signal = new AbortController().signal
    const throwIfAborted = signal.throwIfAborted.bind(signal)
    let checkpoints = 0
    let openAtReplacement: number | undefined
    directoryWitness.watch = join(await realpath(data), 'projects')
    const original = join(root, 'moved')
    vi.spyOn(signal, 'throwIfAborted').mockImplementation(() => {
      if (++checkpoints === checkpoint) {
        openAtReplacement = directoryWitness.active
        renameSync(data, original)
        mkdirSync(join(data, 'projects'), { recursive: true })
      }
      throwIfAborted()
    })
    await expect(createLegacyDirectoryPreview({ configuredSource: data, target }).snapshotProjects(signal))
      .rejects.toMatchObject({ status: 409 })
    // A real directory handle, not just a mock timing assumption. Windows
    // can reject ancestor rename while the child enumeration is still open.
    expect(openAtReplacement).toBe(0)
    expect(await readFile(join(original, 'projects', 'one.json'), 'utf8')).toBe('{"id":"one","blocks":[]}')
    expect(await readdir(target)).toEqual([])
  }))

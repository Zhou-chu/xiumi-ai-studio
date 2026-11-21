import { link, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { projectCollection } from '../../server/projectStore'

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, rename: vi.fn(fs.rename), link: vi.fn(fs.link) }
})

const dirs: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-restore-store-'))
  dirs.push(dir)
  return { dir, projects: projectCollection(dir) }
}

const archive = { id: 'project', title: 'Archived notes', revision: 'old-revision', updatedAt: 12 }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const checkpoint = () => ({ entered: deferred(), release: deferred() })

it('keeps an ordinary save already in progress instead of replacing it with the archive', async () => {
  const { projects } = await setup()
  const save = checkpoint()
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rename).mockImplementationOnce(async (...args) => {
    save.entered.resolve()
    await save.release.promise
    return fs.rename(...args)
  })
  const saving = projects.put({ id: archive.id, title: 'Current draft' })
  await save.entered.promise
  try {
    const restoring = projects.restore(archive)
    save.release.resolve()
    const saved = await saving
    await expect(restoring).resolves.toBeNull()
    await expect(projects.get(archive.id)).resolves.toEqual(saved)
  } finally {
    save.release.resolve()
    await saving
  }
})

it('waits for restore before reading the new revision and rejects blind writes', async () => {
  const { projects } = await setup()
  const publish = checkpoint()
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(link).mockImplementationOnce(async (...args) => {
    publish.entered.resolve()
    await publish.release.promise
    return fs.link(...args)
  })
  const restoring = projects.restore(archive)
  await publish.entered.promise
  try {
    const reading = projects.get(archive.id)
    const blindWrite = expect(projects.put({ id: archive.id, title: 'Blind draft' })).rejects.toMatchObject({ status: 409 })
    publish.release.resolve()
    const restored = await restoring
    expect(restored).toMatchObject({ id: archive.id, title: archive.title, updatedAt: 12, revision: expect.any(String) })
    expect(restored?.revision).not.toBe(archive.revision)
    await expect(reading).resolves.toEqual(restored)
    await blindWrite
  } finally {
    publish.release.resolve()
    await restoring
  }
})

it('preserves occupied files even when an existing project cannot be read as JSON', async () => {
  const { dir, projects } = await setup()
  const target = join(dir, 'project.json')
  await writeFile(target, 'Interrupted local save', 'utf8')
  await expect(projects.restore(archive)).resolves.toBeNull()
  await expect(readFile(target, 'utf8')).resolves.toBe('Interrupted local save')
})

it('fails closed and removes staging if the filesystem cannot publish without replacing', async () => {
  const { dir, projects } = await setup()
  const unavailable = Object.assign(new Error('Hard links unavailable'), { code: 'ENOTSUP' })
  vi.mocked(link).mockRejectedValueOnce(unavailable)

  await expect(projects.restore(archive)).rejects.toBe(unavailable)
  await expect(projects.get(archive.id)).resolves.toBeNull()
  await expect(readdir(dir)).resolves.toEqual([])
})

it('holds the fresh parent queue while publishing its dependent assets', async () => {
  const { projects } = await setup()
  const dependencies = checkpoint()
  const prepare = vi.fn(async () => {
    dependencies.entered.resolve()
    await dependencies.release.promise
    return true
  })
  const restoring = projects.restore(archive, prepare)
  const first = await Promise.race([
    dependencies.entered.promise.then(() => 'dependencies'),
    restoring.then(() => 'project'),
  ])
  try {
    expect(first).toBe('dependencies')
    const competingSave = expect(projects.put({ id: archive.id, title: 'Concurrent local draft' })).rejects.toMatchObject({ status: 409 })
    dependencies.release.resolve()
    const restored = await restoring
    expect(restored).toMatchObject({ id: archive.id, title: archive.title })
    await competingSave
    await expect(projects.get(archive.id)).resolves.toEqual(restored)
    await expect(projects.restore(archive, prepare)).resolves.toBeNull()
    expect(prepare).toHaveBeenCalledTimes(1)
  } finally {
    dependencies.release.resolve()
    await restoring
  }
})

import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import type { Doc } from '../../src/core/types'
import { projectCollection } from '../../server/projectStore'
import { projectHistoryRestore, type VersionSnapshot } from '../../server/projectHistoryRestore'

const archive = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-history.zip', import.meta.url))
const sourceParentPath = 'projects/history-project.json'
const sourceVersionPath = 'versions/history-project/100-fixture.json'
async function fixture(run: (environment: {
  root: string; versionsDir: string; projects: ReturnType<typeof projectCollection<Doc>>
  sourceParent: Doc; snapshot: VersionSnapshot; history: ReturnType<typeof projectHistoryRestore>
}) => Promise<void>) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'xiumi-history-restore-'))
  try {
    const zip = await JSZip.loadAsync(await readFile(archive))
    const sourceParent = JSON.parse(await zip.file(sourceParentPath)!.async('string')) as Doc
    const snapshot = JSON.parse(await zip.file(sourceVersionPath)!.async('string')) as VersionSnapshot
    const projects = projectCollection<Doc>(join(root, 'projects'))
    const versionsDir = join(root, 'versions')
    await mkdir(versionsDir)
    const history = projectHistoryRestore(versionsDir, projects)
    await run({ root, versionsDir, projects, sourceParent, snapshot, history })
  } finally { await rm(root, { recursive: true, force: true }) }
}
const historyPath = (root: string, snapshot: VersionSnapshot) => join(root, snapshot.projectId, snapshot.id + '.json')

it('preserves an actual upstream history record under its exactly restored parent and supplies idempotent collision results', () => fixture(async ({ versionsDir, projects, sourceParent, snapshot, history }) => {
  const parent = await projects.restore(sourceParent)
  expect(parent).not.toBeNull()
  const request = { sourceParent, parentRevision: parent!.revision, version: snapshot }
  await expect(history.restore(request)).resolves.toBe('restored')
  const target = historyPath(versionsDir, snapshot)
  expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(snapshot)
  await expect(history.restore(request)).resolves.toBe('occupied')
  await expect(projects.get(sourceParent.id)).resolves.toEqual(parent)
  expect(await readdir(versionsDir)).toEqual([sourceParent.id])
}))

it('preserves an occupied, unreadable existing history file', () => fixture(async ({ versionsDir, projects, sourceParent, snapshot, history }) => {
  const parent = (await projects.restore(sourceParent))!
  await mkdir(join(versionsDir, sourceParent.id))
  const target = historyPath(versionsDir, snapshot)
  await writeFile(target, 'Existing incomplete local bytes')
  await expect(history.restore({ sourceParent, parentRevision: parent.revision, version: snapshot })).resolves.toBe('occupied')
  expect(await readFile(target, 'utf8')).toBe('Existing incomplete local bytes')
}))

it('does not attach history to a different same-ID project or to the parent after it changed or was removed', () => fixture(async ({ versionsDir, projects, sourceParent, snapshot, history }) => {
  const draft = (await projects.restore({ ...sourceParent, title: 'Unrelated current project' }))!
  await expect(history.restore({ sourceParent, parentRevision: draft.revision, version: snapshot })).resolves.toBe('parent-unavailable')
  await projects.remove(sourceParent.id)
  const restored = (await projects.restore(sourceParent))!
  await projects.put({ ...restored, title: 'Updated by the owner' })
  await expect(history.restore({ sourceParent, parentRevision: restored.revision, version: snapshot })).resolves.toBe('parent-unavailable')
  await projects.remove(sourceParent.id)
  await expect(history.restore({ sourceParent, parentRevision: restored.revision, version: snapshot })).resolves.toBe('parent-unavailable')
  expect(await readdir(versionsDir)).toEqual([])
}))

it('never evicts other history when reaching current per-project retention limit', () => fixture(async ({ versionsDir, projects, sourceParent, snapshot, history }) => {
  const parent = (await projects.restore(sourceParent))!
  const projectDir = join(versionsDir, sourceParent.id)
  await mkdir(projectDir)
  const live = Array.from({length:50}, (_, index) => 'local-' + index + '.json')
  for (const name of live) await writeFile(join(projectDir, name), name)
  await expect(history.restore({ sourceParent, parentRevision: parent.revision, version: snapshot })).resolves.toBe('retention-limit')
  expect((await readdir(projectDir)).sort()).toEqual(live.sort())
}))

it('rejects a child snapshot before touching disk if the version points to another parent', () => fixture(async ({ versionsDir, projects, sourceParent, snapshot, history }) => {
  const parent = (await projects.restore(sourceParent))!
  await expect(history.restore({ sourceParent, parentRevision: parent.revision, version: { ...snapshot, doc: { ...snapshot.doc, id: 'other' } } })).rejects.toMatchObject({ status: 400 })
  expect(await readdir(versionsDir)).toEqual([])
}))

it('attaches to a content-identical local legacy parent without rewriting its bytes', () => fixture(async ({ root, projects, sourceParent, snapshot, history }) => {
  const file = join(root, 'projects', sourceParent.id + '.json')
  const original = JSON.stringify(sourceParent, null, 2) + '\n'
  await writeFile(file, original)
  const parent = await projects.get(sourceParent.id)
  expect(parent?.revision).toMatch(/^legacy-/)
  await expect(history.restore({ sourceParent, parentRevision: parent!.revision!, version: snapshot })).resolves.toBe('restored')
  expect(await readFile(file, 'utf8')).toBe(original)
}))

it.each(['edit', 'delete-and-recreate'] as const)('does not graft staged history after a concurrent parent %s', (operation) => fixture(async ({ versionsDir, projects, history }) => {
  const { stageLegacyTextProjects } = await import('../../server/legacyProjectRestore')
  const stage = await stageLegacyTextProjects(archive, {
    occupied: projects.occupied,
    async restore(doc) {
      const restored = (await projects.restore(doc as Doc))!
      if (operation === 'edit') await projects.put({ ...restored, title: 'Fresh edits' })
      else {
        await projects.remove(restored.id)
        await projects.restore({ ...restored, title: 'Replacement project' })
      }
      return restored
    },
  }, history)
  const key = 'history-project/100-fixture'
  expect((await stage.preview()).versions.add).toEqual([key])
  expect((await stage.apply()).versions).toEqual({ restored: [], skipped: [key], failed: [] })
  expect((await projects.get('history-project'))?.title).toBe(operation === 'edit' ? 'Fresh edits' : 'Replacement project')
  expect(await readdir(versionsDir)).toEqual([])
}))

it('queues behind an ordinary version write and leaves its same-id bytes intact', () => fixture(async ({ versionsDir, projects, sourceParent, snapshot, history }) => {
  const parent = (await projects.restore(sourceParent))!
  const projectDir = join(versionsDir, sourceParent.id)
  await mkdir(projectDir)
  const target = historyPath(versionsDir, snapshot)
  let enter!: () => void, unlock!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const release = new Promise<void>(resolve => { unlock = resolve })
  const ordinary = projects.serializeDependent(sourceParent.id, async () => {
    enter()
    await release
    await writeFile(target, 'Written by ordinary version POST queue', 'utf8')
  })
  await entered
  try {
    const restoring = history.restore({ sourceParent, parentRevision: parent.revision, version: snapshot })
    // The target must remain untouched while the normal writer holds the lock.
    expect(await readdir(projectDir)).toEqual([])
    unlock()
    await ordinary
    await expect(restoring).resolves.toBe('occupied')
    await expect(readFile(target, 'utf8')).resolves.toBe('Written by ordinary version POST queue')
  } finally {
    unlock()
    await ordinary
  }
}))

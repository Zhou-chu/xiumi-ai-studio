import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { collection } from '../../server/store'
import { projectCollection } from '../../server/projectStore'
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-cas-')); dirs.push(dir)
  return { dir, projects: projectCollection(dir) }
}
it('rejects stale and simultaneous saves without losing the winning content', async () => {
  const { projects } = await setup()
  const created = await projects.put({ id: 'a', title: 'base' })
  const results = await Promise.allSettled([
    projects.put({ ...created, title: 'winner' }), projects.put({ ...created, title: 'loser' }),
  ])
  expect(results.map(x => x.status)).toEqual(['fulfilled', 'rejected'])
  expect(results[1]).toMatchObject({ reason: { status: 409 } })
  expect((await projects.get('a'))?.title).toBe('winner')
})
it('reads legacy documents without rewriting, upgrades on versioned save, and rejects old clients', async () => {
  const { dir, projects } = await setup()
  await collection<{ id: string; title: string }>(dir).put({ id: 'old', title: 'legacy' })
  const loaded = await projects.get('old')
  expect(loaded?.revision).toEqual(expect.any(String))
  await expect(projects.put({ id: 'old', title: 'blind' })).rejects.toMatchObject({ status: 409 })
  const saved = await projects.put({ ...loaded!, title: 'upgraded' })
  expect(saved.revision).not.toBe(loaded?.revision)
  await expect(projects.put({ ...loaded!, title: 'stale legacy' })).rejects.toMatchObject({ status: 409 })
})
it('does not resurrect a deleted project with a stale version', async () => {
  const { projects } = await setup()
  const created = await projects.put({ id: 'a', title: 'base' })
  await projects.remove('a')
  await expect(projects.put(created)).rejects.toMatchObject({ status: 409 })
  expect(await projects.get('a')).toBeNull()
})

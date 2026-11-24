import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stageLegacyProjects } from '../../server/legacyProjectRestore'
import { projectCollection } from '../../server/projectStore'

const archive = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-library.zip', import.meta.url))
describe('upstream library project recovery', () => {
  it('previews read-only and rechecks collisions before restoring an absent project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xiumi-legacy-projects-'))
    try {
      const projects = projectCollection(dir)
      await writeFile(join(dir, 'corrupt.json'), 'Interrupted disk write')
      const stage = await stageLegacyProjects(archive, projects)
      await expect(stage.preview()).resolves.toEqual({
        add: ['archived', 'edited'],
        skip: ['corrupt'],
        notRestoredByProjectStage: ['assets/_index.json', 'assets/fixture-image.png', 'settings.json', 'templates/fixture-template.json'],
      })
      await expect(readdir(dir)).resolves.toEqual(['corrupt.json'])
      const local = await projects.put({ id: 'edited', title: 'Edit after preview' })
      await expect(stage.apply()).resolves.toEqual({ restored: ['archived'], skipped: ['corrupt', 'edited'] })
      await expect(stage.apply()).rejects.toThrow('恢复计划已使用')
      await expect(projects.get('edited')).resolves.toEqual(local)
      await expect(readFile(join(dir, 'corrupt.json'), 'utf8')).resolves.toBe('Interrupted disk write')
      const restored = await projects.get('archived')
      expect(restored).toMatchObject({ id: 'archived', blocks: expect.any(Array), title: 'Backup archived', updatedAt: 1, revision: expect.any(String) })
      expect(restored?.revision).not.toBe('fixture-old-revision')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('binds confirmation to the archive read at staging time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xiumi-legacy-projects-'))
    const copy = join(dir, 'source.zip')
    try {
      await copyFile(archive, copy)
      const projects = projectCollection(dir)
      const stage = await stageLegacyProjects(copy, projects)
      await stage.preview()
      await writeFile(copy, 'Not a ZIP')
      await expect(stageLegacyProjects(copy, projects)).rejects.toMatchObject({ status: 400 })
      await expect(stage.apply()).resolves.toEqual({ restored: ['archived', 'corrupt', 'edited'], skipped: [] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('applies finite parsing budgets without modifying the destination', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xiumi-legacy-projects-'))
    try {
      await expect(stageLegacyProjects(archive, projectCollection(dir), { maxEntries: 2 })).rejects.toMatchObject({ status: 413 })
      await expect(stageLegacyProjects(archive, projectCollection(dir), { maxNameBytes: 32 })).rejects.toMatchObject({ status: 413 })
      await expect(readdir(dir)).resolves.toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

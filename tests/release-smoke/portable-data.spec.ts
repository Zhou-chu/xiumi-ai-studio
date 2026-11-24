import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { exercisePortable } from './portable'

async function saveProject(request: APIRequestContext, origin: string, id: string, title: string) {
  const now = Date.now()
  const result = await request.put(`${origin}/api/projects/${id}`, { data: {
    id, title, author: '', digest: '', themeId: 'minimal-magazine',
    createdAt: now, updatedAt: now, blocks: [],
  } })
  expect(result.ok()).toBe(true)
  const { revision } = await result.json()
  expect(revision).toEqual(expect.any(String))
  return revision as string
}

test('sealed EXE reopens its default AppData library across fresh extractions without touching old data', async ({ request }) => {
  const root = process.env.XIUMI_PORTABLE_ROOT
  test.skip(!root, 'Only the extracted Windows package is tested here')
  if (!root) return
  const second = process.env.XIUMI_PORTABLE_SECOND_ROOT
  if (!second) throw new Error('A second independent extraction of the same sealed package is required')
  expect((await realpath(root)).toLowerCase()).not.toBe((await realpath(second)).toLowerCase())
  test.setTimeout(90_000)
  const scratch = await mkdtemp(join(tmpdir(), 'xiumi-portable-continuity-'))
  const primary = join(scratch, 'synthetic profile first', 'Local')
  const other = join(scratch, 'synthetic profile second', 'Local')
  // Pass the runner's original spelling to the EXE (it may be DOS 8.3),
  // but check persistence through the canonical path to the same fixture.
  const defaults = join(await realpath(scratch), 'synthetic profile first', 'Local', 'XIUMI AI Studio')
  const configured = join(scratch, 'explicit data')
  const oldData = join(root, 'app', 'data')
  const oldSentinel = join(oldData, 'leave-unchanged.txt')
  const defaultId = 'portable-default'
  const customId = 'portable-custom'
  const defaultTitle = '默认数据目录验收'
  const customTitle = '自定义数据目录验收'
  try {
    await expect(lstat(oldData)).rejects.toMatchObject({ code: 'ENOENT' })
    await mkdir(oldData)
    await writeFile(oldSentinel, 'Old extracted application data remains in place.')
    let defaultRevision: string | undefined
    await exercisePortable(root, undefined, async origin => {
      defaultRevision = await saveProject(request, origin, defaultId, defaultTitle)
      const disk = JSON.parse(await readFile(join(defaults, 'projects', defaultId + '.json'), 'utf8'))
      expect(disk).toMatchObject({ id: defaultId, title: defaultTitle, revision: defaultRevision })
    }, scratch, primary)

    await exercisePortable(second, undefined, async origin => {
      const saved = await request.get(`${origin}/api/projects/${defaultId}`)
      expect(saved.ok()).toBe(true)
      expect(await saved.json()).toMatchObject({ id: defaultId, title: defaultTitle, revision: defaultRevision })
    }, scratch, primary)

    await exercisePortable(second, undefined, async origin => {
      expect((await request.get(`${origin}/api/projects/${defaultId}`)).status()).toBe(404)
      expect((await lstat(join(other, 'XIUMI AI Studio', 'projects'))).isDirectory()).toBe(true)
    }, scratch, other)

    let revision: string | undefined
    await exercisePortable(root, configured, async origin => {
      expect((await request.get(`${origin}/api/projects/${defaultId}`)).status()).toBe(404)
      revision = await saveProject(request, origin, customId, customTitle)
      const disk = JSON.parse(await readFile(join(configured, 'projects', customId + '.json'), 'utf8'))
      expect(disk).toMatchObject({ id: customId, title: customTitle, revision })
    }, scratch, 'relative-unused-profile')
    await exercisePortable(second, configured, async origin => {
      const saved = await request.get(`${origin}/api/projects/${customId}`)
      expect(saved.ok()).toBe(true)
      expect(await saved.json()).toMatchObject({ id: customId, title: customTitle, revision })
    }, scratch, primary)
    await expect(lstat(join(defaults, 'projects', customId + '.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(oldData, 'projects'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(second, 'app', 'data'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(oldSentinel, 'utf8')).toBe('Old extracted application data remains in place.')
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
  }
})

test('sealed EXE refuses a relative default profile and a redirected application directory', async () => {
  const root = process.env.XIUMI_PORTABLE_ROOT
  test.skip(!root, 'Only the extracted Windows package is tested here')
  if (!root) return
  const scratch = await mkdtemp(join(tmpdir(), 'xiumi-portable-profile-validation-'))
  const launch = async (local: string, stage: 'profile-path' | 'application-directory-preflight') => {
    const mustNotStart = async () => { throw new Error('Launcher unexpectedly used an invalid default path') }
    await expect(exercisePortable(root, undefined, mustNotStart, scratch, local))
      .rejects.toThrow('Packaged EXE exited before ready (exit 1, AppData ' + stage + ')')
  }
  try {
    await launch('relative-profile', 'profile-path')
    await launch(scratch[0] + ':drive-relative-profile', 'profile-path')
    await launch(scratch + '\\dot-subdir\\..\\profile', 'profile-path')
    await launch(join(scratch, 'profile:stream'), 'profile-path')
    await launch(join(scratch, 'profile.'), 'profile-path')
    await launch(join(scratch, 'profile '), 'profile-path')
    const profile = join(scratch, 'local profile'), target = join(scratch, 'junction target')
    await mkdir(profile)
    await mkdir(target)
    await symlink(target, join(profile, 'XIUMI AI Studio'), 'junction')
    await launch(profile, 'application-directory-preflight')
    await expect(lstat(join(target, 'projects'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
  }
})

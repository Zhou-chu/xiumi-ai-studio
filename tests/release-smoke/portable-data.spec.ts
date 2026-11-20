import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
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

test('unpacked EXE isolates its default project directory from a configured directory and reopens the saved project', async ({ request }) => {
  const root = process.env.XIUMI_PORTABLE_ROOT
  test.skip(!root, 'Only the extracted Windows package is tested here')
  if (!root) return
  test.setTimeout(75_000)
  const defaults = join(root, 'app', 'data')
  await expect(lstat(defaults)).rejects.toMatchObject({ code: 'ENOENT' })
  const scratch = await mkdtemp(join(tmpdir(), 'xiumi-portable-continuity-'))
  const configured = join(scratch, 'configured')
  const defaultId = 'portable-default'
  const customId = 'portable-custom'
  const defaultTitle = '默认数据目录验收'
  const customTitle = '自定义数据目录验收'
  try {
    await exercisePortable(root, undefined, async origin => {
      const revision = await saveProject(request, origin, defaultId, defaultTitle)
      const disk = JSON.parse(await readFile(join(defaults, 'projects', `${defaultId}.json`), 'utf8'))
      expect(disk).toMatchObject({ id: defaultId, title: defaultTitle, revision })
    }, scratch)

    let revision: string | undefined
    await exercisePortable(root, configured, async origin => {
      expect((await request.get(`${origin}/api/projects/${defaultId}`)).status()).toBe(404)
      revision = await saveProject(request, origin, customId, customTitle)
      const disk = JSON.parse(await readFile(join(configured, 'projects', `${customId}.json`), 'utf8'))
      expect(disk).toMatchObject({ id: customId, title: customTitle, revision })
    }, scratch)

    await exercisePortable(root, configured, async origin => {
      const saved = await request.get(`${origin}/api/projects/${customId}`)
      expect(saved.ok()).toBe(true)
      expect(await saved.json()).toMatchObject({ id: customId, title: customTitle, revision })
      expect((await request.get(`${origin}/api/projects/${defaultId}`)).status()).toBe(404)
    }, scratch)
    await expect(lstat(join(defaults, 'projects', `${customId}.json`))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
  }
})

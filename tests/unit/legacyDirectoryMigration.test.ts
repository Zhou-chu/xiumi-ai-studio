import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { createLegacyDirectoryPreview } from '../../server/legacyDirectoryMigration'

const fixturePath = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-library.zip', import.meta.url))
const fakeEnv = 'WECHAT_APPSECRET=synthetic-not-a-token\n'

async function fixture(run: (root: string, source: string, target: string) => Promise<void>) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'xiumi-migration-preview-'))
  try {
    const source = join(root, 'legacy'), target = join(root, 'current')
    await mkdir(source)
    await mkdir(target)
    await run(root, source, target)
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function file(root: string, rel: string, data: string | Buffer = 'fixture') {
  const path = join(root, rel)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, data)
}

it('inventories actual upstream-writer contents in a legacy checkout without changing either directory', () => fixture(async (_root, source, target) => {
  const zip = await JSZip.loadAsync(await readFile(fixturePath))
  const entries = Object.values(zip.files).filter(entry => !entry.dir && entry.name !== 'xiumi-backup.json')
  const data = join(source, 'data')
  for (const entry of entries) await file(data, entry.name, await entry.async('nodebuffer'))
  await file(source, '.env', fakeEnv)
  await file(data, 'versions/archived/revision-1.json')
  await file(data, 'components/old-component.json')
  await file(data, 'themes/old-theme.json')
  await file(data, 'cache/ignored.json')
  await file(target, 'projects/edited.json', 'incomplete local project')
  const preview = createLegacyDirectoryPreview({ configuredSource: source, target }).preview
  const result = await preview()
  expect(result).toEqual({
    sourceLayout: 'checkout', mode: 'metadata-only',
    categories: {
      projects: { available: 2, occupied: 1, blocked: 0 },
      versions: { available: 1, occupied: 0, blocked: 0 },
      templates: { available: 1, occupied: 0, blocked: 0 },
      components: { available: 1, occupied: 0, blocked: 0 },
      themes: { available: 1, occupied: 0, blocked: 0 },
      assets: { available: 1, occupied: 0, blocked: 0 },
    },
    metadata: { settingsDetected: true, wechatEnvDetected: true, assetIndexDetected: true },
  })
  expect(JSON.stringify(result)).not.toContain(source)
  expect(JSON.stringify(result)).not.toContain('synthetic-not-a-token')
  expect(await readdir(target)).toEqual(['projects'])
  expect(await readFile(join(target, 'projects/edited.json'), 'utf8')).toBe('incomplete local project')
  for (const entry of entries) expect(await readFile(join(data, entry.name))).toEqual(await entry.async('nodebuffer'))
  expect(await readFile(join(source, '.env'), 'utf8')).toBe(fakeEnv)
}))

it('accepts a direct data root but never probes unspecified parent configuration', () => fixture(async (_root, source, target) => {
  await file(source, '.env', fakeEnv)
  const data = join(source, 'data')
  await file(data, 'projects/legacy.json')
  const { preview } = createLegacyDirectoryPreview({ configuredSource: data, target })
  const result = await preview()
  expect(result.sourceLayout).toBe('data')
  expect(result.metadata.wechatEnvDetected).toBe(false)
  expect(result.categories.projects.available).toBe(1)
}))

it('disables preview until an explicit local source is configured and rejects overlapping or unrelated roots', () => fixture(async (_root, source, target) => {
  await expect(createLegacyDirectoryPreview({ configuredSource: undefined, target }).preview()).rejects.toMatchObject({ status: 403 })
  await expect(createLegacyDirectoryPreview({ configuredSource: '//not-a-local-share/data', target }).preview()).rejects.toMatchObject({ status: 400 })
  await expect(createLegacyDirectoryPreview({ configuredSource: source, target }).preview()).rejects.toMatchObject({ status: 400 })
  await file(source, 'projects/project.json')
  await expect(createLegacyDirectoryPreview({ configuredSource: source, target: source }).preview()).rejects.toMatchObject({ status: 400 })
  const nested = join(source, 'nested')
  await mkdir(nested)
  await expect(createLegacyDirectoryPreview({ configuredSource: source, target: nested }).preview()).rejects.toMatchObject({ status: 400 })
}))

it('does not enumerate redirected source categories or resolve redirected destination category entries', () => fixture(async (root, source, target) => {
  const other = join(root, 'other')
  await file(other, 'fixture.json')
  await symlink(other, join(source, 'templates'), 'junction')
  await symlink(other, join(target, 'projects'), 'junction')
  await file(source, 'projects/fixture.json')
  const result = await createLegacyDirectoryPreview({ configuredSource: source, target }).preview()
  expect(result.categories.templates).toEqual({ available: 0, occupied: 0, blocked: 0 })
  expect(result.categories.projects).toEqual({ available: 0, occupied: 0, blocked: 1 })
  expect(await readdir(other)).toEqual(['fixture.json'])
}))

it('counts all enumerated entries against the limit and honors cancellation before scanning', () => fixture(async (_root, source, target) => {
  await file(source, 'projects/one.json')
  await file(source, 'projects/not-a-project.txt')
  const { preview } = createLegacyDirectoryPreview({ configuredSource: source, target, maxEntries: 1 })
  await expect(preview()).rejects.toMatchObject({ status: 413 })
  const controller = new AbortController()
  controller.abort()
  await expect(preview(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(await readdir(target)).toEqual([])
}))

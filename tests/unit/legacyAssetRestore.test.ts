import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import { stageLegacyLibrary } from '../../server/legacyProjectRestore'

const regression = vi.hoisted(() => ({ indexWritesBeforeFailure: -1, forbidIndexTempRemoval: false, indexTempRemovalCalls: 0, onArchiveMediaRemoval: undefined as (() => void) | undefined }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async rename(...args: Parameters<typeof actual.rename>) {
      if (typeof args[1] === 'string' && args[1].endsWith('_index.json') && regression.indexWritesBeforeFailure-- === 0) {
        regression.indexWritesBeforeFailure = -1
        throw Object.assign(new Error('Asset index unavailable'), { code: 'ENOSPC' })
      }
      return actual.rename(...args)
    },
    async rm(...args: Parameters<typeof actual.rm>) {
      if (typeof args[0] === 'string' && /_index\.json\..*\.tmp$/.test(args[0])) {
        regression.indexTempRemovalCalls++
        if (regression.forbidIndexTempRemoval) throw new Error('Post-rename cleanup denied')
      }
      if (typeof args[0] === 'string' && /[\\/]fixture-image\.png$/.test(args[0])) regression.onArchiveMediaRemoval?.()
      return actual.rm(...args)
    },
  }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const archive = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-library.zip', import.meta.url))
async function isolated(test: (context: Awaited<ReturnType<typeof modules>>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-legacy-assets-'))
  vi.stubEnv('DATA_DIR', root)
  vi.resetModules()
  try {
    await test(await modules(root))
  } finally {
    regression.indexWritesBeforeFailure = -1
    regression.forbidIndexTempRemoval = false
    regression.indexTempRemovalCalls = 0
    regression.onArchiveMediaRemoval = undefined
    vi.unstubAllEnvs()
    await rm(root, { force: true, recursive: true })
  }
}
async function modules(root: string) {
  const { DIRS } = await import('../../server/store')
  for (const key of Object.keys(DIRS) as Array<keyof typeof DIRS>) {
    DIRS[key] = join(root, key)
    await mkdir(DIRS[key], { recursive: true })
  }
  const { projectCollection } = await import('../../server/projectStore')
  const assets = await import('../../server/assets')
  const projects = projectCollection(DIRS.projects)
  const zip = await JSZip.loadAsync(await readFile(archive))
  const expectedImage = await zip.file('assets/fixture-image.png')!.async('nodebuffer')
  return { root, assets, projects, assetsDir: DIRS.assets, expectedImage }
}

it('restores the old indexed image byte-for-byte alongside an active upload', () => isolated(async ({ assets, projects, assetsDir, expectedImage }) => {
  const stage = await stageLegacyLibrary(archive, projects, assets.assetRestoreStore)
  expect(await stage.preview()).toMatchObject({
    assets: { add: ['fixture-image'], skip: [] },
    notRestored: ['settings.json', 'templates/fixture-template.json'],
  })
  await expect(readdir(assetsDir)).resolves.toEqual([])
  const [upload, result] = await Promise.all([assets.saveAsset(expectedImage, 'My new image'), stage.apply()])
  expect(result.assets).toEqual({ restored: ['fixture-image'], skipped: [], failed: [], alreadyPresent: [] })
  await expect(readFile(join(assetsDir, 'fixture-image.png'))).resolves.toEqual(expectedImage)
  const doc = await projects.get('archived')
  const image = doc?.blocks[0].props.image
  expect(image).toMatchObject({ assetId: 'fixture-image', src: '/media/fixture-image.png' })
  const mediaFile = await assets.variantPath(image.src.slice('/media/'.length), undefined, 2400)
  await expect(readFile(mediaFile)).resolves.toEqual(expectedImage)
  expect(await assets.listAssets()).toEqual(expect.arrayContaining([
    upload,
    expect.objectContaining({ id: 'fixture-image', width: 1, height: 1, size: expectedImage.length }),
  ]))
}))

it('rechecks an intervening file collision and preserves an unindexed existing asset', () => isolated(async ({ assets, projects, assetsDir }) => {
  const stage = await stageLegacyLibrary(archive, projects, assets.assetRestoreStore)
  expect((await stage.preview()).assets.add).toEqual(['fixture-image'])
  const file = join(assetsDir, 'fixture-image.png')
  await writeFile(file, 'Existing local bytes')
  expect(await stage.apply()).toMatchObject({
    assets: { restored: [], skipped: ['fixture-image'], failed: [] },
    projects: { notAttempted: ['archived', 'corrupt', 'edited'] },
  })
  await expect(readFile(file, 'utf8')).resolves.toBe('Existing local bytes')
  await expect(assets.listAssets()).resolves.toEqual([])
}))

it('reports an index write failure, cleans only the new binary and blocks project writes', () => isolated(async ({ assets, projects, assetsDir, expectedImage }) => {
  const existing = await assets.saveAsset(expectedImage, 'Keep me')
  const stage = await stageLegacyLibrary(archive, projects, assets.assetRestoreStore)
  regression.indexWritesBeforeFailure = 0
  expect(await stage.apply()).toMatchObject({
    assets: { restored: [], skipped: [], failed: [{ id: 'fixture-image', cleanupFailed: false }] },
    projects: { restored: [], skipped: [], notAttempted: ['archived', 'corrupt', 'edited'] },
  })
  expect((await readdir(assetsDir)).sort()).toEqual(['_index.json', existing.file].sort())
  await expect(assets.listAssets()).resolves.toEqual([existing])
  await expect(projects.get('archived')).resolves.toBeNull()
}))

it('does not overwrite or reinterpret an unreadable active index', () => isolated(async ({ assets, projects, assetsDir }) => {
  const broken = join(assetsDir, '_index.json')
  await writeFile(broken, 'Interrupted index')
  const stage = await stageLegacyLibrary(archive, projects, assets.assetRestoreStore)
  await expect(stage.preview()).rejects.toThrow()
  expect((await stage.apply()).assets).toMatchObject({ restored: [], failed: [{ id: 'fixture-image' }] })
  await expect(readFile(broken, 'utf8')).resolves.toBe('Interrupted index')
  await expect(readdir(assetsDir)).resolves.toEqual(['_index.json'])
}))


it('keeps published index and original bytes when redundant post-rename cleanup is denied', () => isolated(async ({ assets, projects, assetsDir, expectedImage }) => {
  const stage = await stageLegacyLibrary(archive, projects, assets.assetRestoreStore)
  regression.forbidIndexTempRemoval = true
  expect((await stage.apply()).assets).toMatchObject({ restored: ['fixture-image'], failed: [] })
  expect(regression.indexTempRemovalCalls).toBe(0)
  await expect(readFile(join(assetsDir, 'fixture-image.png'))).resolves.toEqual(expectedImage)
  expect((await assets.listAssets()).map(({ id }) => id)).toEqual(['fixture-image'])
}))

it('serializes a queued asset deletion behind protected project publication', () => isolated(async ({ assets, projects, assetsDir }) => {
  const entered = deferred<void>()
  const release = deferred<void>()
  const actualRestore = projects.restore
  vi.spyOn(projects, 'restore').mockImplementationOnce(async doc => {
    entered.resolve()
    await release.promise
    return actualRestore(doc)
  })
  const stage = await stageLegacyLibrary(archive, projects, assets.assetRestoreStore)
  const restoring = stage.apply()
  await entered.promise
  const removing = deferred<'removing'>()
  regression.onArchiveMediaRemoval = () => removing.resolve('removing')
  const deletion = assets.deleteAsset('fixture-image')
  try {
    const earliest = await Promise.race([removing.promise, new Promise(resolve => setTimeout(resolve, 100, 'protected'))])
    expect(earliest).toBe('protected')
    expect(await readdir(assetsDir)).toContain('fixture-image.png')
  } finally {
    release.resolve()
    await Promise.all([restoring, deletion])
  }
  await expect(projects.get('archived')).resolves.toMatchObject({ id: 'archived' })
  await expect(assets.listAssets()).resolves.toEqual([])
}))

it('uses a new variant when the legacy filename is reused', () => isolated(async ({ assets, projects, assetsDir, expectedImage }) => {
  const file = join(assetsDir, 'fixture-image.png')
  const sharp = (await import('sharp')).default
  const older = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#f00' } }).png().toBuffer()
  await writeFile(file, older)
  const staleVariant = await assets.variantPath('fixture-image.png', '1:1', 64)
  await rm(file)
  const stage = await stageLegacyLibrary(archive, projects, assets.assetRestoreStore)
  expect((await stage.apply()).assets).toMatchObject({ restored: ['fixture-image'] })
  const actualVariant = await assets.variantPath('fixture-image.png', '1:1', 64)
  expect(actualVariant).not.toBe(staleVariant)
  expect(await sharp(await readFile(actualVariant)).raw().toBuffer()).not.toEqual(await sharp(await readFile(staleVariant)).raw().toBuffer())
  await expect(readFile(file)).resolves.toEqual(expectedImage)
}))


it('reuses an exact indexed and byte-identical image on retry without overwriting its local metadata', () => isolated(async ({ assets, projects, assetsDir, expectedImage }) => {
  const index = join(assetsDir, '_index.json')
  const media = join(assetsDir, 'fixture-image.png')
  const existing = { id: 'fixture-image', file: 'fixture-image.png', name: 'Local name', width: 1, height: 1, size: expectedImage.length, createdAt: 2 }
  await writeFile(media, expectedImage)
  await writeFile(index, JSON.stringify({ [existing.id]: existing }))
  const stage = await stageLegacyLibrary(archive, projects, assets.assetRestoreStore)
  expect((await stage.preview()).assets).toMatchObject({ add: [], skip: [], alreadyPresent: ['fixture-image'] })
  expect(await stage.apply()).toMatchObject({
    assets: { restored: [], alreadyPresent: ['fixture-image'], skipped: [] },
    projects: { restored: ['archived', 'corrupt', 'edited'] },
  })
  expect(await readFile(index, 'utf8')).toBe(JSON.stringify({ [existing.id]: existing }))
  await expect(assets.listAssets()).resolves.toEqual([existing])
}))

it('does not accept exact image bytes owned by two active index rows', () => isolated(async ({ assets, projects, assetsDir, expectedImage }) => {
  const existing = { id: 'fixture-image', file: 'fixture-image.png', name: 'Local name', width: 1, height: 1, size: expectedImage.length, createdAt: 2 }
  await writeFile(join(assetsDir, existing.file), expectedImage)
  await writeFile(join(assetsDir, '_index.json'), JSON.stringify({ [existing.id]: existing, alias: { ...existing, id: 'alias' } }))
  const stage = await stageLegacyLibrary(archive, projects, assets.assetRestoreStore)
  expect(await stage.apply()).toMatchObject({
    assets: { alreadyPresent: [], skipped: ['fixture-image'] },
    projects: { restored: [], notAttempted: ['archived', 'corrupt', 'edited'] },
  })
}))

it('does not publish projects with unresolved local media references', () => isolated(async ({ root, assets, projects }) => {
  const zip = await JSZip.loadAsync(await readFile(archive))
  zip.remove('assets')
  const input = join(root, 'no-media.zip')
  await writeFile(input, await zip.generateAsync({ type: 'nodebuffer' }))
  const stage = await stageLegacyLibrary(input, projects, assets.assetRestoreStore)
  expect((await stage.preview()).projects).toMatchObject({ missingMedia: ['archived'], add: ['corrupt', 'edited'] })
  expect((await stage.apply()).projects).toMatchObject({ missingMedia: ['archived'], restored: ['corrupt', 'edited'] })
  await expect(projects.get('archived')).resolves.toBeNull()
}))


it('resumes a partial two-image recovery from a fresh preview', () => isolated(async ({ root, assets, projects, assetsDir, expectedImage }) => {
  const zip = await JSZip.loadAsync(await readFile(archive))
  const index = JSON.parse(await zip.file('assets/_index.json')!.async('string'))
  index['second-image'] = { ...index['fixture-image'], id: 'second-image', file: 'second-image.png', name: 'Second' }
  zip.file('assets/_index.json', JSON.stringify(index)).file('assets/second-image.png', expectedImage)
  const input = join(root, 'two-images.zip')
  await writeFile(input, await zip.generateAsync({ type: 'nodebuffer' }))
  const first = await stageLegacyLibrary(input, projects, assets.assetRestoreStore)
  regression.indexWritesBeforeFailure = 1
  expect(await first.apply()).toMatchObject({
    assets: { restored: ['fixture-image'], failed: [{ id: 'second-image', cleanupFailed: false }] },
    projects: { restored: [], notAttempted: ['archived', 'corrupt', 'edited'] },
  })
  expect((await readdir(assetsDir)).sort()).toEqual(['_index.json', 'fixture-image.png'].sort())
  const retry = await stageLegacyLibrary(input, projects, assets.assetRestoreStore)
  expect((await retry.preview()).assets).toMatchObject({ add: ['second-image'], alreadyPresent: ['fixture-image'] })
  expect(await retry.apply()).toMatchObject({
    assets: { restored: ['second-image'], alreadyPresent: ['fixture-image'], failed: [] },
    projects: { restored: ['archived', 'corrupt', 'edited'] },
  })
}))

it('serves 70 warm real media requests without entering the saturated Sharp queue', () => isolated(async ({ assets, assetsDir, expectedImage }) => {
  await writeFile(join(assetsDir, 'warm.png'), expectedImage)
  const warm = await assets.variantPath('warm.png', '1:1', 64)
  const { withImageBudget } = await import('../../server/imageBudget')
  const ready = deferred<void>(), release = deferred<void>()
  const busy = withImageBudget(async () => {
    ready.resolve()
    await release.promise
  })
  await ready.promise
  const requests = Array.from({ length: 70 }, () => assets.variantPath('warm.png', '1:1', 64))
  try {
    await expect(Promise.all(requests)).resolves.toEqual(Array(70).fill(warm))
  } finally {
    release.resolve()
    await Promise.allSettled([busy, ...requests])
  }
}))

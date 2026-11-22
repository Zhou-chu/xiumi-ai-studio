import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'

test('owned built app rejects stale directory images and opens a freshly reviewed upstream manuscript', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-browser-'))
  const source = join(root, 'legacy')
  const projects = join(source, 'data', 'projects')
  const formerDir = process.env.DATA_DIR
  const formerNodeEnv = process.env.NODE_ENV
  let server: ReturnType<typeof createServer> | undefined
  try {
    await readFile(join(process.cwd(), 'dist', 'index.html'))
    const assets = join(source, 'data', 'assets')
    await mkdir(projects, { recursive: true })
    await mkdir(assets)
    const rasterLibrary = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-image-history.zip', import.meta.url)))
    const manuscript = await rasterLibrary.file('projects/visual-history.json')!.async('nodebuffer')
    const selected = await rasterLibrary.file('assets/current-only.png')!.async('nodebuffer')
    const replacement = await rasterLibrary.file('assets/history-only.png')!.async('nodebuffer')
    const assetIndex = await rasterLibrary.file('assets/_index.json')!.async('nodebuffer')
    const raster = join(assets, 'current-only.png')
    expect(replacement).toHaveLength(selected.length)
    expect(replacement).not.toEqual(selected)
    await writeFile(raster, selected)
    await writeFile(join(assets, 'history-only.png'), replacement)
    await writeFile(join(assets, '_index.json'), assetIndex)
    await writeFile(join(projects, 'visual-history.json'), manuscript)
    const zip = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-library.zip', import.meta.url)))
    const fixture = await zip.file('projects/edited.json')!.async('nodebuffer')
    await writeFile(join(projects, 'edited.json'), fixture)
    await writeFile(join(source, '.env'), 'TEST_SENTINEL=unchanged')
    const destination = join(root, 'new')
    process.env.DATA_DIR = destination
    process.env.NODE_ENV = 'production'
    const { createApp } = await import('../../server/app')
    server = createServer(createApp({ legacyMigrationSource: source })).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('isolated server not bound')
    const base = 'http://127.0.0.1:' + address.port
    const project = base + '/api/projects/edited'
    const visualProject = base + '/api/projects/visual-history'
    await page.goto(base)
    await page.getByTestId('tab-projects').click()
    const backup = page.getByRole('button', { name: '项目和素材备份', exact: true })
    if (!await backup.isVisible()) await page.getByTestId('toolbar-more').click()
    await backup.click()
    const modal = page.getByRole('dialog', { name: '项目和素材备份', exact: true })
    const migration = modal.getByRole('region', { name: '从本机旧目录迁移项目' })
    const preview = migration.getByRole('button', { name: '检测已配置旧目录' })
    const confirm = migration.getByRole('button', { name: '确认迁移项目' })
    await preview.click()
    await expect(migration.getByRole('status')).toContainText('尚未写入。预计新增 2')
    expect((await page.request.get(project)).status()).toBe(404)
    await migration.getByRole('button', { name: '取消目录迁移' }).click()
    await expect(confirm).toHaveCount(0)
    expect((await page.request.get(project)).status()).toBe(404)
    await preview.click()
    await expect(confirm).toBeEnabled()
    await writeFile(raster, replacement)
    expect(await readFile(join(projects, 'visual-history.json'))).toEqual(manuscript)
    await confirm.click()
    await expect(migration.getByRole('alert')).toContainText('目录已更改')
    expect(await readdir(join(destination, 'projects'))).toEqual([])
    expect(await readdir(join(destination, 'assets'))).toEqual([])
    expect((await page.request.get(visualProject)).status()).toBe(404)
    await preview.click()
    await expect(migration.getByRole('status')).toContainText('尚未写入。预计新增 2')
    await confirm.click()
    await expect(migration.getByRole('status')).toContainText('已新增 2')
    await modal.getByRole('button', { name: '关闭', exact: true }).last().click()
    const title = JSON.parse(fixture.toString('utf8')).title as string
    await page.getByRole('button', { name: title, exact: false }).click()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
    const visualTitle = JSON.parse(manuscript.toString('utf8')).title as string
    await page.getByRole('button', { name: visualTitle, exact: false }).click()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(visualTitle)
    const image = page.getByTestId('canvas').locator('img[src*="/media/current-only.png?"][src*="gen="]')
    await expect(image).toBeVisible()
    const { actual, expected } = await image.evaluate(async (node: HTMLImageElement, fixtureUrl) => {
      async function pixelsOf(input: HTMLImageElement) {
        await input.decode()
        const canvas = document.createElement('canvas')
        canvas.width = input.naturalWidth
        canvas.height = input.naturalHeight
        const context = canvas.getContext('2d')!
        context.drawImage(input, 0, 0)
        return [...context.getImageData(0, 0, canvas.width, canvas.height).data]
      }
      // Compare in the same decoder so transparent PNG browser rounding
      // isn't mistaken for a source pixel change.
      const reference = new Image()
      reference.src = fixtureUrl
      return { actual: await pixelsOf(node), expected: await pixelsOf(reference) }
    }, 'data:image/png;base64,' + replacement.toString('base64'))
    expect(actual).toHaveLength(16 * 12 * 4)
    expect(actual).toEqual(expected)
    expect((await readdir(join(destination, 'assets'))).sort()).toEqual(['_index.json', 'current-only.png'])
    expect(await readFile(raster)).toEqual(replacement)
    expect(await readFile(join(assets, '_index.json'))).toEqual(assetIndex)
    expect(await readFile(join(projects, 'edited.json'))).toEqual(fixture)
    expect(await readFile(join(source, '.env'), 'utf8')).toBe('TEST_SENTINEL=unchanged')
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    }
    if (formerDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = formerDir
    if (formerNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = formerNodeEnv
    await rm(root, { recursive: true, force: true })
  }
})

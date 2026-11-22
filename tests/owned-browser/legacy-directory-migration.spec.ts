import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'

test('owned built app rejects stale directory images and opens a freshly reviewed manuscript and history', async ({ page }) => {
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
    const historicalRaster = join(assets, 'history-only.png')
    const versions = join(source, 'data', 'versions', 'visual-history')
    const historicBytes = await rasterLibrary.file('versions/visual-history/visual.json')!.async('nodebuffer')
    await mkdir(versions, { recursive: true })
    await writeFile(join(versions, 'visual.json'), historicBytes)
    expect(replacement).toHaveLength(selected.length)
    expect(replacement).not.toEqual(selected)
    await writeFile(raster, selected)
    await writeFile(historicalRaster, replacement)
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
    const bootWrite = page.waitForResponse(response =>
      response.url().startsWith(base + '/api/projects/') && response.request().method() === 'PUT' && response.ok())
    await page.goto(base)
    await bootWrite
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    const storedProjects = join(destination, 'projects')
    async function projectFiles() {
      const names = (await readdir(storedProjects)).sort()
      return Promise.all(names.map(async name => ({ name, bytes: await readFile(join(storedProjects, name)) })))
    }
    const beforeMigration = await projectFiles()
    expect(beforeMigration).toHaveLength(1)
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
    expect(await projectFiles()).toEqual(beforeMigration)
    expect(await readdir(join(destination, 'assets'))).toEqual([])
    expect((await page.request.get(project)).status()).toBe(404)
    expect((await page.request.get(visualProject)).status()).toBe(404)
    await writeFile(raster, selected)
    await preview.click()
    await expect(migration.getByRole('status')).toContainText('历史版本预计新增 1')
    await writeFile(historicalRaster, selected)
    await confirm.click()
    await expect(migration.getByRole('alert')).toContainText('目录已更改')
    expect(await projectFiles()).toEqual(beforeMigration)
    expect(await readdir(join(destination, 'assets'))).toEqual([])
    expect(await readdir(join(destination, 'versions'))).toEqual([])
    expect((await page.request.get(visualProject)).status()).toBe(404)
    await writeFile(historicalRaster, replacement)
    await preview.click()
    await expect(migration.getByRole('status')).toContainText('历史版本预计新增 1')
    await confirm.click()
    await expect(migration.getByRole('status')).toContainText('已新增 2')
    await expect(migration.getByRole('status')).toContainText('历史版本已新增 1')
    await modal.getByRole('button', { name: '关闭', exact: true }).last().click()
    const title = JSON.parse(fixture.toString('utf8')).title as string
    await page.getByRole('button', { name: title, exact: false }).click()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
    const visualTitle = JSON.parse(manuscript.toString('utf8')).title as string
    await page.getByRole('button', { name: visualTitle, exact: false }).click()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(visualTitle)
    const image = page.getByTestId('canvas').locator('img[src*="/media/current-only.png?"][src*="gen="]')
    await expect(image).toBeVisible()
    const comparePixels = async (imageNode: typeof image, bytes: Buffer) => {
      const { actual, expected } = await imageNode.evaluate(async (node: HTMLImageElement, fixtureUrl) => {
        async function pixelsOf(input: HTMLImageElement) {
          await input.decode()
          const canvas = document.createElement('canvas')
          canvas.width = input.naturalWidth
          canvas.height = input.naturalHeight
          const context = canvas.getContext('2d')!
          context.drawImage(input, 0, 0)
          return [...context.getImageData(0, 0, canvas.width, canvas.height).data]
        }
        // Compare in one decoder to avoid transparent PNG rounding differences.
        const reference = new Image()
        reference.src = fixtureUrl
        return { actual: await pixelsOf(node), expected: await pixelsOf(reference) }
      }, 'data:image/png;base64,' + bytes.toString('base64'))
      expect(actual).toHaveLength(16 * 12 * 4)
      expect(actual).toEqual(expected)
    }
    await comparePixels(image, selected)
    const persisted = await readFile(join(destination, 'projects', 'visual-history.json'))
    const history = page.getByRole('button', { name: '历史版本', exact: true })
    if (!await history.isVisible()) await page.getByTestId('toolbar-more').click()
    await history.click()
    await page.getByRole('dialog', { name: '历史版本', exact: true }).locator('.list-row')
      .filter({ hasText: 'Historical indexed snapshot' }).getByRole('button', { name: '恢复', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('Historical indexed manuscript')
    const historicalImage = page.getByTestId('canvas').locator('img[src*="/media/history-only.png?"][src*="gen="]')
    await comparePixels(historicalImage, replacement)
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    await page.getByRole('button', { name: '撤销', exact: true }).focus()
    await page.keyboard.press('Control+z')
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(visualTitle)
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    await comparePixels(image, selected)
    const restored = JSON.parse((await readFile(join(destination, 'projects', 'visual-history.json'))).toString('utf8'))
    const original = JSON.parse(persisted.toString('utf8'))
    expect(restored.title).toBe(original.title)
    expect(restored.blocks).toEqual(original.blocks)
    expect((await readdir(join(destination, 'assets'))).sort()).toEqual(['_index.json', 'current-only.png', 'history-only.png'])
    expect(await readFile(raster)).toEqual(selected)
    expect(await readFile(historicalRaster)).toEqual(replacement)
    expect(await readFile(join(versions, 'visual.json'))).toEqual(historicBytes)
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

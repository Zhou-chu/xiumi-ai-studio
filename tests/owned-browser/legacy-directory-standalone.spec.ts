import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import sharp from 'sharp'

test('migrates an image-only old directory, inserts its restored thumbnail, and retains its pixels on reopen', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-assets-browser-'))
  const source = join(root, 'old')
  const target = join(root, 'target')
  const assets = join(source, 'assets')
  await mkdir(assets, { recursive: true })
  const zip = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-image-history.zip', import.meta.url)))
  const png = await zip.file('assets/history-only.png')!.async('nodebuffer')
  const alternate = await zip.file('assets/current-only.png')!.async('nodebuffer')
  const jpg = await sharp({ create: { width: 15, height: 10, channels: 3, background: '#2580a8' } }).jpeg().toBuffer()
  const catalog = JSON.parse(await zip.file('assets/_index.json')!.async('string'))
  const index = JSON.stringify({
    'history-only': catalog['history-only'],
    'old-jpeg': { id: 'old-jpeg', file: 'old-jpeg.jpg', name: 'Synthetic stored JPEG', width: 15, height: 10, size: jpg.length, createdAt: 10 },
  })
  const sourceImage = join(assets, 'history-only.png')
  await writeFile(join(assets, '_index.json'), index)
  await writeFile(sourceImage, png)
  await writeFile(join(assets, 'old-jpeg.jpg'), jpg)
  const child = fork('tests/fixtures/start-owned-directory-migration.ts', [source, target], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  const exited = once(child, 'exit')
  try {
    const [port] = await Promise.race([once(child, 'message'), exited.then(() => { throw Error('Test server failed to start') })])
    const base = 'http://127.0.0.1:' + port
    const sent = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().startsWith(base + '/api/projects/') && response.ok())
    await page.goto(base)
    await sent
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    const files = join(target, 'projects')
    const initialNames = await readdir(files)
    expect(initialNames).toHaveLength(1)
    const initial = await readFile(join(files, initialNames[0]))
    await page.getByTestId('tab-projects').click()
    const backup = page.getByRole('button', { name: '项目和素材备份', exact: true })
    if (!await backup.isVisible()) await page.getByTestId('toolbar-more').click()
    await backup.click()
    const dialog = page.getByRole('dialog', { name: '项目和素材备份' })
    const section = dialog.getByRole('region', { name: '从本机旧目录迁移项目' })
    const optIn = section.getByLabel('独立迁移旧素材库中已索引的 PNG/JPEG')
    const detect = section.getByRole('button', { name: '检测已配置旧目录' })
    await expect(optIn).not.toBeChecked()
    await detect.click()
    await expect(section.getByRole('status')).toContainText('预计新增 0')
    await expect(section.getByRole('button', { name: '确认迁移项目' })).toBeDisabled()
    await section.getByRole('button', { name: '取消目录迁移' }).click()
    await optIn.check()
    await detect.click()
    await expect(section.getByRole('status')).toContainText('独立素材预计新增 2')
    const confirm = section.getByRole('button', { name: '确认迁移素材' })
    await expect(confirm).toBeEnabled()
    expect(alternate).toHaveLength(png.length)
    expect(alternate).not.toEqual(png)
    await writeFile(sourceImage, alternate)
    await confirm.click()
    await expect(section.getByRole('alert')).toContainText('目录已更改')
    expect(await readdir(join(target, 'assets'))).toEqual([])
    expect(await readFile(join(files, initialNames[0]))).toEqual(initial)
    await writeFile(sourceImage, png)
    await detect.click()
    await expect(section.getByRole('status')).toContainText('独立素材预计新增 2')
    await confirm.click()
    await expect(section.getByRole('status')).toContainText('独立素材已新增 2')
    expect(await readFile(join(files, initialNames[0]))).toEqual(initial)
    expect(await readdir(source)).toEqual(['assets'])
    expect(await readFile(sourceImage)).toEqual(png)
    expect(await readFile(join(assets, '_index.json'), 'utf8')).toBe(index)
    expect(await readFile(join(assets, 'old-jpeg.jpg'))).toEqual(jpg)
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()

    await page.getByRole('button', { name: '新建空白项目' }).click()
    const title = 'Reopened old-directory indexed image'
    await page.getByRole('textbox', { name: '文章标题' }).fill(title)
    await page.getByTestId('tab-assets').click()
    await expect(page.locator('.asset img[src*="/media/old-jpeg.jpg?"][src*="gen="]')).toBeVisible()
    await page.locator('.asset img[src*="/media/history-only.png?"][src*="gen="]').click()
    const rendered = page.getByTestId('canvas').locator('img[src*="/media/history-only.png?"][src*="gen="]')
    await expect(rendered).toBeVisible()
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    await page.reload()
    await page.getByTestId('tab-projects').click()
    await page.getByRole('button', { name: title, exact: false }).click()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
    await expect.poll(() => rendered.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([16, 12])
    const pixels = await rendered.evaluate(async (node: HTMLImageElement, reference) => {
      async function get(image: HTMLImageElement) {
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image, 0, 0)
        return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data]
      }
      const original = new Image()
      original.src = reference
      return { actual: await get(node), expected: await get(original) }
    }, 'data:image/png;base64,' + png.toString('base64'))
    expect(pixels.actual).toEqual(pixels.expected)
    const src = await rendered.getAttribute('src')
    const response = await page.request.get(new URL(src!, base).toString())
    expect(response.ok()).toBe(true)
    const raster = await sharp(await response.body()).ensureAlpha().raw().toBuffer()
    expect(raster).toEqual(Buffer.from(Array.from({ length: 16 * 12 }, () => [52, 84, 219, 128]).flat()))
  } finally {
    if (child.connected) child.disconnect()
    await exited
    await rm(root, { recursive: true, force: true })
  }
})

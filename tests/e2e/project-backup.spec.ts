import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import sharp from 'sharp'

test('downloads the current saved project and local assets without configuration', async ({ page }) => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer()
  const response = await page.request.post('/api/assets', {
    multipart: { files: { name: 'backup-test-figure.png', mimeType: 'image/png', buffer: png } },
  })
  expect(response.ok()).toBe(true)
  const [{ id, file }] = await response.json()
  await page.goto('/')
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button', { name: '新建空白项目' }).click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await page.getByRole('textbox', { name: '文章标题' }).fill('本地备份的最新文稿')
  const menu = page.getByTestId('toolbar-more')
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: '项目和素材备份' }).click()
  const dialog = page.getByRole('dialog', { name: '项目和素材备份' })
  await expect(dialog).toContainText('不包含历史版本')
  const gettingDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载 ZIP 备份' }).click()
  const download = await gettingDownload
  expect(download.suggestedFilename()).toMatch(/^xiumi-projects-\d{4}-\d{2}-\d{2}\.zip$/)
  const zip = await JSZip.loadAsync(await readFile((await download.path())!))
  const docs = await Promise.all(zip.file(/^projects\/.*\.json$/).map(entry => entry.async('string').then(value => JSON.parse(value))))
  expect(docs.some(doc => doc.title === '本地备份的最新文稿')).toBe(true)
  const index = JSON.parse(await zip.file('assets/_index.json')!.async('string'))
  expect(index[id].file).toBe(file)
  expect((await zip.file(`assets/${file}`)!.async('uint8array')).byteLength).toBeGreaterThan(0)
  expect(zip.file('settings.json')).toBe(null)
  expect(zip.file('.env')).toBe(null)
})

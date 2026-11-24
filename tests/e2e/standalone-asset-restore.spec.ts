import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import sharp from 'sharp'
import type { Asset } from '../../src/editor/api'

async function downloadIndependentAssetLibrary() {
  const child = fork('tests/fixtures/start-asset-backup-source.ts', { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  const exited = once(child, 'exit')
  try {
    const [port] = await Promise.race([once(child, 'message'), exited.then(() => { throw Error('Source launcher failed') })])
    const base = 'http://127.0.0.1:' + port
    const png = await sharp({ create: { width: 20, height: 12, channels: 4, background: '#ce295b90' } }).png().toBuffer()
    const jpg = await sharp({ create: { width: 15, height: 10, channels: 3, background: '#2580a8' } }).jpeg().toBuffer()
    const upload = new FormData()
    upload.append('files', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'Standalone synthetic magenta PNG.png')
    upload.append('files', new Blob([new Uint8Array(jpg)], { type: 'image/jpeg' }), 'Standalone synthetic teal JPEG.jpg')
    const response = await fetch(base + '/api/assets', { method: 'POST', body: upload })
    expect(response.status).toBe(200)
    expect(await (await fetch(base + '/api/projects')).json()).toEqual([])
    const download = await fetch(base + '/api/data/backup')
    expect(download.status).toBe(200)
    return { assets: await response.json() as Asset[], bytes: Buffer.from(await download.arrayBuffer()) }
  } finally {
    if (child.connected) child.disconnect()
    await exited
  }
}

test('imports an actual standalone backup, inserts restored thumbnail and decodes it after reopening', async ({ page }) => {
  const { assets, bytes } = await downloadIndependentAssetLibrary()
  const zip = await JSZip.loadAsync(bytes)
  expect(Object.keys(zip.files).some(name => name.startsWith('projects/'))).toBe(false)
  await page.goto('/')
  await page.getByTestId('tab-projects').click()
  const button = page.getByRole('button', { name: '项目和素材备份', exact: true })
  if (!(await button.isVisible())) await page.getByTestId('toolbar-more').click()
  await button.click()
  const dialog = page.getByRole('dialog', { name: '项目和素材备份' })
  const restore = dialog.getByRole('region', { name: '从整库 ZIP 恢复部分项目' })
  await restore.getByLabel('选择整库 ZIP').setInputFiles({ name: 'actual-fork-image-only.zip', buffer: bytes, mimeType: 'application/zip' })
  const independent = restore.getByLabel('独立恢复素材库中已索引的 PNG/JPEG')
  await expect(independent).not.toBeChecked()
  await independent.check()
  await restore.getByRole('button', { name: '预览恢复' }).click()
  await expect(restore.getByText('可添加的素材库图片（2）', { exact: true })).toBeVisible()
  const submit = restore.getByRole('button', { name: '确认添加所选数据' })
  await expect(submit).toBeEnabled()
  for (const asset of assets) expect((await page.request.get('/media/' + asset.file)).status()).toBe(404)
  await submit.click()
  await expect(restore.getByText('新增图片（2）', { exact: true })).toBeVisible()
  await expect(restore.getByRole('status')).toContainText('没有新增项目')
  await restore.getByRole('button', { name: '预览恢复' }).click()
  await expect(restore.getByText('已有相同图片（2）', { exact: true })).toBeVisible()
  await expect(submit).toBeDisabled()
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()

  await page.getByRole('button', { name: '新建空白项目' }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('未命名推文')
  const title = 'Reopened standalone asset proof'
  await page.getByRole('textbox', { name: '文章标题' }).fill(title)
  await page.getByTestId('tab-assets').click()
  for (const asset of assets) {
    const thumbnail = page.locator(`.asset img[src*="/media/${asset.file}?"][src*="gen="]`)
    await expect(thumbnail).toBeVisible()
    await expect.poll(() => thumbnail.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([240, 240])
  }
  const selected = assets[0]
  await page.locator(`.asset img[src*="/media/${selected.file}?"]`).click()
  const result = page.getByTestId('canvas').locator(`img[src*="/media/${selected.file}?"][src*="gen="]`)
  await expect(result).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await page.reload()
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button', { name: title, exact: false }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
  await expect.poll(() => result.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([selected.width, selected.height])
  const rgba = await result.evaluate(async (node: HTMLImageElement) => {
    await node.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(node, 0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data]
  })
  expect(rgba[0]).toBeGreaterThan(rgba[1] + 100)
  for (const asset of assets) {
    const original = await zip.file('assets/' + asset.file)!.async('nodebuffer')
    const digest = createHash('sha256').update(original).digest('hex')
    const source = await page.request.get('/media/' + asset.file + '?w=2400&gen=' + digest)
    expect(source.status()).toBe(200)
    expect(await source.body()).toEqual(original)
  }
})

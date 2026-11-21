import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'

test('adds an editorial replay, scrubs it, and recovers it after reload', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button', { name: '新建空白项目' }).click()
  await page.getByTestId('tab-blocks').click()
  await page.getByTestId('lib-replay').click()
  const open = page.getByTestId('replay-open')
  await expect(open).toHaveCount(1)
  await open.click()
  const dialog = page.getByRole('dialog', { name: '预览编辑回放' })
  await expect(dialog.getByTestId('replay-stage').locator('svg').first()).toBeVisible()
  const rail = dialog.getByTestId('replay-seek')
  await rail.focus()
  await rail.press('Home')
  await rail.press('ArrowRight')
  expect(Number(await rail.inputValue())).toBeGreaterThan(0)
  await rail.press('ArrowLeft')
  expect(Number(await rail.inputValue())).toBe(0)
  await rail.press('End')
  // End must reach the actual duration, even when it is between hundredths.
  const duration = Number(await rail.getAttribute('max'))
  expect(duration).toBeGreaterThan(0)
  expect(Number(await rail.inputValue())).toBe(duration)
  await dialog.getByTestId('replay-toggle').click()
  await expect(dialog.getByTestId('replay-toggle')).toContainText('暂停')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await page.reload()
  await expect(open).toHaveCount(1)
})

test('offers local HTML and text-only Xiumi replay files without uploading', async ({ page }) => {
  let publicationRequests = 0
  await page.route('**/api/wechat/status', route => route.fulfill({ json: { configured: true, appid: 'fixture' } }))
  await page.route(/\/api\/wechat\/(?:upload-images|draft)$/, route => {
    publicationRequests++
    return route.abort()
  })
  await page.goto('/')
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button', { name: '新建空白项目' }).click()
  const openExport = page.getByTestId('open-export')
  await openExport.click()
  const dialog = page.getByRole('dialog', { name: '导出与发布' })
  const draft = dialog.getByRole('button', { name: '推送到草稿箱…' })
  await expect(draft).toBeEnabled()
  await expect(dialog.getByTestId('copy-wechat')).toBeEnabled()
  await expect(dialog.getByTestId('xiumi-package')).toBeEnabled()
  await page.keyboard.press('Escape')
  await page.getByTestId('tab-blocks').click()
  await page.getByTestId('lib-replay').click()
  await openExport.click()
  await expect(dialog.getByRole('status')).toContainText('公众号发布与上传秀米暂不可用')
  await expect(draft).toBeDisabled()
  await expect(dialog.getByTestId('copy-wechat')).toBeDisabled()
  await expect(dialog.getByTestId('xiumi-upload')).toHaveCount(0)
  const [xiumi] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByTestId('xiumi-package').click(),
  ])
  expect(xiumi.suggestedFilename()).toMatch(/\.txt$/)
  const xiumiHtml = await readFile((await xiumi.path())!, 'utf8')
  expect(xiumiHtml).toContain('<text')
  expect(xiumiHtml).toContain('<animate')
  expect(xiumiHtml).not.toMatch(/<image\b|data:image|\/media\//)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: '本地 HTML（保留回放）' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.html$/)
  const html = await readFile((await download.path())!, 'utf8')
  expect(html).toContain('把写作过程做成回放')
  expect(html).toContain('<svg')
  expect(html).toContain('<animate')
  expect(publicationRequests).toBe(0)
})

test('downloads an owned-image replay that still decodes its PNG/JPEG pixels with networking disabled', async ({ page }, info) => {
  const zip = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-component.zip', import.meta.url)))
  const png = await zip.file('assets/archived-component-photo.png')!.async('nodebuffer')
  const uploaded = await page.request.post('/api/assets', {
    multipart: { files: { name: 'owned-replay-raster.png', mimeType: 'image/png', buffer: png } },
  })
  expect(uploaded.ok()).toBe(true)
  const [asset] = await uploaded.json()
  const media = await page.request.get(`/media/${asset.file}?w=2400`)
  expect(media.ok()).toBe(true)
  const bytes = await media.body()
  const mime = media.headers()['content-type']
  expect(mime).toMatch(/^image\/(?:png|jpeg)$/)
  const generation = createHash('sha256').update(bytes).digest('hex')
  const image = { src: `/media/${asset.file}?gen=${generation}`, assetId: asset.id, width: asset.width, height: asset.height }
  const title = 'Indexed local replay archive'
  const id = 'offline-raster-replay-test'
  const now = Date.now()
  const created = await page.request.put('/api/projects/' + id, { data: {
    id, title, author: '', digest: '', themeId: 'tsinghua-purple', createdAt: now, updatedAt: now, blocks: [{
      id: 'raster-replay-block', type: 'replay', props: {
        canvas: { width: 750, background: { type: 'image', image } },
        scenes: [{ id: 'scene-1', items: [{ id: 'item-1', type: 'image', image, label: 'Owned indexed image' }] }],
      },
    }],
  } })
  expect(created.ok()).toBe(true)
  let published = 0
  await page.route(/\/api\/wechat\/(?:upload-images|draft)$/, route => { published++; return route.abort() })
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
  await page.getByTestId('open-export').click()
  const dialog = page.getByRole('dialog', { name: '导出与发布' })
  await expect(dialog.getByTestId('copy-wechat')).toBeDisabled()
  await expect(dialog.getByTestId('xiumi-upload')).toHaveCount(0)
  await dialog.getByTestId('xiumi-package').click()
  await expect(page.getByRole('status').filter({ hasText: '秀米离线导出不支持回放内嵌图片' })).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: '本地 HTML（保留回放）' }).click(),
  ])
  const html = await readFile((await download.path())!, 'utf8')
  const expected = 'data:' + mime + ';base64,' + bytes.toString('base64')
  expect(html).toContain(expected)
  expect(html).toContain('<animate')
  expect(html).not.toContain('/media/')
  expect(published).toBe(0)

  const file = info.outputPath('offline-owned-replay.html')
  await writeFile(file, html)
  const offline = await page.context().newPage()
  await page.context().setOffline(true)
  try {
    await offline.goto(pathToFileURL(file).href)
    const embedded = await offline.locator('svg image').evaluateAll(async nodes => Promise.all(nodes.map(async node => {
      const source = node.getAttribute('href') ?? ''
      const bitmap = new Image()
      bitmap.src = source
      await bitmap.decode()
      return { source, width: bitmap.naturalWidth, height: bitmap.naturalHeight }
    })))
    expect(embedded.length).toBeGreaterThanOrEqual(2)
    expect(embedded.every(entry => entry.source === expected && entry.width === asset.width && entry.height === asset.height)).toBe(true)
  } finally {
    await offline.close()
    await page.context().setOffline(false)
  }
})

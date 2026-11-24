import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

const fixture = (name: string) => fileURLToPath(new URL('../fixtures/legacy-backup/' + name, import.meta.url))
const sourceTitle = 'Synthetic native dual-photo template'
const targetTitle = 'Synthetic pair application'
const roleIds = { 'archived-section-heading': 'h1', 'archived-unused-heading': 'other', 'archived-native-pair': 'img2lr' }

test('restores the real native pair, applies ordered replacements, and downloads both locally', async ({ page }, info) => {
  const unexpected: string[] = []
  await page.route('**/api/ai/status', route => route.fulfill({ json: { enabled: false } }))
  await page.route(/\/api\/(?:ai\/(?!status(?:\?|$))|wechat\/(?:upload-images|draft)(?:\?|$))/, route => {
    unexpected.push(route.request().url())
    return route.abort()
  })
  await page.goto('/')
  await page.getByTestId('tab-projects').click()
  const backup = page.getByRole('button', { name: '项目和素材备份', exact: true })
  if (!(await backup.isVisible())) await page.getByTestId('toolbar-more').click()
  await backup.click()
  const dialog = page.getByRole('dialog', { name: '项目和素材备份' })
  const restore = dialog.getByRole('region', { name: '从整库 ZIP 恢复部分项目' })
  await restore.getByLabel('选择整库 ZIP').setInputFiles(fixture('upstream-native-dual-photo.zip'))
  await restore.getByLabel('同时恢复项目、历史及已选择模板引用的已索引图片').check()
  await restore.getByLabel('同时恢复简单模板和自定义主题').check()
  await restore.getByRole('button', { name: '预览恢复' }).click()
  await expect(restore.getByText('可添加的引用图片（2）', { exact: true })).toBeVisible()
  expect((await page.request.get('/media/archive-left-violet.png')).status()).toBe(404)
  const template = async () => (await (await page.request.get('/api/templates')).json()).find((t: { name: string }) => t.name === sourceTitle)
  expect(await template()).toBeUndefined()
  await restore.getByRole('button', { name: '确认添加所选数据' }).click()
  await expect(restore.getByText('新增图片（2）', { exact: true })).toBeVisible()
  const archived = await template()
  expect(archived.roles).toEqual(roleIds)
  expect(archived.blocks.map((block: { id: string }) => block.id)).toEqual(Object.keys(roleIds))
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()

  await page.getByTestId('tab-templates').click()
  await page.locator('.tpl-item').filter({ hasText: sourceTitle }).getByTestId('apply-template').click()
  await expect(page.getByTestId('use-ai')).not.toBeChecked()
  await expect(page.getByTestId('kit-table')).toContainText('双图左右')
  await page.getByTestId('import-text').fill('# ' + targetTitle + '\n\n## Applied section\n\nAnchor prose for the exact ordered pair.')
  await page.getByTestId('import-images').setInputFiles([fixture('replacement-left-red.png'), fixture('replacement-right-blue.png')])
  const uploaded = page.getByTestId('photo-notes').locator('li img')
  await expect(uploaded).toHaveCount(2)
  const paths = await uploaded.evaluateAll(nodes => nodes.map(node => new URL((node as HTMLImageElement).src).pathname))
  expect(new Set(paths).size).toBe(2)
  await page.getByTestId('photo-note-1').fill('Red replacement left')
  await page.getByTestId('photo-note-2').fill('Blue replacement right')
  await page.getByTestId('photo-pick-1').check()
  await page.getByTestId('photo-pick-2').check()
  await page.getByTestId('make-group').click()
  await page.getByTestId('group-layout').selectOption('img2lr')
  await page.getByTestId('group-anchor').fill('Anchor prose for the exact ordered pair.')
  await page.getByTestId('generate').click()
  const variant = page.locator('[data-testid^="variant-kit-"]')
  await expect(variant).toContainText('Applied section')
  await variant.getByRole('button', { name: '使用此方案' }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(targetTitle)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const canvas = page.getByTestId('canvas')
  const pair = canvas.locator('[data-block-type=photos]')
  await expect(pair).toHaveCount(1)
  const photos = pair.locator('img')
  await expect(photos).toHaveCount(2)
  await expect.poll(() => photos.evaluateAll(nodes => nodes.map(node => new URL((node as HTMLImageElement).src).pathname))).toEqual(paths)
  await expect.poll(() => photos.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).naturalWidth > 0))).toBe(true)
  expect(await pair.getAttribute('data-block-id')).not.toBe('archived-native-pair')
  await expect(canvas).not.toContainText('Archived unused heading')
  expect(await template()).toEqual(archived)

  await page.getByTestId('open-export').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '微信 HTML（图片内嵌）' }).click()
  const download = await downloadPromise
  const file = info.outputPath('ordered-native-pair.html')
  await download.saveAs(file)
  const html = await readFile(file, 'utf8')
  expect(html).not.toMatch(/\/media\/|archive-left-violet|archive-right-teal|Archived unused heading/)
  expect(html).toContain('Red replacement left')
  expect(html).toContain('Blue replacement right')
  const offline = await page.context().newPage()
  await page.context().setOffline(true)
  try {
    await offline.goto(pathToFileURL(file).href)
    const pixels = await offline.locator('img[src^="data:image/png"]').evaluateAll(async nodes => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')!
      return Promise.all(nodes.map(async node => {
        const image = node as HTMLImageElement
        await image.decode()
        ctx.clearRect(0, 0, 1, 1)
        ctx.drawImage(image, 0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data]
      }))
    })
    expect(pixels).toHaveLength(2)
    expect(pixels[0][0]).toBeGreaterThan(pixels[0][2] + 100)
    expect(pixels[1][2]).toBeGreaterThan(pixels[1][0] + 100)
  } finally {
    await offline.close()
    await page.context().setOffline(false)
  }
  expect(unexpected).toEqual([])
})

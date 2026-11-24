import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const backup = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-template-only.zip', import.meta.url))
const imageTitle = 'Template-only teal image', styleTitle = 'Template style override'

test('restores template-only media and style, then saves and reopens real template projects', async ({ page, browser }) => {
  await page.goto('/')
  await page.getByTestId('tab-projects').click()
  const backupButton = page.getByRole('button', { name: '项目和素材备份' })
  if (!(await backupButton.isVisible())) await page.getByTestId('toolbar-more').click()
  await backupButton.click()
  const dialog = page.getByRole('dialog', { name: '项目和素材备份' })
  const restore = dialog.getByRole('region', { name: '从整库 ZIP 恢复部分项目' })
  await restore.getByLabel('选择整库 ZIP').setInputFiles(backup)
  await restore.getByLabel('同时恢复项目、历史及已选择模板引用的已索引图片').check()
  await restore.getByLabel('同时恢复简单模板和自定义主题').check()
  await restore.getByRole('button', { name: '预览恢复' }).click()
  await expect(restore.getByText('可添加的引用图片（1）', { exact: true })).toBeVisible()
  expect(await (await page.request.get('/api/templates')).json()).toEqual(expect.not.arrayContaining([expect.objectContaining({ name: imageTitle })]))
  await restore.getByRole('button', { name: '确认添加所选数据' }).click()
  await expect(restore.getByText('新增图片（1）', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
  const instantiate = async (title: string) => {
    await page.getByTestId('tab-templates').click()
    await page.locator('.tpl-item').filter({ has: page.getByTestId('template-item').getByText(title, { exact: true }) })
      .getByRole('button', { name: '新建', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
  }
  await instantiate(imageTitle)
  await instantiate(styleTitle)
  const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const reopened = await fresh.newPage()
    await reopened.goto('/')
    await reopened.getByTestId('tab-projects').click()
    await reopened.getByRole('button', { name: imageTitle, exact: false }).click()
    const canvas = reopened.getByTestId('canvas')
    await expect(canvas.getByText('Only this template references this teal image')).toBeVisible()
    const image = canvas.locator('img[src*="/media/fixture-template-only-teal.png?"][src*="gen="]')
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([7, 5])
    await reopened.getByRole('button', { name: styleTitle, exact: false }).click()
    await expect(canvas.getByText('Independent text-only style override')).toBeVisible()
    await expect(canvas).toHaveCSS('font-size', '17px')
    await expect(canvas.locator('section[style*="border-left"]').filter({ hasText: 'Independent text-only style override' })).toHaveCSS('border-left-color', 'rgb(39, 80, 106)')
  } finally { await fresh.close() }
})

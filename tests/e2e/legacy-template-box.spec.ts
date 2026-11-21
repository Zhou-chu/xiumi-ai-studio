import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const backup = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-template-box.zip', import.meta.url))
const templateName = 'Template box with teal image'

test('restores a native image box and reopens two separately cloned template projects', async ({ page, browser }) => {
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
  await restore.getByRole('button', { name: '确认添加所选数据' }).click()
  await expect(restore.getByText('新增图片（1）', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()

  const titles = ['Restored box first project', 'Restored box second project']
  for (const title of titles) {
    await page.getByTestId('tab-templates').click()
    const item = page.locator('.tpl-item').filter({ has: page.getByTestId('template-item').getByText(templateName, { exact: true }) })
    await item.getByRole('button', { name: '新建', exact: true }).click()
    const titleInput = page.getByRole('textbox', { name: '文章标题' })
    await expect(titleInput).toHaveValue(templateName)
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    await titleInput.fill(title)
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
  }

  const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin })
  const used = new Set(['ordered-box', 'box-heading', 'teal-image', 'box-quote'])
  try {
    const reopened = await fresh.newPage()
    await reopened.goto('/')
    await reopened.getByTestId('tab-projects').click()
    for (const title of titles) {
      await reopened.getByRole('button', { name: title, exact: false }).click()
      await expect(reopened.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
      const canvas = reopened.getByTestId('canvas')
      const body = canvas.locator('.box-body')
      await expect(canvas.getByText('Native boxed content')).toBeVisible()
      const children = body.locator('[data-block-id]')
      await expect(children).toHaveCount(3)
      await expect(children.nth(0)).toContainText('Before the boxed image')
      await expect(children.nth(1)).toContainText('Only the box contains this teal image')
      await expect(children.nth(2)).toContainText('After the boxed image')
      const image = children.nth(1).locator('img[src*="/media/fixture-template-box-teal.png?"][src*="gen="]')
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([11, 9])
      const ids = await canvas.locator('[data-block-id]').evaluateAll(blocks => blocks.map(block => block.getAttribute('data-block-id')))
      expect(ids).toHaveLength(4)
      for (const id of ids) {
        expect(id).toBeTruthy()
        expect(used.has(id!)).toBe(false)
        used.add(id!)
      }
    }
  } finally { await fresh.close() }
})

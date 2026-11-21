import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const backup = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-component.zip', import.meta.url))
const title = 'Component restore journey'
const name = 'Archived local component'
const componentId = 'archived-component'

test('restores a local component and indexed pixels, inserts independently twice, and keeps metadata after reload', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-projects').click()
  const backupButton = page.getByRole('button', { name: '项目和素材备份', exact: true })
  if (!(await backupButton.isVisible())) await page.getByTestId('toolbar-more').click()
  await backupButton.click()
  const dialog = page.getByRole('dialog', { name: '项目和素材备份', exact: true })
  const restore = dialog.getByRole('region', { name: '从整库 ZIP 恢复部分项目' })
  const list = async () => (await (await page.request.get('/api/components')).json()) as Array<{ id: string; origin: unknown }>
  await restore.getByLabel('选择整库 ZIP').setInputFiles(backup)
  await restore.getByLabel('同时恢复简单原文组件及引用图片').check()
  await restore.getByRole('button', { name: '预览恢复' }).click()
  await expect(restore.getByText('可添加的组件（1）', { exact: true })).toBeVisible()
  expect((await list()).some(x => x.id === componentId)).toBe(false)
  expect((await page.request.get('/media/archived-component-photo.png')).status()).toBe(404)
  await restore.getByRole('button', { name: '确认添加所选数据', exact: true }).click()
  await expect(restore.getByText('新增组件（1）', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()

  await page.getByRole('textbox', { name: '文章标题' }).fill(title)
  await page.getByTestId('tab-components').click()
  await page.getByTestId('component-search').fill('Synthetic source label')
  const card = page.getByTestId('component-card').filter({ hasText: name })
  await expect(card).toContainText('秀米')
  const insert = card.getByRole('button', { name: '插入组件：' + name, exact: true })
  await insert.click()
  await insert.click()
  const canvas = page.getByTestId('canvas')
  const text = canvas.getByText('Archived component text', { exact: true })
  const images = canvas.getByAltText('Archived component image', { exact: true })
  await expect(text).toHaveCount(2)
  await expect(images).toHaveCount(2)
  const ids = async () => text.evaluateAll(nodes => nodes.map(node => node.closest('[data-block-id]')?.getAttribute('data-block-id')))
  const before = await ids()
  expect(new Set(before).size).toBe(2)
  expect(before).not.toContain('archived-component-block')
  await expect.poll(() => images.evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).naturalWidth))).toEqual([8, 8])
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
  await expect(text).toHaveCount(2)
  expect(await ids()).toEqual(before)
  await expect.poll(() => images.evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).naturalWidth))).toEqual([8, 8])
  expect((await list()).find(x => x.id === componentId)?.origin).toMatchObject({
    kind: 'xiumi', title: 'Synthetic source label', account: 'Synthetic archive account', via: 'import',
    attested: false, attestedAt: 0, redistributable: false,
  })
})

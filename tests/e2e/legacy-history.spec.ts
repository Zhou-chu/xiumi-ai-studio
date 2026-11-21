import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const backup = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-history.zip', import.meta.url))
const project = '/api/projects/history-project'
const snapshotLabel = 'Synthetic historical snapshot'

test('opens and restores upstream ZIP text history through the normal editor', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-projects').click()
  const menu = page.getByTestId('toolbar-more')
  const backupButton = page.getByRole('button', { name: '项目和素材备份', exact: true })
  if (!(await backupButton.isVisible())) await menu.click()
  await backupButton.click()
  const data = page.getByRole('dialog', { name: '项目和素材备份', exact: true })
  const restore = data.getByRole('region', { name: '从整库 ZIP 恢复部分项目' })
  await restore.getByLabel('选择整库 ZIP').setInputFiles(backup)
  const confirm = restore.getByRole('button', { name: '确认添加项目' })
  await expect(confirm).toHaveCount(0)
  const preview = page.waitForResponse(response => new URL(response.url()).pathname === '/api/data/restore' && response.request().method() === 'POST')
  await restore.getByRole('button', { name: '预览恢复' }).click()
  expect((await preview).status()).toBe(200)
  await expect(restore.getByText('可添加的历史版本（1）', { exact: true })).toBeVisible()
  expect((await page.request.get(project)).status()).toBe(404)
  await confirm.click()
  await expect(restore.getByText('新增历史版本（1）', { exact: true })).toBeVisible()
  await data.getByRole('button', { name: '关闭', exact: true }).last().click()
  await page.getByRole('button', { name: /Current manuscript/ }).click()

  const title = page.getByRole('textbox', { name: '文章标题' })
  await expect(title).toHaveValue('Current manuscript')
  const historyButton = page.getByRole('button', { name: '历史版本', exact: true })
  if (!(await historyButton.isVisible())) await menu.click()
  await historyButton.click()
  const history = page.getByRole('dialog', { name: '历史版本', exact: true })
  const snapshot = history.locator('.list-row').filter({ hasText: snapshotLabel })
  await expect(snapshot).toHaveCount(1)
  await snapshot.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(history).toHaveCount(0)
  await expect(title).toHaveValue('Original manuscript')
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const persistedTitle = async () => (await (await page.request.get(project)).json()).title
  expect(await persistedTitle()).toBe('Original manuscript')
  await page.getByRole('button', { name: '撤销', exact: true }).focus()
  await page.keyboard.press('Control+z')
  await expect(title).toHaveValue('Current manuscript')
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  expect(await persistedTitle()).toBe('Current manuscript')
})

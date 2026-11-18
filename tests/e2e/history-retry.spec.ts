import { expect, test } from '@playwright/test'

test('retries a failed history list in place and persists a restored version', async ({ page }) => {
  const now = Date.now()
  const id = `history-retry-${now}`
  const current = { id, title: 'Current history draft', author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now, blocks: [] }
  const prior = { ...current, title: 'Restored history draft' }
  const projectPath = `/api/projects/${id}`
  const versionsPath = `${projectPath}/versions`
  expect((await page.request.put(projectPath, { data: current })).ok()).toBe(true)
  expect((await page.request.post(versionsPath, { data: { doc: prior, label: 'Prior version' } })).ok()).toBe(true)
  let allowList = false
  let failedLists = 0
  let retriedLists = 0
  await page.route(`**${versionsPath}`, async (route) => {
    if (route.request().method() === 'GET') {
      // The development StrictMode mount can issue more than one initial GET.
      if (!allowList) {
        failedLists++
        await route.fulfill({ status: 503, json: { error: 'private browser fixture' } })
        return
      }
      retriedLists++
    }
    await route.continue()
  })
  await page.goto('/')
  const title = page.getByLabel('文章标题', { exact: true })
  await expect(title).toHaveValue(current.title)
  const history = page.getByRole('button', { name: '历史版本', exact: true })
  if (!(await history.isVisible())) await page.getByTestId('toolbar-more').click()
  await history.click()
  const dialog = page.getByRole('dialog', { name: '历史版本' })
  await expect(dialog.getByRole('alert')).toContainText('暂时无法加载版本列表')
  await expect(dialog).not.toContainText('private browser fixture')
  await expect(dialog).not.toContainText('还没有保存过版本')
  expect(failedLists).toBeGreaterThanOrEqual(1)
  expect(retriedLists).toBe(0)
  const retry = dialog.getByRole('button', { name: '重试', exact: true })
  await expect(retry).toBeVisible()
  allowList = true
  await retry.click()
  await expect(dialog.getByText('Prior version', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(retriedLists).toBe(1)
  await dialog.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(title).toHaveValue(prior.title)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const saved = await page.request.get(projectPath)
  expect(saved.ok()).toBe(true)
  expect((await saved.json()).title).toBe(prior.title)
  await page.reload()
  await expect(title).toHaveValue(prior.title)
})

import { expect, test } from '@playwright/test'

test('discovers once after leaving edited credentials and still permits a manual refresh', async ({ page }) => {
  let automaticRequests = 0
  const requestKeys: unknown[] = []
  await page.route('**/api/settings/ai/models', async (route) => {
    const data = route.request().postDataJSON()
    requestKeys.push(data.apiKey)
    const expected = data.apiKey === 'synthetic-settings-key'
    automaticRequests++
    await route.fulfill({ json: expected ? [{ id: `synthetic-model-${automaticRequests}` }] : [] })
  })
  await page.goto('/')
  await expect(page.locator('.workspace')).toBeVisible()
  if (!(await page.getByTestId('open-ai-settings').isVisible())) await page.getByTestId('toolbar-more').click()
  await page.getByTestId('open-ai-settings').click()
  await page.getByTestId('ai-add-preset').selectOption('custom')

  const settings = page.getByRole('dialog', { name: 'AI 模型设置' })
  const base = settings.getByTestId('ai-base-url')
  const key = settings.locator('input[type="password"]')
  const model = settings.getByTestId('ai-model')
  await base.fill('https://models.example.invalid/v1')
  await key.focus()
  await expect(key).toBeFocused()
  expect(automaticRequests).toBe(0)
  await key.fill('synthetic-settings-key')
  await model.focus()
  await expect(settings.getByTestId('ai-model-note')).toContainText('已获取 1 个模型')
  expect(automaticRequests).toBe(1)
  await key.focus()
  await model.focus()
  await settings.getByTestId('ai-load-models').click()
  await expect.poll(() => automaticRequests).toBe(2)
  expect(requestKeys).toEqual(['synthetic-settings-key', 'synthetic-settings-key'])
  await settings.getByTestId('ai-model-picker').click()
  await expect(settings.getByRole('option', { name: 'synthetic-model-2' })).toBeVisible()
})

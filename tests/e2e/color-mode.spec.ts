import { expect, test, type Page } from '@playwright/test'

async function exposeSecondary(page: Page, control = page.getByTestId('color-mode-select')) {
  if (!await control.isVisible()) await page.getByTestId('toolbar-more').click()
}

async function openEditor(page: Page) {
  const now = Date.now()
  const id = `color-${now}-${Math.random().toString(36).slice(2)}`
  const response = await page.request.put(`/api/projects/${id}`, { data: {
    id, title: '界面主题不改变文章', author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now,
    blocks: [{ id: 'color-paragraph', type: 'paragraph', props: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '原有文字和文章配色保持不变。' }] }] }, align: 'justify' } }],
  } })
  expect(response.ok()).toBe(true)
  await page.goto('/')
  await expect(page.locator('.title-input')).toHaveValue('界面主题不改变文章')
  await expect(page.locator('.phone')).toBeVisible()
}

test('manual themes persist, theme dialogs and controls, and preserve the article and preview', async ({ page }) => {
  await openEditor(page)
  const control = page.getByRole('combobox', { name: '界面主题', exact: true })
  await exposeSecondary(page)
  await control.selectOption('light')
  const article = page.locator('.block-html').first()
  const content = await article.innerHTML()
  const articleColor = await article.evaluate((element) => getComputedStyle(element).color)
  const lightPanel = await page.locator('.panel.left').evaluate((element) => getComputedStyle(element).backgroundColor)
  await page.getByTestId('open-preview').click()
  const preview = await page.getByTestId('preview-frame').getAttribute('srcdoc')
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await control.selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
  const darkPanel = await page.locator('.panel.left').evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(darkPanel).not.toBe(lightPanel)
  await expect(page.locator('.phone')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(article).toHaveCSS('color', articleColor)
  expect(await article.innerHTML()).toBe(content)
  await page.getByTestId('open-preview').click()
  expect(await page.getByTestId('preview-frame').getAttribute('srcdoc')).toBe(preview)
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', darkPanel)
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await exposeSecondary(page, page.getByTestId('open-ai-settings'))
  await page.getByTestId('open-ai-settings').click()
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', darkPanel)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.reload()
  await exposeSecondary(page)
  await expect(control).toHaveValue('dark')
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
  await exposeSecondary(page)
  await control.selectOption('light')
  await expect(page.locator('.panel.left')).toHaveCSS('background-color', lightPanel)
})

for (const zone of ['Asia/Shanghai', 'America/Los_Angeles']) {
  test.describe(`automatic device time in ${zone}`, () => {
    test.use({ timezoneId: zone })
    test('uses local hours rather than UTC and crosses daylight and night boundaries', async ({ page }) => {
      // At this instant Shanghai is 07:00 and Los Angeles is 15:00 the previous day.
      await page.clock.install({ time: new Date('2026-11-10T23:00:00Z') })
      await openEditor(page)
      await expect(page.getByLabel('界面主题', { exact: true })).toHaveValue('auto')
      await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'light')
      // Both places are at night at 11:00 UTC: 19:00 in Shanghai, 03:00 in LA.
      await page.clock.setSystemTime(new Date('2026-11-11T11:00:00Z'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
      // Advance each zone from local 06:59:30 through 07:00 without reloading.
      const dawn = zone === 'Asia/Shanghai' ? '2026-11-11T22:59:30Z' : '2026-11-11T14:59:30Z'
      await page.clock.setSystemTime(new Date(dawn))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
      await page.clock.runFor(60_000)
      await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'light')
    })
  })
}

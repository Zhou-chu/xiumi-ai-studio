import { expect, test } from '@playwright/test'

test('pasted fixed-width article cards stay inside their source preview column on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const trigger = page.getByTestId('open-article-import')
  await page.locator('.workspace').waitFor()
  if (!await trigger.isVisible()) await page.getByTestId('toolbar-more').click()
  await trigger.click()
  await page.getByRole('dialog').getByRole('button', { name: /粘贴富文本/ }).click()
  await page.getByTestId('article-paste').evaluate(el => {
    const data = new DataTransfer()
    data.setData('text/html', '<section id="js_content"><section style="width:600px; display:grid; background:#fff"><section style="width:300px; margin-left:10px">第一栏</section><section style="width:289.5px">第二栏</section><section style="width:24px">图标</section></section></section>')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  const preview = page.locator('.article-preview .mini-inner')
  const column = preview.locator('section[style*="display: grid"]')
  await expect(column).toContainText('第一栏')
  await expect(column).toContainText('第二栏')
  const widths = await column.evaluate(el => ({
    column: el.getBoundingClientRect().width,
    parent: el.parentElement!.getBoundingClientRect().width,
    left: el.children[0].getBoundingClientRect().width,
  }))
  expect(widths.column).toBeGreaterThan(0)
  expect(widths.column).toBeLessThanOrEqual(widths.parent + 1)
  expect(widths.left).toBeCloseTo(widths.column / 2, 0)
})

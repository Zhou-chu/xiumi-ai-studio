import { expect, test, type Locator, type Page } from '@playwright/test'

const viewports = [
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad landscape', width: 1180, height: 820 },
]

async function expectFitsWidth(locator: Locator, width: number) {
  const box = await locator.boundingBox()
  expect(box, 'control must have a rendered box').not.toBeNull()
  expect(box!.x, 'control must not be clipped on the left').toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width, 'control must not be clipped on the right').toBeLessThanOrEqual(width + 1)
}

async function seed(page: Page, name: string) {
  const now = Date.now()
  const id = `responsive-${now}-${Math.random().toString(36).slice(2)}`
  const response = await page.request.put(`/api/projects/${id}`, {
    data: {
      id, title: name, author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now,
      blocks: [{ id: 'responsive-paragraph', type: 'paragraph', props: { content: '移动端编辑测试正文', align: 'left' } }],
    },
  })
  expect(response.ok()).toBe(true)
  await page.goto('/')
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue(name)
}

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true })

    // Removing the narrow-screen workspace or toolbar rules must make these fail:
    // every action needs a reachable target, and the article must retain usable width.
    test('toolbar, article and editing panels remain reachable without horizontal page scrolling', async ({ page }) => {
      await seed(page, viewport.name)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      for (const control of await page.locator('.toolbar > button, .toolbar > input, .toolbar > select').all()) {
        await expectFitsWidth(control, viewport.width)
      }
      const canvas = page.locator('.canvas-wrap')
      const box = await canvas.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(Math.min(360, viewport.width - 24))
      await expectFitsWidth(canvas, viewport.width)
      await page.getByLabel('文章标题', { exact: true }).fill(`已修改 ${viewport.name}`)
      await page.getByTestId('lib-paragraph').scrollIntoViewIfNeeded()
      await expectFitsWidth(page.getByTestId('lib-paragraph'), viewport.width)
      await page.getByTestId('lib-paragraph').tap()
      const field = page.getByLabel('正文', { exact: false }).first()
      await field.scrollIntoViewIfNeeded()
      await expectFitsWidth(field, viewport.width)
      await field.fill('触屏添加并编辑的正文')
      await page.getByLabel('文章标题', { exact: true }).tap()
      await expect(page.locator('[data-block-type="paragraph"]').last()).toContainText('触屏添加并编辑的正文')
      await expect(page.getByTestId('save-status')).toHaveText('已保存')
      await page.reload()
      await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue(`已修改 ${viewport.name}`)
      await expect(page.getByTestId('canvas')).toContainText('触屏添加并编辑的正文')
    })

    test('manual light and dark modes keep the article unchanged and theme control reachable', async ({ page }) => {
      await seed(page, `theme ${viewport.name}`)
      const theme = page.getByRole('combobox', { name: '界面主题', exact: true })
      await theme.selectOption('light')
      await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'light')
      await expectFitsWidth(theme, viewport.width)
      const lightToolbar = await page.locator('.toolbar').evaluate(el => getComputedStyle(el).backgroundColor)
      const article = page.getByTestId('canvas')
      const before = await article.innerHTML()
      const lightArticle = await article.screenshot({ animations: 'disabled' })
      await test.info().attach(`${viewport.name}-light`, { body: await page.screenshot(), contentType: 'image/png' })
      await theme.selectOption('dark')
      await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
      expect(await page.locator('.toolbar').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(lightToolbar)
      await expectFitsWidth(theme, viewport.width)
      expect(await article.innerHTML()).toBe(before)
      expect(await article.screenshot({ animations: 'disabled' })).toEqual(lightArticle)
      await test.info().attach(`${viewport.name}-dark`, { body: await page.screenshot(), contentType: 'image/png' })
      await page.reload()
      await expect(theme).toHaveValue('dark')
      await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')
      await expect(page.getByTestId('canvas')).toContainText('移动端编辑测试正文')
    })

    // Dialog shells and their controls must fit, even where desktop forms use two columns.
    test('preview, model settings, import and export dialogs fit and dismiss', async ({ page }) => {
      await seed(page, `dialogs ${viewport.name}`)
      for (const trigger of ['open-preview', 'open-ai-settings', 'open-article-import', 'open-import', 'open-export']) {
        await page.getByTestId(trigger).tap()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await expectFitsWidth(dialog, viewport.width)
        const close = dialog.getByRole('button', { name: '关闭', exact: true })
        await expect(close).toBeInViewport({ ratio: 1 })
        if (trigger === 'open-ai-settings') {
          await page.getByTestId('ai-add-preset').selectOption('custom')
          const model = page.getByTestId('ai-model')
          await model.scrollIntoViewIfNeeded()
          await expectFitsWidth(model, viewport.width)
          await model.fill('mobile-layout-test')
        }
        if (trigger === 'open-article-import') {
          await dialog.getByRole('button', { name: /粘贴富文本/ }).tap()
          await page.getByTestId('article-paste').evaluate(el => {
            const data = new DataTransfer()
            data.setData('text/html', '<h1>触屏导入测试</h1><p>这是用于检查导入预览和选项的本地测试文章。</p>')
            el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
          })
          const importButton = page.getByTestId('article-import')
          await expect(importButton).toBeVisible()
          await importButton.scrollIntoViewIfNeeded()
          await expectFitsWidth(importButton, viewport.width)
        }
        if (trigger === 'open-preview') await expectFitsWidth(page.getByTestId('preview-frame'), viewport.width)
        const body = dialog.locator('.modal-body')
        expect(await body.evaluate(el => el.scrollWidth - el.clientWidth), `${trigger} must not require sideways form scrolling`).toBeLessThanOrEqual(1)
        await close.tap()
        await expect(dialog).toHaveCount(0)
        await expect(page.getByTestId(trigger)).toBeFocused()
      }
      // Reopening and Escape must not leave a mask over the editor.
      await page.getByTestId('open-export').tap()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByLabel('文章标题', { exact: true }).fill('关闭对话框后仍可编辑')
      await expect(page.locator('.wx-title')).toHaveText('关闭对话框后仍可编辑')
    })
  })
}

import { expect, test, type Page } from '@playwright/test'
async function setup(page: Page) {
  const id = `keyboard-${Date.now()}-${Math.random().toString(36).slice(2)}`, now = Date.now()
  const doc = { id, title: 'Keyboard canvas fixture', author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now, blocks: [
    { id: 'key-heading', type: 'heading', props: { index: '01', title: 'Keyboard heading', subtitle: '', variant: 'auto' } },
    { id: 'key-html', type: 'html', props: { html: '<section><p>First fragment</p><p>Second fragment</p></section><img src="/media/synthetic-keyboard.png">', label: 'Keyboard article' } },
  ] }
  expect((await page.request.put(`/api/projects/${id}`, { data: doc })).ok()).toBe(true)
  await page.route('**/api/projects', route => route.fulfill({ json: [{ id, title: doc.title }] }))
  await page.route('**/media/synthetic-keyboard.png*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100" viewBox="0 0 320 100"><rect width="320" height="100" fill="#dddcd5"/><path d="M0 100L80 30L160 80L240 20L320 100" fill="#85857e"/></svg>' }))
  await page.goto('/'); await expect(page.locator('.workspace')).toBeVisible(); await expect(page.locator('.title-input')).toHaveValue(doc.title)
}
const block = (page: Page, id: string) => page.locator(`.block[data-block-id="${id}"]`)
test('native Enter/Space selection supports Ctrl/Cmd multi-select and editing returns keyboard focus', async ({ page }) => {
  await setup(page)
  const first = block(page, 'key-heading').locator(':scope > .block-select'), second = block(page, 'key-html').locator(':scope > .block-select')
  await first.focus(); await page.keyboard.press('Enter'); await expect(first).toHaveAttribute('aria-pressed', 'true')
  await second.focus(); await page.keyboard.press('Control+Space'); await expect(page.locator('.block.selected')).toHaveCount(2)
  await first.focus(); await page.keyboard.press('Meta+Enter'); await expect(first).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Space'); await expect(page.locator('.block.selected')).toHaveCount(1)
  await block(page, 'key-heading').getByRole('button', { name: '编辑文字（双击）' }).focus(); await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="inline-block-text"] textarea').first()).toBeFocused()
  await page.keyboard.press('Escape'); await expect(first).toBeFocused()
})
test('keyboard fragment navigation, native media delete and undo preserve the article', async ({ page }) => {
  await setup(page)
  const article = block(page, 'key-html'), select = article.locator(':scope > .block-select')
  await select.focus(); await page.keyboard.press('Enter'); await page.getByTestId('pick-fragment').focus(); await page.keyboard.press('Enter')
  await page.getByTestId('pick-next').focus(); await page.keyboard.press('Enter'); await expect(page.getByTestId('pick-status')).toContainText('First fragment')
  await page.keyboard.press('ArrowDown'); await expect(page.getByTestId('pick-status')).toContainText('Second fragment')
  await page.getByTestId('pick-cancel').focus(); await page.keyboard.press('Enter'); await expect(select).toBeFocused()
  await article.getByRole('button', { name: '编辑文字（双击）' }).click(); const editor = page.getByRole('textbox', { name: '原文内容编辑' })
  await editor.locator('img').click(); await page.getByTestId('delete-picked').focus(); await page.keyboard.press('Enter'); await expect(editor.locator('img')).toHaveCount(0)
  await editor.focus(); await page.keyboard.press('Escape'); await expect(select).toBeFocused(); await page.keyboard.press('Control+z')
  await expect(article.locator('.block-html img')).toHaveCount(1); await expect(article).toContainText('First fragment')
})

test.describe('phone selection controls', () => {
 test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
 test('keeps native selection within viewport and reachable by touch', async ({ page }) => {
  await setup(page)
  const select = block(page, 'key-heading').locator(':scope > .block-select')
  await select.scrollIntoViewIfNeeded()
  const bounds = await select.boundingBox(); expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await select.tap(); await expect(select).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await expect(page.locator('.toast')).not.toBeVisible()
  await expect(block(page, 'key-html').locator('.block-html img')).toHaveJSProperty('naturalWidth', 320)
  await page.screenshot({ path: 'visual-evidence/accessibility/canvas-phone.png', fullPage: true })
 })
})

for(const width of [390,1440])test(`dark editor controls remain separate from paper typography at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:900});await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','dark'));await setup(page)
 const select=block(page,'key-heading').locator(':scope > .block-select');await select.focus();await page.keyboard.press('Enter')
 await expect(select).toHaveCSS('background-color','rgb(27, 27, 26)');await expect(select).toHaveCSS('color','rgb(236, 236, 230)');expect(Number.parseFloat(await select.evaluate(el=>getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14)
 await expect(block(page,'key-heading')).toHaveCSS('outline-color','rgb(115, 115, 109)')
 for(const button of await block(page,'key-heading').locator('.block-toolbar button').all())expect(Number.parseFloat(await button.evaluate(el=>getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14)
 const article=block(page,'key-html');const original=await article.locator('.block-html').innerHTML();await expect(page.locator('.phone')).toHaveCSS('background-color','rgb(255, 255, 255)');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
 await page.screenshot({path:`visual-evidence/accessibility/dark-controls-${width}.png`,fullPage:true})
 await article.locator(':scope > .block-select').focus();await page.keyboard.press('Enter');const toolbarBounds=await article.locator('.block-toolbar').boundingBox(), articleBounds=await article.boundingBox();expect(toolbarBounds!.y+toolbarBounds!.height).toBeLessThanOrEqual(articleBounds!.y);await article.getByRole('button',{name:'编辑文字（双击）',exact:true}).click()
 for(const button of await article.locator('.rich-toolbar button').all())expect(Number.parseFloat(await button.evaluate(el=>getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.getByRole('textbox',{name:'原文内容编辑'}).press('Escape');expect(await article.locator('.block-html').innerHTML()).toBe(original)
})

import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function seed(page: Page, id: string, title: string) {
  const now = Date.now()
  const result = await page.request.put(`/api/projects/${id}`, { data: {
    id, title, author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now,
    blocks: [{ id: 'safety-paragraph', type: 'paragraph', props: {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '原始正文必须保留，失败或冲突不能静默覆盖。' }] }] }, align: 'left',
    } }],
  } })
  expect(result.ok()).toBe(true)
}

async function projects(page: Page) {
  const resource = page.getByTestId('workspace-left')
  await expect(page.locator('.workspace')).toBeVisible()
  if (await resource.isVisible()) await resource.click()
  await page.getByTestId('tab-projects').click()
}

test('failed save blocks new project and project switching until recovery without losing edits', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const target = `safety-target-${suffix}`
  const source = `safety-source-${suffix}`
  await seed(page, target, `可切换目标 ${suffix}`)
  await seed(page, source, `当前原稿 ${suffix}`)
  await page.addInitScript(() => { if (window.top === window) localStorage.setItem('xiumi-color-mode', 'dark') })
  await page.goto('/')
  const title = page.getByLabel('文章标题', { exact: true })
  await expect(title).toHaveValue(`当前原稿 ${suffix}`)
  let failures = 0
  await page.route(`**/api/projects/${source}`, route => {
    if (route.request().method() !== 'PUT') return route.continue()
    failures++
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试：暂时无法写入，请保留当前编辑。' }) })
  })
  const edited = `尚未保存的重要修改 ${suffix}`
  await title.fill(edited)
  await expect(page.getByTestId('save-status')).toHaveText('保存失败')
  await projects(page)
  const countBefore = (await (await page.request.get('/api/projects')).json()).length
  let previous = failures
  await page.getByRole('button', { name: '＋ 新建空白项目', exact: true }).click()
  await expect.poll(() => failures).toBeGreaterThan(previous)
  await expect(page.getByTestId('save-status')).toHaveText('保存失败')
  await expect(title).toHaveValue(edited)
  expect((await (await page.request.get('/api/projects')).json()).length).toBe(countBefore)
  previous = failures
  await page.locator('.list-row').filter({ hasText: `可切换目标 ${suffix}` }).getByRole('button').first().click()
  await expect.poll(() => failures).toBeGreaterThan(previous)
  await expect(page.getByTestId('save-status')).toHaveText('保存失败')
  await expect(title).toHaveValue(edited)
  await expect(page.getByTestId('canvas')).toContainText('原始正文必须保留')
  await expect(page.locator('.toast')).toContainText('已保留当前内容')
  expect((await (await page.request.get(`/api/projects/${source}`)).json()).title).toBe(`当前原稿 ${suffix}`)
  await page.unroute(`**/api/projects/${source}`)
  await page.locator('.list-row').filter({ hasText: `可切换目标 ${suffix}` }).getByRole('button').first().click()
  await expect(title).toHaveValue(`可切换目标 ${suffix}`)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const saved = await (await page.request.get(`/api/projects/${source}`)).json()
  expect(saved.title).toBe(edited)
  expect(JSON.stringify(saved.blocks)).toContain('原始正文必须保留')
})

test('390px dark conflict is readable and offers working export and separate-copy recovery', async ({ page, context }, testInfo) => {
  const id = `mobile-conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const localTitle = `当前页尚未覆盖的本地修改 ${id}`
  const winnerTitle = `服务器保留的胜出版本 ${id}`
  await seed(page, id, '并发修改的长标题：计算机系统概论的学习记录')
  await context.addInitScript(() => { if (window.top === window) localStorage.setItem('xiumi-color-mode', 'dark') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const other = await context.newPage()
  await other.setViewportSize({ width: 390, height: 844 })
  await other.goto('/')
  await expect(other.getByLabel('文章标题', { exact: true })).toHaveValue('并发修改的长标题：计算机系统概论的学习记录')
  await page.getByLabel('文章标题', { exact: true }).fill(winnerTitle)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await other.getByLabel('文章标题', { exact: true }).fill(localTitle)
  const alert = other.locator('.save-conflict')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('你的内容仍在当前页')
  await expect(alert).toHaveCSS('color', 'rgb(255, 159, 155)')
  expect(await alert.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Noto Sans SC')
  expect(await other.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  for (const control of await alert.getByRole('button').all()) {
    await expect(control).toBeInViewport({ ratio: 1 })
    const box = (await control.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }
  await testInfo.attach('dark-mobile-conflict', { body: await other.screenshot({ path: 'visual-evidence/after/mobile-save-conflict.png' }), contentType: 'image/png' })
  await alert.getByRole('button', { name: '导出当前内容', exact: true }).click()
  const downloadEvent = other.waitForEvent('download')
  await other.getByRole('button', { name: '编辑器 JSON', exact: true }).click()
  const download = await downloadEvent
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(exported.title).toBe(localTitle)
  expect(JSON.stringify(exported.blocks)).toContain('原始正文必须保留')
  await other.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await alert.getByRole('button', { name: '另存冲突副本', exact: true }).click()
  await expect(other.getByTestId('save-status')).toHaveText('已保存')
  await expect(alert).toHaveCount(0)
  await expect(other.getByLabel('文章标题', { exact: true })).toHaveValue(`${localTitle}（冲突副本）`)
  const list = await (await page.request.get('/api/projects')).json()
  const copy = list.find((item: { title: string }) => item.title === `${localTitle}（冲突副本）`)
  expect(copy.id).not.toBe(id)
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).title).toBe(winnerTitle)
  expect(JSON.stringify((await (await page.request.get(`/api/projects/${copy.id}`)).json()).blocks)).toContain('原始正文必须保留')
  await other.close()
})

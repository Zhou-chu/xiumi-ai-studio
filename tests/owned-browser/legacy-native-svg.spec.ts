import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { independentSvgBackup, nativeSvgFixture, nativeSvgProjectId } from '../fixtures/legacy-native-svg'

test.use({ hasTouch: true })

test('rejects the full cross-fragment article, then restores independent SVG click and touch through save and reopen', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-native-svg-browser-'))
  const child = fork('tests/fixtures/start-owned-directory-migration.ts', [join(root, 'unused'), join(root, 'target')], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  const exited = once(child, 'exit')
  try {
    const [port] = await Promise.race([once(child, 'message'), exited.then(() => { throw Error('Test server failed to start') })])
    const origin = 'http://127.0.0.1:' + port
    await page.goto(origin)
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    await page.getByTestId('tab-projects').click()
    const backup = page.getByRole('button', { name: '项目和素材备份', exact: true })
    if (!await backup.isVisible()) await page.getByTestId('toolbar-more').click()
    await backup.click()
    const panel = page.getByRole('dialog', { name: '项目和素材备份' })
    const restore = panel.getByRole('region', { name: '从整库 ZIP 恢复部分项目' })
    const upload = restore.getByLabel('选择整库 ZIP')
    const preview = restore.getByRole('button', { name: '预览恢复' })
    const confirm = restore.getByRole('button', { name: '确认添加项目' })
    await upload.setInputFiles(fileURLToPath(nativeSvgFixture))
    await preview.click()
    await restore.getByText('不支持的项目（1）', { exact: true }).click()
    await expect(restore.getByText(nativeSvgProjectId, { exact: true })).toBeVisible()
    await expect(confirm).toBeDisabled()
    expect((await page.request.get(origin + '/api/projects/' + nativeSvgProjectId)).status()).toBe(404)

    await upload.setInputFiles({ name: 'independent-native-svg.zip', mimeType: 'application/zip', buffer: (await independentSvgBackup()).bytes })
    await preview.click()
    await expect(restore.getByRole('status')).toContainText('预计新增 1 个项目')
    await confirm.click()
    await expect(restore.getByRole('status')).toHaveText('新增 1 个项目。')
    await panel.getByRole('button', { name: '关闭', exact: true }).last().click()
    const original = 'Native SVG interaction acceptance fixture'
    const restored = page.getByRole('button', { name: /Native SVG interaction acceptance fixture/ })
    await restored.click()
    const title = page.getByRole('textbox', { name: '文章标题' })
    const canvasSets = page.getByTestId('canvas').locator('svg rect > set')
    // Clicking the list starts a save-and-load operation, not a synchronous switch.
    await expect(restored).toHaveAttribute('aria-current', 'page')
    await expect(title).toHaveValue(original)
    await expect(canvasSets).toHaveCount(2)

    const changed = 'Native SVG article after ordinary save'
    const project = origin + '/api/projects/' + nativeSvgProjectId
    const [saved] = await Promise.all([
      page.waitForResponse(r => r.url() === project && r.request().method() === 'PUT' && r.request().postDataJSON()?.title === changed),
      title.fill(changed),
    ])
    expect(saved.ok()).toBe(true)
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    const persisted = await page.request.get(project)
    expect(persisted.ok()).toBe(true)
    expect(await persisted.json()).toMatchObject({ id: nativeSvgProjectId, title: changed })
    await page.reload()
    await expect(title).toHaveValue(changed)
    await expect(canvasSets).toHaveCount(2)

    const openPreview = page.getByTestId('open-preview')
    if (!await openPreview.isVisible()) await page.getByTestId('toolbar-more').click()
    await openPreview.click()
    const article = page.frameLocator('[data-testid="preview-frame"]')
    const first = article.locator('svg rect').nth(0)
    const second = article.locator('svg rect').nth(1)
    await expect(first).toHaveCSS('visibility', 'visible')
    await expect(second).toHaveCSS('opacity', '1')
    await first.click()
    await expect(first).toHaveCSS('visibility', 'hidden')
    await expect(second).toHaveCSS('opacity', '1')
    await second.tap()
    await expect(second).toHaveCSS('opacity', '0.2')
    const discrete = article.locator('svg rect > animate')
    await expect(discrete).toHaveAttribute('values', 'visible;hidden;collapse')
    await expect(discrete).toHaveAttribute('calcMode', 'discrete')
    await expect(article.locator('svg [id], svg [href]')).toHaveCount(0)
    await expect(page.getByTestId('canvas').locator('svg rect').first()).toHaveCSS('visibility', 'visible')
  } finally {
    if (child.connected) child.disconnect()
    await exited
    await rm(root, { recursive: true, force: true })
  }
})

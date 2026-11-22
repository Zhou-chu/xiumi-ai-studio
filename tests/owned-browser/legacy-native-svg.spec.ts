import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

    const optIn = restore.getByLabel('离线查看受支持的跨块 SVG（只读）')
    await expect(optIn).not.toBeChecked()
    const frameHttpRequests: string[] = []
    page.on('request', request => {
      if (!/^https?:/.test(request.url())) return
      try { if (request.frame().parentFrame()) frameHttpRequests.push(request.url()) } catch { /* no frame */ }
    })
    await optIn.check()
    await preview.click()
    await expect(restore.getByText('可离线预览，暂不能恢复到项目')).toBeVisible()
    await expect(confirm).toBeDisabled()
    const frame = restore.locator('iframe[title="跨块 SVG 离线预览"]')
    await expect(frame).toHaveAttribute('sandbox', '')
    const isolated = frame.contentFrame()
    const trigger = isolated.locator('#xiumi_proof_1')
    const follower = isolated.locator('svg').nth(3).locator('rect')
    const target = isolated.locator('#xiumi_proof_2')
    await expect(follower).toHaveCSS('opacity', '1')
    await expect(target).toHaveCSS('opacity', '1')
    await restore.evaluate(section => {
      const button = section.ownerDocument.createElement('button')
      button.id = 'xiumi_proof_1'
      button.textContent = 'Outer preview decoy'
      section.prepend(button)
    })
    await restore.getByRole('button', { name: 'Outer preview decoy' }).click()
    await expect(follower).toHaveCSS('opacity', '1')
    await expect(target).toHaveCSS('opacity', '1')
    await trigger.click()
    await expect(follower).toHaveCSS('opacity', '0.3')
    await expect(target).toHaveCSS('opacity', '0.4')
    expect(frameHttpRequests).toEqual([])
    const cancellation = page.waitForResponse(response => response.status() === 204 &&
      response.request().method() === 'POST' && /\/api\/data\/restore\/[a-f0-9]{64}\/cancel$/.test(new URL(response.url()).pathname))
    await restore.getByRole('button', { name: '取消预览' }).click()
    await cancellation
    await expect(frame).toHaveCount(0)
    expect((await page.request.get(origin + '/api/projects/' + nativeSvgProjectId)).status()).toBe(404)
    await optIn.uncheck()

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

test('restores, edits and reopens the upstream linked SVG and downloads working offline HTML', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-linked-svg-browser-'))
  const child = fork('tests/fixtures/start-owned-directory-migration.ts', [join(root, 'unused'), join(root, 'target')], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  const exited = once(child, 'exit')
  try {
    const [port] = await Promise.race([once(child, 'message'), exited.then(() => { throw Error('Test server failed to start') })])
    const origin = 'http://127.0.0.1:' + port
    const project = origin + '/api/projects/' + nativeSvgProjectId
    await page.goto(origin)
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    await page.getByTestId('tab-projects').click()
    const backup = page.getByRole('button', { name: '项目和素材备份', exact: true })
    if (!await backup.isVisible()) await page.getByTestId('toolbar-more').click()
    await backup.click()
    const panel = page.getByRole('dialog', { name: '项目和素材备份' })
    const restore = panel.getByRole('region', { name: '从整库 ZIP 恢复部分项目' })
    const optIn = restore.getByLabel('恢复支持的跨块 SVG 联动（仅本机编辑与导出）')
    await expect(optIn).not.toBeChecked()
    await optIn.check()
    await restore.getByLabel('选择整库 ZIP').setInputFiles(fileURLToPath(nativeSvgFixture))
    await restore.getByRole('button', { name: '预览恢复' }).click()
    await expect(restore.getByRole('status')).toContainText('预计新增 1 个项目')
    expect((await page.request.get(project)).status()).toBe(404)
    await restore.getByRole('button', { name: '确认添加项目' }).click()
    await expect(restore.getByRole('status')).toHaveText('新增 1 个项目。')
    await panel.getByRole('button', { name: '关闭', exact: true }).last().click()
    const item = page.getByRole('button', { name: /Native SVG interaction acceptance fixture/ })
    await item.click()
    await expect(item).toHaveAttribute('aria-current', 'page')
    const frame = page.locator('iframe[title="跨块 SVG 联动"]')
    await expect(frame).toHaveAttribute('sandbox', '')
    await frame.contentFrame().locator('#xiumi_proof_1').click()
    await expect(frame.contentFrame().locator('svg').nth(1).locator('rect')).toHaveCSS('opacity', '0.3')
    await expect(frame.contentFrame().locator('#xiumi_proof_2')).toHaveCSS('opacity', '0.4')
    await page.locator('[data-block-id="cross-trigger"]').focus()
    await page.locator('[data-block-id="cross-trigger"]').press('Enter')
    const opacity = page.getByLabel('跟随图形的联动透明度')
    const saving = page.waitForResponse(r => r.url() === project && r.request().method() === 'PUT' &&
      r.request().postDataJSON()?.blocks?.[2]?.props?.scene?.timing === 7)
    await opacity.selectOption('7')
    expect((await saving).ok()).toBe(true)
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    await page.reload()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('Native SVG interaction acceptance fixture')
    await frame.contentFrame().locator('#xiumi_proof_1').click()
    await expect(frame.contentFrame().locator('svg').nth(1).locator('rect')).toHaveCSS('opacity', '0.7')
    await expect(frame.contentFrame().locator('#xiumi_proof_2')).toHaveCSS('opacity', '0.4')
    await page.getByTestId('open-export').click()
    const exporter = page.getByRole('dialog', { name: '导出与发布' })
    await expect(exporter.getByTestId('copy-wechat')).toBeDisabled()
    await expect(exporter.getByTestId('xiumi-package')).toBeDisabled()
    const downloading = page.waitForEvent('download')
    await exporter.getByRole('button', { name: '本地 HTML（保留跨块联动）' }).click()
    const file = join(root, 'offline.html')
    await (await downloading).saveAs(file)
    const content = await readFile(file, 'utf8')
    expect(content).toContain("default-src 'none'")
    expect(content).not.toMatch(/art_trigger|art_explicit_target/)
    const offline = await page.context().newPage()
    const http: string[] = []
    offline.on('request', req => { if (/^https?:/.test(req.url())) http.push(req.url()) })
    try {
      await offline.goto(pathToFileURL(file).href)
      await offline.locator('#xiumi_proof_3_1').click()
      await expect(offline.locator('#xiumi_proof_3_2')).toHaveCSS('opacity', '0.4')
      await expect(offline.locator('svg').nth(3).locator('rect')).toHaveCSS('opacity', '0.7')
      expect(http).toEqual([])
    } finally {
      await offline.close()
    }
  } finally {
    if (child.connected) child.disconnect()
    await exited
    await rm(root, { recursive: true, force: true })
  }
})

import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { seedDirectoryDesign } from '../fixtures/legacy-directory-design'

test('restores old-directory design without a manuscript, uses its theme and reopens its independent component', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-design-browser-'))
  const source = join(root, 'old')
  const target = join(root, 'target')
  const { fixtures, png } = await seedDirectoryDesign(source)
  const child = fork('tests/fixtures/start-owned-directory-migration.ts', [source, target], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  const exited = once(child, 'exit')
  try {
    const [port] = await Promise.race([once(child, 'message'), exited.then(() => { throw Error('Test server failed to start') })])
    const origin = 'http://127.0.0.1:' + port
    const bootWrite = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().startsWith(origin + '/api/projects/') && r.ok())
    await page.goto(origin)
    await bootWrite
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    const initial = await readdir(join(target, 'projects'))
    expect(initial).toHaveLength(1)
    const original = await readFile(join(target, 'projects', initial[0]))
    await page.getByTestId('tab-projects').click()
    const backup = page.getByRole('button', { name: '项目和素材备份', exact: true })
    if (!await backup.isVisible()) await page.getByTestId('toolbar-more').click()
    await backup.click()
    const panel = page.getByRole('dialog', { name: '项目和素材备份' })
    const section = panel.getByRole('region', { name: '从本机旧目录迁移项目' })
    const opt = section.getByLabel('迁移旧目录中支持的主题、模板和组件')
    await expect(opt).not.toBeChecked()
    await expect(section.getByLabel('独立迁移旧素材库中已索引的 PNG/JPEG')).not.toBeChecked()
    await opt.check()
    await section.getByRole('button', { name: '检测已配置旧目录' }).click()
    const receipt = section.getByRole('status')
    await expect(receipt).toContainText('预计新增 0')
    for (const name of ['主题', '模板', '组件']) await expect(receipt).toContainText(name + '预计新增 1')
    expect(await readdir(join(target, 'assets'))).toEqual([])
    expect(await readdir(join(target, 'components'))).toEqual([])
    await section.getByRole('button', { name: '确认迁移所选数据' }).click()
    for (const name of ['主题', '模板', '组件']) await expect(receipt).toContainText(name + '已新增 1')
    expect(await readdir(join(target, 'projects'))).toEqual(initial)
    expect(await readFile(join(target, 'projects', initial[0]))).toEqual(original)
    expect((await readdir(join(target, 'assets'))).sort()).toEqual(['_index.json', 'fixture-template-only-teal.png'])
    for (const [path, bytes] of fixtures) expect(await readFile(join(source, path))).toEqual(bytes)
    expect(await readdir(source)).not.toContain('projects')
    await panel.getByRole('button', { name: '关闭', exact: true }).last().click()
    await page.getByTestId('tab-templates').click()
    const template = page.locator('.tpl-item').filter({ hasText: 'Template-only teal image' })
    await template.getByRole('button', { name: '新建', exact: true }).click()
    const canvas = page.getByTestId('canvas')
    await expect(canvas).toContainText('Archived template heading')
    const heading = canvas.locator('[data-block-type="heading"]')
    await expect(heading.getByText('01', { exact: true })).toHaveCSS('color', 'rgb(17, 34, 51)')
    await expect(canvas.locator('img[src*="/media/fixture-template-only-teal.png?"][src*="gen="]')).toBeVisible()
    await expect(page.getByTestId('save-status')).toHaveText('已保存')

    await page.getByTestId('tab-projects').click()
    // The click starts an async save of the template before the new doc is loaded.
    const blankWrite = page.waitForResponse(r => r.request().method() === 'PUT' &&
      r.url().startsWith(origin + '/api/projects/') && r.ok() &&
      r.request().postDataJSON()?.title === '未命名推文')
    await page.getByRole('button', { name: '新建空白项目' }).click()
    await blankWrite
    const title = 'Independently reusable directory component'
    const titleInput = page.getByRole('textbox', { name: '文章标题' })
    await expect(titleInput).toHaveValue('未命名推文')
    await titleInput.fill(title)
    await expect(titleInput).toHaveValue(title)
    await page.getByTestId('tab-components').click()
    const card = page.getByTestId('component-card').filter({ hasText: 'Archived local component' })
    await card.getByRole('button', { name: '插入组件：Archived local component', exact: true }).click()
    await expect(canvas.getByText('Archived component text', { exact: true })).toBeVisible()
    await expect(page.getByTestId('save-status')).toHaveText('已保存')
    await page.reload()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
    await expect(canvas.getByText('Archived component text', { exact: true })).toBeVisible()
    const image = canvas.getByAltText('Archived component image', { exact: true })
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([7, 5])
    const src = await image.getAttribute('src')
    const media = new URL(src!, origin)
    media.searchParams.delete('fit')
    media.searchParams.set('w', '2400')
    const current = await page.request.get(media.toString())
    expect(current.ok()).toBe(true)
    expect(await current.body()).toEqual(png)
  } finally {
    if (child.connected) child.disconnect()
    await exited
    await rm(root, { recursive: true, force: true })
  }
})

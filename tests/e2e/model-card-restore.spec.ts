import { fork } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'

async function downloadModelOnlyLibrary(id: string) {
  const child = fork('tests/fixtures/start-asset-backup-source.ts', { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  const exited = once(child, 'exit')
  try {
    const [port] = await Promise.race([once(child, 'message'), exited.then(() => { throw Error('Source launcher failed') })])
    const base = 'http://127.0.0.1:' + port
    const saved = await fetch(base + '/api/settings/ai', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeId: id, profiles: [{ id, name: 'Recovered model reference', model: 'fixture-model', provider: 'openai', baseUrl: 'https://example.invalid/synthetic-path', apiKey: 'synthetic-unused-key' }] }),
    })
    expect(saved.status).toBe(200)
    await saved.text()
    const download = await fetch(base + '/api/data/backup')
    expect(download.status).toBe(200)
    return Buffer.from(await download.arrayBuffer())
  } finally {
    if (child.connected) child.disconnect()
    await exited
  }
}

test('restores credential-free reference from genuine model-only ZIP and opens settings without provider traffic', async ({ page, request }) => {
  const id = randomUUID()
  const bytes = await downloadModelOnlyLibrary(id)
  const zip = await JSZip.loadAsync(bytes)
  expect(Object.keys(zip.files).sort()).toEqual(['settings.json', 'xiumi-backup.json'])
  const before = await (await request.get('/api/settings/ai')).json()
  const forbidden: string[] = []
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
        (/^\/api\/(?:settings\/ai|ai)(?:\/|$)/.test(url.pathname) && route.request().method() !== 'GET')) {
      forbidden.push(url.pathname)
      await route.abort()
    } else await route.fallback()
  })
  await page.goto('/')
  await page.getByTestId('tab-projects').click()
  const button = page.getByRole('button', { name: '项目和素材备份', exact: true })
  if (!(await button.isVisible())) await page.getByTestId('toolbar-more').click()
  await button.click()
  const dialog = page.getByRole('dialog', { name: '项目和素材备份' })
  const restore = dialog.getByRole('region', { name: '从整库 ZIP 恢复部分项目' })
  await restore.getByLabel('选择整库 ZIP').setInputFiles({ name: 'model-only.zip', buffer: bytes, mimeType: 'application/zip' })
  const checkbox = restore.getByLabel('恢复只读模型资料')
  await expect(checkbox).not.toBeChecked()
  await checkbox.check()
  await restore.getByRole('button', { name: '预览恢复' }).click()
  await expect(restore.getByText('可添加的模型资料（1）')).toBeVisible()
  expect(await (await request.get('/api/settings/ai')).json()).toEqual(before)
  await restore.getByRole('button', { name: '确认添加所选数据' }).click()
  await expect(restore.getByText('新增模型资料（1）')).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
  if (!(await page.getByTestId('open-ai-settings').isVisible())) await page.getByTestId('toolbar-more').click()
  await page.getByTestId('open-ai-settings').click()
  const settings = page.getByRole('dialog', { name: 'AI 模型设置' })
  const card = settings.getByRole('region', { name: '已恢复的只读模型资料' }).getByText('Recovered model reference', { exact: true }).locator('..')
  await expect(card).toContainText('未配置密钥')
  await expect(settings.getByRole('radio', { name: '设为当前模型：Recovered model reference' })).toHaveCount(0)
  await expect(settings.getByRole('button', { name: '编辑模型：Recovered model reference' })).toHaveCount(0)
  const after = await (await request.get('/api/settings/ai')).json()
  expect(after.activeId).toBe(before.activeId)
  expect(after.profiles).toEqual(before.profiles)
  expect(after.modelCards).toContainEqual({ id, name: 'Recovered model reference', model: 'fixture-model', provider: 'openai' })
  expect(forbidden).toEqual([])
})

import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'

test('owned built app migrates only after confirmation and opens the imported upstream manuscript', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-directory-browser-'))
  const source = join(root, 'legacy')
  const projects = join(source, 'data', 'projects')
  const formerDir = process.env.DATA_DIR
  const formerNodeEnv = process.env.NODE_ENV
  let server: ReturnType<typeof createServer> | undefined
  try {
    await readFile(join(process.cwd(), 'dist', 'index.html'))
    await mkdir(projects, { recursive: true })
    const zip = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-library.zip', import.meta.url)))
    const fixture = await zip.file('projects/edited.json')!.async('nodebuffer')
    await writeFile(join(projects, 'edited.json'), fixture)
    await writeFile(join(source, '.env'), 'TEST_SENTINEL=unchanged')
    process.env.DATA_DIR = join(root, 'new')
    process.env.NODE_ENV = 'production'
    const { createApp } = await import('../../server/app')
    server = createServer(createApp({ legacyMigrationSource: source })).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('isolated server not bound')
    const base = 'http://127.0.0.1:' + address.port
    const project = base + '/api/projects/edited'
    await page.goto(base)
    await page.getByTestId('tab-projects').click()
    const backup = page.getByRole('button', { name: '项目和素材备份', exact: true })
    if (!await backup.isVisible()) await page.getByTestId('toolbar-more').click()
    await backup.click()
    const modal = page.getByRole('dialog', { name: '项目和素材备份', exact: true })
    const migration = modal.getByRole('region', { name: '从本机旧目录迁移文字项目' })
    const preview = migration.getByRole('button', { name: '检测已配置旧目录' })
    const confirm = migration.getByRole('button', { name: '确认迁移文字项目' })
    await preview.click()
    await expect(migration.getByRole('status')).toContainText('尚未写入。预计新增 1')
    expect((await page.request.get(project)).status()).toBe(404)
    await migration.getByRole('button', { name: '取消目录迁移' }).click()
    await expect(confirm).toHaveCount(0)
    expect((await page.request.get(project)).status()).toBe(404)
    await preview.click()
    await confirm.click()
    await expect(migration.getByRole('status')).toContainText('已新增 1')
    await modal.getByRole('button', { name: '关闭', exact: true }).last().click()
    const title = JSON.parse(fixture.toString('utf8')).title as string
    await page.getByRole('button', { name: title, exact: false }).click()
    await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(title)
    expect(await readFile(join(projects, 'edited.json'))).toEqual(fixture)
    expect(await readFile(join(source, '.env'), 'utf8')).toBe('TEST_SENTINEL=unchanged')
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    }
    if (formerDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = formerDir
    if (formerNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = formerNodeEnv
    await rm(root, { recursive: true, force: true })
  }
})

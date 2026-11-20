import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import sharp from 'sharp'
import { expect, test } from './fixture'

const run = promisify(execFile)

test('user creates, edits, uploads, reopens and restores the same downloaded ZIP', async ({ page, origin }) => {
  test.setTimeout(60_000)
  const title = '真实操作验收文稿'
  const body = '浏览器编辑后的验收正文'
  const caption = '随文保留的本地图片'
  const imageName = 'user-workflow-figure.png'
  const imageBytes = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#123456' } }).png().toBuffer()

  await page.goto(origin)
  const canvas = page.getByTestId('canvas')
  await expect(canvas).toBeVisible()
  await page.getByTestId('tab-projects').click()
  const blankTypes = ['cover', 'heading', 'paragraph', 'ending']
  const [created] = await Promise.all([
    page.waitForResponse(response => {
      const request = response.request()
      if (request.method() !== 'PUT' || !response.ok() || new URL(response.url()).origin !== origin
        || !new URL(response.url()).pathname.startsWith('/api/projects/')) return false
      const doc = request.postDataJSON()
      return doc.revision === undefined && Array.isArray(doc.blocks)
        && doc.blocks.map((block: { type: string }) => block.type).join(',') === blankTypes.join(',')
    }),
    page.getByRole('button', { name: '新建空白项目' }).click(),
  ])
  const id = created.request().postDataJSON().id as string
  expect(id).toMatch(/^[\w-]{1,64}$/)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const titleInput = page.getByRole('textbox', { name: '文章标题' })
  await titleInput.fill(title)
  const paragraph = canvas.locator('[data-block-type="paragraph"]')
  await paragraph.click()
  await page.locator('.panel.right').getByRole('textbox', { name: /^正文/ }).fill(body)
  await expect(paragraph).toContainText(body)

  await page.getByTestId('tab-blocks').click()
  await page.getByTestId('kit-photos2').click()
  const photos = canvas.locator('[data-block-type="photos"]')
  await expect(photos).toHaveCount(1)
  await page.getByTestId('tab-assets').click()
  const [upload] = await Promise.all([
    page.waitForResponse(response => response.url() === `${origin}/api/assets` && response.request().method() === 'POST'),
    page.getByTestId('asset-upload').setInputFiles({ name: imageName, mimeType: 'image/png', buffer: imageBytes }),
  ])
  expect(upload.ok()).toBe(true)
  const [asset] = await upload.json() as Array<{ id: string; file: string }>
  expect(asset.id).toMatch(/^[\w-]{1,64}$/)
  expect(asset.file).toMatch(/^[\w-]{1,64}\.(jpg|png)$/)
  await page.getByAltText(imageName, { exact: true }).click()
  const placedImage = photos.locator('img:not([data-slot])')
  await expect(placedImage).toHaveCount(1)
  await expect.poll(() => placedImage.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const [saved] = await Promise.all([
    page.waitForResponse(response => {
      if (response.url() !== created.url() || response.request().method() !== 'PUT') return false
      const draft = response.request().postDataJSON()
      const blocks = JSON.stringify(draft.blocks)
      return draft.title === title && [body, caption, asset.file].every(value => blocks.includes(value))
    }),
    page.getByTestId('pic-row').first().locator('input').fill(caption),
  ])
  expect(saved.ok()).toBe(true)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')

  await page.reload()
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(titleInput).toHaveValue(title)
  await expect(paragraph).toContainText(body)
  await expect(photos).toContainText(caption)
  await expect.poll(() => placedImage.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

  await page.getByTestId('open-preview').click()
  const preview = page.getByRole('dialog', { name: '手机预览' })
  const frame = preview.getByTestId('preview-frame').contentFrame()
  await expect(frame.locator('body')).toContainText(body)
  await expect(frame.locator('body')).toContainText(caption)
  await expect.poll(() => frame.locator(`img[src*="${asset.file}"]`).evaluate(img =>
    (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await preview.getByRole('button', { name: '关闭', exact: true }).click()

  await page.getByTestId('open-export').click()
  const exported = page.getByRole('dialog', { name: '导出与发布' })
  const [htmlDownload] = await Promise.all([
    page.waitForEvent('download'),
    exported.getByRole('button', { name: '微信 HTML（图片内嵌）', exact: true }).click(),
  ])
  expect(htmlDownload.suggestedFilename()).toBe(`${title}.html`)
  const html = await readFile((await htmlDownload.path())!, 'utf8')
  for (const text of [`<title>${title}</title>`, body, caption]) expect(html).toContain(text)
  expect(html).toMatch(/<img[^>]+src="data:image\/(?:jpeg|png);base64,/)
  await exported.getByRole('button', { name: '关闭', exact: true }).click()

  const menu = page.getByTestId('toolbar-more')
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: '项目和素材备份' }).click()
  const dialog = page.getByRole('dialog', { name: '项目和素材备份' })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: '下载 ZIP 备份' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^xiumi-projects-\d{4}-\d{2}-\d{2}\.zip$/)
  const archive = await download.path()
  expect(archive).not.toBeNull()
  const zip = await JSZip.loadAsync(await readFile(archive!))
  const currentPath = `projects/${id}.json`
  const assetPath = `assets/${asset.file}`
  const backedUpDoc = JSON.parse(await zip.file(currentPath)!.async('string'))
  expect(backedUpDoc).toMatchObject({ id, title })
  for (const text of [body, caption, asset.file]) expect(JSON.stringify(backedUpDoc.blocks)).toContain(text)
  const backedUpImage = await zip.file(assetPath)!.async('nodebuffer')
  expect(await sharp(backedUpImage).metadata()).toMatchObject({ width: 96, height: 64 })
  const originalImage = await page.request.get(`${origin}/media/${asset.file}?w=2400`)
  expect(originalImage.ok()).toBe(true)
  expect(backedUpImage).toEqual(await originalImage.body())

  const scratch = await mkdtemp(join(tmpdir(), 'xiumi-user-restore-'))
  try {
    const base = join(scratch, 'empty-current')
    const incoming = join(scratch, 'unpacked-download')
    const output = join(scratch, 'restored')
    for (const root of [base, incoming]) {
      for (const dir of ['projects', 'assets']) await mkdir(join(root, dir), { recursive: true })
    }
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue
      // The restore CLI takes manually unpacked project snapshots; never write arbitrary ZIP paths.
      expect(entry.name).toMatch(/^(?:xiumi-backup\.json|projects\/[\w-]{1,64}\.json|assets\/(?:_index\.json|[\w-]{1,64}\.(?:jpg|png)))$/)
      const destination = join(incoming, entry.name)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, await entry.async('nodebuffer'))
    }
    await run(process.execPath, ['scripts/restore-project-backup.mjs', base, incoming, output], { timeout: 15_000 })
    const restored = JSON.parse(await readFile(join(output, currentPath), 'utf8'))
    expect(restored).toMatchObject({ id, title, blocks: backedUpDoc.blocks })
    expect(await readFile(join(output, assetPath))).toEqual(backedUpImage)
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
  }
})

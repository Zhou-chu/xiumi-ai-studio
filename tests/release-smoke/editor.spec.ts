import { readFile } from 'node:fs/promises'
import { expect, test } from './fixture'

test('built editor saves title and paragraph edits, reopens them, and exports the new content', async ({ page, origin }) => {
  const id = 'release-smoke'
  const timestamp = Date.now()
  const source = '发布检查的原始正文'
  const original = '发布检查样例'
  const editedTitle = '发布检查已修改'
  const editedBody = '发布检查保存后的新正文'
  const seed = await page.request.put(`${origin}/api/projects/${id}`, { data: {
    id, title: original, author: '', digest: '', themeId: 'minimal-magazine',
    createdAt: timestamp, updatedAt: timestamp,
    blocks: [{ id: 'release-paragraph', type: 'paragraph', props: {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: source }] }] },
      align: 'left',
    } }],
  } })
  expect(seed.ok()).toBe(true)

  const scriptResponse = page.waitForResponse(response =>
    new URL(response.url()).origin === origin && /^\/assets\/[^/]+\.js$/.test(new URL(response.url()).pathname)
    && response.request().resourceType() === 'script')
  const document = await page.goto(origin)
  expect(document?.ok()).toBe(true)
  expect(await document?.text()).toBe(await readFile('dist/index.html', 'utf8'))
  expect((await scriptResponse).ok()).toBe(true)

  const title = page.getByLabel('文章标题', { exact: true })
  const paragraph = page.getByTestId('canvas').locator('[data-block-id="release-paragraph"]')
  await expect(title).toHaveValue(original)
  await expect(paragraph.locator('p').first()).toHaveText(source)
  await title.fill(editedTitle)
  await paragraph.click()
  const field = page.locator('.panel.right').getByRole('textbox', { name: /^正文/ })
  await expect(field).toHaveValue(source)
  const [save] = await Promise.all([
    page.waitForResponse(response => {
      if (response.url() !== `${origin}/api/projects/${id}` || response.request().method() !== 'PUT') return false
      const draft = response.request().postDataJSON()
      return draft.title === editedTitle && JSON.stringify(draft.blocks).includes(editedBody)
    }),
    field.fill(editedBody),
  ])
  expect(save.ok()).toBe(true)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')

  await page.reload()
  await expect(title).toHaveValue(editedTitle)
  await expect(paragraph.locator('p').first()).toHaveText(editedBody)
  await page.getByTestId('open-export').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Markdown', exact: true }).click(),
  ])
  // This project has only a paragraph; the title is metadata, not a cover block.
  expect(download.suggestedFilename()).toBe(`${editedTitle}.md`)
  const path = await download.path()
  expect(path).not.toBeNull()
  expect(await readFile(path!, 'utf8')).toBe(`${editedBody}\n`)

  const [htmlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '微信 HTML（图片内嵌）', exact: true }).click(),
  ])
  expect(htmlDownload.suggestedFilename()).toBe(`${editedTitle}.html`)
  const htmlPath = await htmlDownload.path()
  expect(htmlPath).not.toBeNull()
  const html = await readFile(htmlPath!, 'utf8')
  expect(html).toContain(`<title>${editedTitle}</title>`)
  expect(html).toContain(editedBody)
  expect(html).not.toContain(source)
})

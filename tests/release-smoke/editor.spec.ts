import { readFile } from 'node:fs/promises'
import { expect, test } from './fixture'

test('built editor saves a changed project, reopens it, and exports the edit', async ({ page, origin }) => {
  const id = 'release-smoke'
  const timestamp = Date.now()
  const source = '发布检查的原始正文'
  const original = '发布检查样例'
  const edited = '发布检查已修改'
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
  await expect(title).toHaveValue(original)
  await expect(page.getByTestId('canvas')).toContainText(source)
  const [save] = await Promise.all([
    page.waitForResponse(response => response.url() === `${origin}/api/projects/${id}`
      && response.request().method() === 'PUT'),
    title.fill(edited),
  ])
  expect(save.ok()).toBe(true)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')

  await page.reload()
  await expect(title).toHaveValue(edited)
  await expect(page.getByTestId('canvas')).toContainText(source)
  await page.getByTestId('open-export').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Markdown', exact: true }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.md$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  const markdown = await readFile(path!, 'utf8')
  expect(markdown).toContain(`# ${edited}`)
  expect(markdown).toContain(source)
})

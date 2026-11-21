import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { compileDoc } from '../../src/core/compiler'
import { defaultReplay, makeItem, makeScene } from '../../src/core/replay/schema'
import type { Block, Doc } from '../../src/core/types'
import { XIUMI_LIMIT, xiumiLength, xiumiSvgBoxes } from '../../src/core/xiumiExport'
import { HOSTED_REPLAY_PATH } from '../../src/core/hostedReplayMedia'

const token = 'a'.repeat(64)
const cdn = 'https://mmbiz.qpic.cn/mock/' + 'a'.repeat(800) + '.png'

async function openExport(page: Page, id: string, enabled = true) {
  let normal = 0
  let current = 0
  let staged: string[] = []
  let invalid = false
  const requests: string[] = []
  await page.route('**/api/wechat/status', route => route.fulfill({ json: { configured: false, ...(enabled ? { ownedReplay: true } : {}) } }))
  await page.route(/\/api\/wechat\/(?:upload-images|draft)$/, async route => { normal++; await route.abort() })
  await page.route('https://mmbiz.qpic.cn/**', route => route.abort())
  await page.route('**' + HOSTED_REPLAY_PATH + '/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)!
    requests.push(action)
    const payload = route.request().postDataJSON()
    if (action === 'prepare') {
      staged = payload.sources
      current++
      expect(staged).toHaveLength(1)
      expect(staged[0]).toMatch(/^\/media\/[\w-]+\.(png|jpg)\?w=1500$/)
      return route.fulfill({ json: { token, images: staged.length } })
    }
    expect(payload.token).toBe(token)
    if (action === 'cancel') return route.fulfill({ status: 204 })
    expect(action).toBe('transfer')
    expect(payload.confirm).toBe(true)
    return route.fulfill({ json: { mapping: invalid ? {} : { [staged[0]]: cdn } } })
  })

  const fixture = await JSZip.loadAsync(await readFile(new URL('../fixtures/legacy-backup/upstream-component.zip', import.meta.url)))
  const bytes = await fixture.file('assets/archived-component-photo.png')!.async('nodebuffer')
  const uploaded = await page.request.post('/api/assets', {
    multipart: { files: { name: 'hosted-loopback-fixture.png', mimeType: 'image/png', buffer: bytes } },
  })
  expect(uploaded.ok()).toBe(true)
  const [asset] = await uploaded.json()
  const image = { src: '/media/' + asset.file, assetId: asset.id, width: asset.width, height: asset.height }
  const replay = defaultReplay()
  replay.canvas.background = { type: 'image', value: '#071226', image }
  replay.scenes = [makeScene([makeItem('title', { content: 'Hosted staged synthetic journey' }), makeItem('image', { image })])]
  const filler: Block<'html'> = { id: 'near-split', type: 'html', props: { html: '<p></p>'.repeat(200), label: 'Bounded split' } }
  const doc: Doc = { id, title: id, author: '', digest: '', themeId: 'tsinghua-purple', createdAt: Date.now(), updatedAt: Date.now(), blocks: [
    { id: 'browser-hosted', type: 'replay', props: replay }, filler,
  ] }
  const prior = xiumiLength(xiumiSvgBoxes(compileDoc(doc).html))
  filler.props.html = ('<p>' + 'x'.repeat(Math.floor((XIUMI_LIMIT - prior - 350) / 200)) + '</p>').repeat(200)
  expect((await page.request.put('/api/projects/' + id, { data: doc })).ok()).toBe(true)
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue(id)
  await page.getByTestId('open-export').click()
  const dialog = page.getByRole('dialog', { name: '导出与发布' })
  const button = dialog.getByTestId('xiumi-upload')
  return { dialog, button, requests, normal: () => normal, stageCount: () => current, rejectMapping: () => { invalid = true } }
}

test('only exposes the staged replay action on an owned opt-in runtime', async ({ page }) => {
  const fixture = await openExport(page, 'hosted-disabled', false)
  await expect(fixture.dialog.getByRole('status')).toContainText('上传秀米暂不可用')
  await expect(fixture.button).toHaveCount(0)
  expect(fixture.requests).toEqual([])
  expect(fixture.normal()).toBe(0)
})

test('requires separate upload and actual-split download consents, and never downloads a failed mapping', async ({ page }) => {
  const fixture = await openExport(page, 'hosted-owned-browser')
  await expect(fixture.dialog.getByTestId('copy-wechat')).toBeDisabled()
  await expect(fixture.button).toBeEnabled()
  expect(fixture.requests).toEqual([])
  let downloads = 0
  page.on('download', () => downloads++)
  const dialogs: string[] = []
  let allowUpload = false
  let allowDownload = false
  page.on('dialog', async dialog => {
    const message = dialog.message()
    dialogs.push(message)
    if (message.includes('是否允许上传')) {
      expect(message).toContain('微信公众平台图床')
      expect(message).toContain('无法撤回')
      expect(fixture.requests.at(-1)).toBe('prepare')
      if (allowUpload) await dialog.accept()
      else await dialog.dismiss()
    } else {
      expect(message).toContain('实际分包为 2 份')
      if (allowDownload) await dialog.accept()
      else await dialog.dismiss()
    }
  })
  await fixture.button.click()
  await expect(fixture.button).toBeEnabled()
  expect(fixture.requests).toEqual(['prepare', 'cancel'])
  expect(dialogs).toHaveLength(1)
  expect(downloads).toBe(0)

  allowUpload = true
  await fixture.button.click()
  await expect(fixture.button).toBeEnabled()
  expect(fixture.requests.slice(-2)).toEqual(['prepare', 'transfer'])
  expect(dialogs).toHaveLength(3)
  expect(downloads).toBe(0)

  allowDownload = true
  const artifact = page.waitForEvent('download')
  await fixture.button.click()
  const recorded = await artifact
  expect(recorded.suggestedFilename()).toMatch(/\.zip$/)
  const zip = await JSZip.loadAsync(await readFile((await recorded.path())!))
  expect(Object.keys(zip.files)).toEqual(['导入秀米-1.txt', '导入秀米-2.txt', '说明.txt'])
  const html = await zip.file('导入秀米-1.txt')!.async('string')
  expect(html).toContain('<image href="' + cdn)
  expect(html).not.toContain('/media/')
  expect(downloads).toBe(1)

  fixture.rejectMapping()
  await expect(fixture.button).toBeEnabled()
  await fixture.button.click()
  await expect(page.getByRole('status').filter({ hasText: '图片可能已上传，无法撤回；未生成下载' })).toBeVisible()
  expect(fixture.stageCount()).toBe(4)
  expect(downloads).toBe(1)
  expect(fixture.normal()).toBe(0)
})

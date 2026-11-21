// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { checkedXiumiParts } from '../../src/core/xiumiExport'
import { prepareXiumiUpload, xiumiUploaded } from '../../src/editor/wechatOutput'
import { createBlock } from '../../src/core/blocks'
import { emptyDoc } from '../../src/editor/store'
import { api } from '../../src/editor/api'
vi.mock('../../src/editor/api', () => ({ api: { wechatUploadImages: vi.fn() } }))
it('rejects unsplittable text and SVG instead of silently exporting oversized files', () => {
  for (const html of [`<section><p>${'字'.repeat(140000)}</p></section>`, `<svg><path d="${'M1 1 '.repeat(30000)}"></path></svg>`]) {
    expect(() => checkedXiumiParts(html)).toThrow(/手动拆分/)
  }
})
it('blocks upload before contacting WeChat when preflight is oversized', async () => {
  vi.mocked(api.wechatUploadImages).mockClear()
  const doc = { ...emptyDoc(), blocks: [createBlock('html', { html: `<p>${'字'.repeat(140000)}</p>` }), createBlock('image', { image: { src: '/media/test.jpg' } })] }
  await expect(xiumiUploaded(doc)).rejects.toThrow(/手动拆分/)
  expect(api.wechatUploadImages).not.toHaveBeenCalled()
})
it('checks the final output again when uploaded URLs increase its length', async () => {
  vi.mocked(api.wechatUploadImages).mockImplementation(async urls => Object.fromEntries(urls.map(url => [url, 'https://example.com/' + 'x'.repeat(140000)])))
  const doc = { ...emptyDoc(), blocks: [createBlock('image', { image: { src: '/media/test.jpg' } })] }
  await expect(xiumiUploaded(doc)).rejects.toThrow(/手动拆分/)
})
it('keeps safely split content complete and bounded', () => {
  const html = `<section>${Array.from({length: 8}, (_, i) => `<p>${i}${'字'.repeat(20000)}</p>`).join('')}</section>`
  const parts = checkedXiumiParts(html)
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.every(p => p.length <= 120000)).toBe(true)
  expect(parts.map(p => p.slice(9, -10)).join('')).toBe(html.slice(9, -10))
})

it('uploads only media from the same document snapshot that passed Xiumi preflight', async () => {
  const original = '/media/confirmed.jpg'
  const replacement = '/media/after-confirmation.jpg'
  const block = createBlock('image', { image: { src: original } })
  const doc = { ...emptyDoc(), blocks: [block] }
  const upload = vi.mocked(api.wechatUploadImages)
  upload.mockClear()
  upload.mockImplementation(async urls => Object.fromEntries(urls.map(url => [url, 'https://example.com/confirmed.jpg'])))
  const plan = prepareXiumiUpload(doc)
  expect(plan.parts).toBe(1)
  expect(upload).not.toHaveBeenCalled()

  block.props.image = { src: replacement }
  await expect(plan.upload()).resolves.toMatchObject({ parts: 1, name: '导入秀米.txt' })
  expect(upload).toHaveBeenCalledExactlyOnceWith([original + "?w=1080"])
})

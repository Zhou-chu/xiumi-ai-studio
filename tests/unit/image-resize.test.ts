import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { resizePhoto } from '../../src/core/imageResize'
import { createBlock } from '../../src/core/blocks'
import { compileBlock } from '../../src/core/compiler'
import { resolveTheme } from '../../src/core/themes'
import type { Doc } from '../../src/core/types'
const parse = (s: string) => new JSDOM(s).window.document
const image = createBlock('image', { image: { src: '/media/a.png', width: 800, height: 600 } })
const d: Doc = { id: 'd', title: '', author: '', digest: '', themeId: 'x', blocks: [image], createdAt: 0, updatedAt: 0 }
describe('image resize', () => {
  it('persists width without altering source dimensions and compiles to export', () => {
    const next = resizePhoto(d, { blockId: image.id, index: 0 }, 50)
    expect(next).not.toBe(d)
    expect(next.blocks[0].props).toMatchObject({ image: { width: 800, height: 600, displayWidth: 50 } })
    expect(compileBlock(next.blocks[0], resolveTheme(d))).toContain('width:50%')
    expect(compileBlock(image, resolveTheme(d))).toContain('width:100%')
  })
  it('bounds sizes and rejects stale/unavailable targets', () => {
    expect(resizePhoto(d, { blockId: 'gone', index: 0 }, 50)).toBe(d)
    expect(resizePhoto(d, { blockId: image.id, index: 0 }, NaN)).toBe(d)
    expect(resizePhoto(d, { blockId: image.id, index: 0 }, 999).blocks[0].props).toMatchObject({ image: { displayWidth: 100 } })
  })
  it('resizes imported HTML image only, preserving structure and other images', () => {
    const b = createBlock('html', { label: '', html: '<section><img src="/media/a.png" style="width:100%;height:300px"><p>保留文字</p><img src="/media/b.png"></section>' })
    const next = resizePhoto({ ...d, blocks: [b] }, { blockId: b.id, index: 0 }, 40, parse)
    const html = (next.blocks[0].props as {html:string}).html
    const imgs = parse(html).querySelectorAll('img')
    expect(imgs[0].style.width).toBe('40%')
    expect(imgs[0].style.height).toBe('auto')
    expect(imgs[1].getAttribute('style')).toBeNull()
    expect(html).toContain('保留文字')
  })
})
import { applyImageWidths, clampImageWidth } from '../../src/core/imageResize'
import { blockPhotos } from '../../src/core/photos'
it('preserves image identity and metadata across gallery and kit cells', () => {
  for (const type of ['gallery', 'photos', 'carousel'] as const) {
    const first = { src: '/media/a.png?fit=100:68', width: 800, height: 544 }
    const second = { src: '/media/b.png' }
    const b = type === 'gallery' ? createBlock(type, { images: [first, second] }) : createBlock(type, { count: 2, pics: [{ image: first, caption: 'one' }, { image: second, caption: 'two' }] })
    const next = resizePhoto({ ...d, blocks: [b] }, { blockId: b.id, index: 0 }, 1)
    expect(blockPhotos(next.blocks[0])[0]).toEqual({ ...first, displayWidth: 10 })
    expect(blockPhotos(next.blocks[0])[1]).toEqual(second)
    expect(compileBlock(next.blocks[0], resolveTheme(d))).toContain('width:10%')
  }
})
it('leaves unrelated and invalid images unchanged', () => {
  expect(resizePhoto(d, { blockId: image.id, index: 4 }, 50)).toBe(d)
  expect(clampImageWidth(52.26)).toBe(52.3)
  const b = createBlock('html', { html: '<p>no image</p>' })
  expect(applyImageWidths(b.props.html, b)).toBe(b.props.html)
  expect(applyImageWidths('<img style="width:100%">', image)).toContain('width:100%')
  const invalid = { ...image, props: { ...image.props, image: { src: '/media/a.png', displayWidth: NaN } } }
  expect(applyImageWidths('<img style="width:100%">', invalid)).toContain('width:100%')
})

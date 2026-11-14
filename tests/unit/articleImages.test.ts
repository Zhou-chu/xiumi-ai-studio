import { describe, it, expect } from 'vitest'
import { collectArticleImages, isImageLibraryRequest } from '../../src/core/articleImages'
import { createBlock } from '../../src/core/blocks'
import type { Doc } from '../../src/core/types'
import { JSDOM } from 'jsdom'
const parse = (s: string) => new JSDOM(s).window.document
const image = createBlock('imageText', { image: { src: 'https://mmbiz.qpic.cn/a' } })
const html = createBlock('html', { html: '<img src="https://mmbiz.qpic.cn/b"><img src="https://mmbiz.qpic.cn/b"><section style="background:url(https://img.xiumi.us/c)"></section>', label: '原文' })
const doc = { id: 'doc', blocks: [image, html], cover: { src: '/media/local.png' } } as Doc

describe('article image library intent and scope', () => {
  it('routes the screenshot request locally', () => {
    expect(isImageLibraryRequest('帮我把原文中的图片加入我们自己的素材库')).toBe(true)
    expect(isImageLibraryRequest('将图片保存到素材库')).toBe(true)
    expect(isImageLibraryRequest('不要把图片加入素材库')).toBe(false)
    expect(isImageLibraryRequest('给图片加一段说明')).toBe(false)
  })
  it('collects deduplicated originals including HTML and cover without mutating content', () => {
    const before = JSON.stringify(doc)
    expect(collectArticleImages(doc, undefined, parse)).toEqual(['/media/local.png', 'https://mmbiz.qpic.cn/a', 'https://mmbiz.qpic.cn/b', 'https://img.xiumi.us/c'])
    expect(JSON.stringify(doc)).toBe(before)
  })
  it('limits collection to the selected nested block and never falls back to all on stale selection', () => {
    const nested = { ...doc, blocks: [createBlock('box', { children: [image] }), html] }
    expect(collectArticleImages(nested, image.id, parse)).toEqual(['https://mmbiz.qpic.cn/a'])
    expect(collectArticleImages(nested, 'gone', parse)).toEqual([])
  })
})

it('recognizes positive imports with unrelated negative instructions', () => {
  expect(isImageLibraryRequest('把原文图片加入素材库，不要修改正文')).toBe(true)
  expect(isImageLibraryRequest('分别把图片保存到素材库')).toBe(true)
  expect(isImageLibraryRequest('不要把图片加入素材库')).toBe(false)
})

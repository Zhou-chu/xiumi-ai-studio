// 清华电机 · 德国实践套件：大型文本框、轮播、图片框、双图 / 三图 / 四图
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileBlock, compileDoc } from '../../src/core/compiler'
import { applyOp, validateOp } from '../../src/core/ops'
import { blockPhotos, replacePhoto, swapPhotos } from '../../src/core/photos'
import { aiContext } from '../../src/core/quickActions'
import { textToRich } from '../../src/core/richtext'
import { sanitizeHtml } from '../../src/core/sanitize'
import { getTheme } from '../../src/core/themes'
import { findBlock } from '../../src/core/tree'
import type { Block, Doc, PicItem } from '../../src/core/types'

const theme = getTheme('thu-eea-de')
const parse = (s: string) => new JSDOM(s).window.document
const body = (html: string) => parse(`<!doctype html><body>${html}`).body
const img = (n: number) => ({ src: `/media/p${n}.jpg`, width: 1200, height: 900 })
const pics = (...list: (number | null)[]): PicItem[] => list.map((n, i) => (n ? { image: img(n), caption: `图注${i + 1}` } : { caption: '' }))
const doc = (blocks: Block[], themeId = 'thu-eea-de'): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId, blocks, createdAt: 0, updatedAt: 0 })
const para = (t: string) => createBlock('paragraph', { content: textToRich(t) })

describe('kit theme and typography', () => {
  it('canvas mode shows a caption slot and image placeholders that never reach the export', () => {
    const b = createBlock('photos', { count: 3, pics: pics(1, null, null) })
    const canvas = compileBlock(b, theme, { hints: true })
    expect(canvas).toContain('图注（可留空）')
    expect(body(canvas).querySelectorAll('img[data-slot]')).toHaveLength(2)
    const out = compileBlock(b, theme)
    expect(out).not.toContain('data-slot')
    expect(out).not.toContain('可留空')
    expect(compileDoc(doc([b])).warnings.some((w) => w.includes('2 个图片位置'))).toBe(true)
  })
})

describe('frame and multi-image', () => {
  it('output passes the static WeChat checks and survives the importer sanitizer', () => {
    const blocks = [createBlock('box', { children: [para('a'), createBlock('frame', { image: img(1), variant: 'circuit' })] }), createBlock('carousel', { pics: pics(1, 2) }), createBlock('photos', { count: 2, pics: pics(1, 2) })]
    const r = compileDoc(doc(blocks))
    expect(r.warnings.filter((w) => !w.includes('本地图片'))).toEqual([])
    const clean = sanitizeHtml(r.html, parse)
    expect(clean).toContain('overflow-x: auto')
    expect(clean).toMatch(/<path d="M/)
  })
})

describe('editing kit modules', () => {
  it('AI can edit a module inside a box, and only captions of image slots', () => {
    const c = createBlock('carousel', { pics: pics(1, 2) })
    const d = doc([createBlock('box', { children: [para('旧'), c] })])
    const r = validateOp(d, { op: 'update', id: c.id, props: { pics: [{ image: '[图片]', caption: '新图注' }], children: [] } })
    expect(r.error).toBeUndefined()
    const next = applyOp(d, r.op!)
    const got = findBlock(next.blocks, c.id)!.block as Block<'carousel'>
    expect(got.props.pics.map((x) => x.image?.src)).toEqual(['/media/p1.jpg', '/media/p2.jpg'])
    expect(got.props.pics[0].caption).toBe('新图注')
    const ctx = JSON.stringify(aiContext(next))
    expect(ctx).toContain(c.id)
    expect(ctx).not.toContain('/media/p1.jpg')
  })
  it('photos can be dropped on an empty slot and swapped across a box', () => {
    const grid = createBlock('photos', { count: 2, pics: pics(1, null) })
    const single = createBlock('image', { image: img(5) })
    const d = doc([createBlock('box', { children: [grid] }), single])
    expect(blockPhotos(grid).map((x) => x?.src ?? null)).toEqual(['/media/p1.jpg', null])
    const dropped = replacePhoto(d, { blockId: grid.id, index: 1 }, img(7), { allowEmpty: true })
    expect((findBlock(dropped.blocks, grid.id)!.block as Block<'photos'>).props.pics[1].image?.src).toBe('/media/p7.jpg')
    const swapped = swapPhotos(dropped, { blockId: grid.id, index: 0 }, { blockId: single.id, index: 0 })
    expect((findBlock(swapped.blocks, grid.id)!.block as Block<'photos'>).props.pics[0].image?.src).toBe('/media/p5.jpg')
    expect((findBlock(swapped.blocks, single.id)!.block as Block<'image'>).props.image?.src).toBe('/media/p1.jpg')
  })
})

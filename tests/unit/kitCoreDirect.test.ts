// 清华电机 · 德国实践套件：大型文本框、轮播、图片框、双图 / 三图 / 四图
import { describe, expect, it } from 'vitest'
import { blockLabel, cloneBlock, coerceProps, createBlock, normalizeBlocks } from '../../src/core/blocks'
import { docToMarkdown } from '../../src/core/exporters'
import { addPicTo } from '../../src/core/photos'
import { textToRich } from '../../src/core/richtext'
import { getTheme } from '../../src/core/themes'
import { findBlock, flatBlocks, insertBlocksAt, insertionPoint, moveBlockTo, removeBlockById, replaceBlockWith, updateBlock } from '../../src/core/tree'
import type { Block, Doc, PicItem } from '../../src/core/types'

const theme = getTheme('thu-eea-de')
const img = (n: number) => ({ src: `/media/p${n}.jpg`, width: 1200, height: 900 })
const pics = (...list: (number | null)[]): PicItem[] => list.map((n, i) => (n ? { image: img(n), caption: `图注${i + 1}` } : { caption: '' }))
const doc = (blocks: Block[], themeId = 'thu-eea-de'): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId, blocks, createdAt: 0, updatedAt: 0 })
const para = (t: string) => createBlock('paragraph', { content: textToRich(t) })

describe('kit theme and typography', () => {
  it('kit theme sets 14px black body and 12px gray notes', () => {
    expect(theme.fontSize).toBe(14)
    expect(theme.colors.text).toBe('#000000')
    expect(theme.smallSize).toBe(12)
    expect(theme.colors.muted).toBe('#888888')
  })
})

describe('large text box', () => {
  const box = createBlock('box', {
    title: '亚琛工业大学',
    label: 'BERICHT · 02',
    children: [para('正文第一段'), createBlock('carousel', { pics: pics(1, 2) }), createBlock('photos', { count: 4, pics: pics(1, 2, 3, 4) })],
  })
  it('boxes cannot be nested, and copies get fresh child ids', () => {
    const [b] = normalizeBlocks([{ type: 'box', props: { children: [{ type: 'box', props: {} }, { type: 'paragraph', props: { content: 'x' } }] } }])
    expect((b as Block<'box'>).props.children.map((c) => c.type)).toEqual(['paragraph'])
    const copy = cloneBlock(box)
    expect(copy.props.children.map((c) => c.id)).not.toEqual(box.props.children.map((c) => c.id))
  })
})

describe('frame and multi-image', () => {
  it('pics always match the image count', () => {
    expect(coerceProps('photos', { count: 4, pics: pics(1) }).pics).toHaveLength(4)
    expect(coerceProps('photos', { count: 9 }).count).toBe(4)
    expect(blockLabel(createBlock('photos', { count: 3 }))).toBe('三图')
  })
})

describe('module tree', () => {
  const kid = para('框内')
  const box = createBlock('box', { children: [kid] })
  const top = para('顶层')
  const blocks: Block[] = [box, top]
  it('finds, updates and removes blocks inside a box', () => {
    expect(findBlock(blocks, kid.id)).toMatchObject({ parent: { id: box.id }, index: 0 })
    expect(flatBlocks(blocks).map((b) => b.id)).toEqual([box.id, kid.id, top.id])
    const up = updateBlock(blocks, kid.id, (b) => ({ ...b, props: { ...b.props, align: 'center' } }) as Block)
    expect((findBlock(up, kid.id)!.block as Block<'paragraph'>).props.align).toBe('center')
    expect((removeBlockById(blocks, kid.id)[0] as Block<'box'>).props.children).toEqual([])
  })
  it('moves blocks into and out of a box, but never a box into a box', () => {
    const inBox = moveBlockTo(blocks, top.id, box.id, 1)
    expect(inBox).toHaveLength(1)
    expect((inBox[0] as Block<'box'>).props.children.map((c) => c.id)).toEqual([kid.id, top.id])
    const out = moveBlockTo(inBox, kid.id, null, 1)
    expect(out.map((b) => b.id)).toEqual([box.id, kid.id])
    const other = createBlock('box')
    expect(insertBlocksAt(blocks, box.id, 0, [other])).toBe(blocks)
  })
  it('replaces a child in place', () => {
    const parts = [para('一'), para('二')]
    const next = replaceBlockWith(blocks, kid.id, parts)
    expect((next[0] as Block<'box'>).props.children.map((c) => c.id)).toEqual(parts.map((p) => p.id))
  })
  it('clicking a module while a box is selected puts it in the box', () => {
    expect(insertionPoint(blocks, box.id, false)).toEqual({ parentId: box.id, index: 1 })
    expect(insertionPoint(blocks, kid.id, false)).toEqual({ parentId: box.id, index: 1 })
    expect(insertionPoint(blocks, kid.id, true)).toEqual({ parentId: null, index: 1 })
    expect(insertionPoint(blocks, top.id, false)).toEqual({ parentId: null, index: 2 })
  })
})

describe('editing kit modules', () => {
  it('assets fill empty slots, append to carousels and stop when a grid is full', () => {
    const grid = createBlock('photos', { count: 2, pics: pics(null, 2) })
    const filled = addPicTo(grid, img(9)) as Block<'photos'>
    expect(filled.props.pics[0].image?.src).toBe('/media/p9.jpg')
    expect(addPicTo(filled, img(8))).toBeNull()
    const car = addPicTo(createBlock('carousel', { pics: pics(1) }), img(9)) as Block<'carousel'>
    expect(car.props.pics).toHaveLength(2)
  })
  it('markdown export includes box children and captions', () => {
    const md = docToMarkdown(doc([createBlock('box', { title: '收获', children: [para('框内正文'), createBlock('photos', { count: 2, pics: pics(1, 2) })] })]))
    expect(md).toContain('### 收获')
    expect(md).toContain('框内正文')
    expect(md).toContain('![图注2](/media/p2.jpg)')
  })
})

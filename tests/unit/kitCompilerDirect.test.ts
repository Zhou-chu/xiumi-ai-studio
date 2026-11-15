// 清华电机 · 德国实践套件：大型文本框、轮播、图片框、双图 / 三图 / 四图
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileBlock } from '../../src/core/compiler'
import { textToRich } from '../../src/core/richtext'
import { getTheme, THEMES } from '../../src/core/themes'
import type { PicItem } from '../../src/core/types'

const theme = getTheme('thu-eea-de')
const parse = (s: string) => new JSDOM(s).window.document
const body = (html: string) => parse(`<!doctype html><body>${html}`).body
const img = (n: number) => ({ src: `/media/p${n}.jpg`, width: 1200, height: 900 })
const pics = (...list: (number | null)[]): PicItem[] => list.map((n, i) => (n ? { image: img(n), caption: `图注${i + 1}` } : { caption: '' }))
const para = (t: string) => createBlock('paragraph', { content: textToRich(t) })
const styleOf = (el: Element | null | undefined) => (el?.getAttribute('style') ?? '').replace(/\s/g, '')

describe('kit theme and typography', () => {
  it('captions are 12px gray; empty captions leave no element in the export', () => {
    const b = createBlock('photos', { count: 2, pics: [{ image: img(1), caption: '慕尼黑工业大学' }, { image: img(2), caption: '' }] })
    const root = body(compileBlock(b, THEMES[1]))
    const caps = [...root.querySelectorAll('p')]
    expect(caps).toHaveLength(1)
    expect(caps[0].textContent).toContain('慕尼黑工业大学')
    expect(styleOf(caps[0])).toContain('font-size:12px')
    expect(styleOf(caps[0])).toContain('color:#888888')
  })
})

describe('large text box', () => {
  const box = createBlock('box', {
    title: '亚琛工业大学',
    label: 'BERICHT · 02',
    children: [para('正文第一段'), createBlock('carousel', { pics: pics(1, 2) }), createBlock('photos', { count: 4, pics: pics(1, 2, 3, 4) })],
  })
  it('compiles the children inside a 14px black body', () => {
    const html = compileBlock(box, THEMES[1])
    const root = body(html)
    const bodySec = [...root.querySelectorAll('section')].find((s) => styleOf(s).includes('font-size:14px;color:#000000'))
    expect(bodySec).toBeTruthy()
    expect(bodySec!.textContent).toContain('正文第一段')
    expect(bodySec!.querySelectorAll('img')).toHaveLength(6)
    expect(html).toContain('亚琛工业大学')
  })
  it('modules inside adapt to the box: kit purple and 14px base even in another theme', () => {
    const card = createBlock('card', { title: '要点', content: textToRich('内容') })
    const outside = compileBlock(card, THEMES[1])
    const inside = compileBlock(card, THEMES[1], { inBox: true })
    expect(outside).toContain(THEMES[1].colors.primary)
    expect(inside).toContain('#660874')
    expect(inside).not.toContain(THEMES[1].colors.primary)
    expect(inside).toContain('font-size:15px') // 卡片标题 = 正文 14 + 1
  })
  it('all three styles render a header, body and the three-phase mark', () => {
    for (const variant of ['plate', 'rule', 'paper'] as const) {
      const html = compileBlock({ ...box, props: { ...box.props, variant } }, theme)
      expect(html).toContain('TSINGHUA · EEA')
      expect(body(html).querySelectorAll('svg path').length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('carousel', () => {
  it('scrolls horizontally with one slide per filled image and page numbers', () => {
    const b = createBlock('carousel', { pics: pics(1, null, 2, 3) })
    const html = compileBlock(b, theme)
    const root = body(html)
    const viewport = [...root.querySelectorAll('section')].find((s) => styleOf(s).includes('overflow-x:auto'))
    expect(viewport).toBeTruthy()
    const track = viewport!.firstElementChild!
    expect(styleOf(track)).toContain('width:252%') // 3 张 × 84%，露出下一张
    expect(styleOf(track)).toContain('max-width:252%!important')
    expect(track.children).toHaveLength(3)
    expect(html).toContain('/ 03')
    expect(html).toContain('左右滑动')
  })
  it('a single image is not a scroller; an empty carousel exports nothing', () => {
    expect(compileBlock(createBlock('carousel', { pics: pics(1) }), theme)).not.toContain('overflow-x')
    expect(compileBlock(createBlock('carousel', { pics: pics(null, null) }), theme)).toBe('')
  })
  it('full variant uses whole-width slides', () => {
    const html = compileBlock(createBlock('carousel', { variant: 'full', pics: pics(1, 2) }), theme)
    expect(html).toContain('width:200%')
  })
})

describe('frame and multi-image', () => {
  it('every frame style renders the photo, caption and label', () => {
    for (const variant of ['flag', 'circuit', 'ticket'] as const) {
      const html = compileBlock(createBlock('frame', { image: img(1), caption: '市政厅', label: 'MÜNCHEN', variant }), theme)
      expect(html).toContain('/media/p1.jpg')
      expect(html).toContain('市政厅')
      expect(html).toContain('MÜNCHEN')
    }
  })
  it('two / three / four images in both layouts keep every slot', () => {
    for (const count of [2, 3, 4] as const)
      for (const layout of ['even', 'feature'] as const) {
        const list = pics(...Array.from({ length: count }, (_, i) => i + 1))
        const html = compileBlock(createBlock('photos', { count, layout, pics: list }), theme)
        expect(body(html).querySelectorAll('img')).toHaveLength(count)
        expect(html).toContain(`图注${count}`)
      }
  })
  it('crops each slot with the layout ratio', () => {
    const html = compileBlock(createBlock('photos', { count: 3, layout: 'feature', pics: pics(1, 2, 3) }), theme)
    expect(html).toContain('/media/p1.jpg?fit=16%3A9')
    expect(html).toContain('/media/p2.jpg?fit=4%3A3')
  })
})

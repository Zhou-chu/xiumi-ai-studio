import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { boxParts, boxTheme, KIT_RENDERERS, kitEmptySlots, photoRows } from '../../src/core/kit'
import { THEMES } from '../../src/core/themes'
import type { ImageRef } from '../../src/core/types'

const dom = (html: string) => new JSDOM(html).window.document
const ctx = (hints = false) => ({
  hints, inBox: false,
  img: vi.fn((ref: ImageRef | undefined, _fit?: string, _width?: number) => ref?.src ?? ''),
})
const image = { src: '/media/f.jpg', width: 120, height: 250 }

it('keeps empty headers free of title text for each box variant while retaining body and footer', () => {
  for (const variant of ['rule', 'paper', 'plate'] as const) {
    const parts = boxParts(createBlock('box', { title: '', label: '', variant }).props)
    expect(parts.body).toContain('font-size:14px')
    expect(dom(parts.header).querySelector('p')).toBeNull()
    expect(dom(parts.footer).querySelectorAll('svg path')).toHaveLength(3)
    const titleOnly = dom(boxParts(createBlock('box', { title: '<内容>', label: '', variant }).props).header)
    expect(titleOnly.querySelector('p')?.textContent).toBe('<内容>')
    expect(titleOnly.querySelectorAll('p')).toHaveLength(1)
    const labelOnly = dom(boxParts(createBlock('box', { title: '', label: '<站点>', variant }).props).header)
    expect(labelOnly.querySelector('p')?.textContent).toContain('<站点>')
    expect(labelOnly.querySelectorAll('p')).toHaveLength(1)
  }
})

it('caps oversized heading styles without enlarging an existing smaller heading or mutating the source theme', () => {
  const source = { ...THEMES[0], h1Size: 15 }
  const small = boxTheme(source)
  expect(small.h1Size).toBe(15)
  expect(small.colors).not.toBe(source.colors)
  expect(small.fontSize).toBe(14)
  const oversizedTheme = { ...source, h1Size: 32 }
  expect(boxTheme(oversizedTheme).h1Size).toBe(20)
  expect(oversizedTheme.h1Size).toBe(32)
})

it('uses a placeholder only on canvas for a zero-slot carousel without asking the image adapter for a file', () => {
  const block = createBlock('carousel', { pics: [] })
  // A direct renderer receives a draft, not necessarily the normalized block.
  block.props.pics = []
  const preview = ctx(true)
  const html = KIT_RENDERERS.carousel(block, preview)
  const root = dom(html)
  expect(root.querySelector('img')?.getAttribute('data-slot')).toBe('0')
  expect(root.body.textContent).toContain('图注（可留空）')
  expect(preview.img).not.toHaveBeenCalled()
  const exported = ctx()
  expect(KIT_RENDERERS.carousel(block, exported)).toBe('')
  expect(exported.img).not.toHaveBeenCalled()
})

it('asks for portrait cropping only on tall frames and never shows a blank exported caption row', () => {
  const tall = ctx()
  const portrait = createBlock('frame', { variant: 'flag', image, caption: '', label: '' })
  const root = dom(KIT_RENDERERS.frame(portrait, tall))
  expect(tall.img).toHaveBeenCalledExactlyOnceWith(image, '4:5', 1080)
  expect(root.querySelector('img')?.getAttribute('src')).toBe('/media/f.jpg')
  expect(root.querySelector('p')).toBeNull()
  const landscape = { ...image, width: 300 }
  const wide = ctx()
  expect(dom(KIT_RENDERERS.frame(createBlock('frame', { variant: 'circuit', image: landscape, caption: '', label: '· 地点' }), wide)).body.textContent).toContain('· 地点')
  expect(wide.img).toHaveBeenCalledExactlyOnceWith(landscape, undefined, 1080)
  const empty = createBlock('frame', { image: undefined, caption: '', label: '' })
  const preview = ctx(true)
  expect(dom(KIT_RENDERERS.frame(empty, preview)).querySelector('img')?.getAttribute('data-slot')).toBe('0')
  expect(preview.img).not.toHaveBeenCalled()
  expect(KIT_RENDERERS.frame(empty, ctx())).toBe('')
})

it('honors sparse photo count without cropping absent images or leaking a placeholder into export', () => {
  const block = createBlock('photos', { count: 3, layout: 'feature', pics: [{ caption: '' }, { caption: '有效图', image }] })
  block.props.pics = block.props.pics.slice(0,2)
  const shown = ctx(true)
  const root = dom(KIT_RENDERERS.photos(block, shown))
  expect([...root.querySelectorAll('img[data-slot]')].map(x => x.getAttribute('data-slot'))).toEqual(['0', '2'])
  expect(shown.img).toHaveBeenCalledExactlyOnceWith(image, '4:3', 720)
  const exported = dom(KIT_RENDERERS.photos(block, ctx()))
  expect(exported.querySelectorAll('img')).toHaveLength(1)
  expect(exported.querySelector('[data-slot]')).toBeNull()
  expect(exported.body.textContent).toContain('有效图')
  expect(kitEmptySlots(block)).toBe(2)
  expect(kitEmptySlots(createBlock('paragraph'))).toBe(0)
  expect(kitEmptySlots(createBlock('frame', { image }))).toBe(0)
  expect(kitEmptySlots(createBlock('frame'))).toBe(1)
  expect(kitEmptySlots(createBlock('carousel', { pics: [{ image, caption: '' }, { caption: '' }] }))).toBe(1)
  expect(photoRows(2, 'feature', '1:1')).toEqual([[{ w: 49, fit: '3:4' }, { w: 49, fit: '3:4', drop: 36 }]])
})

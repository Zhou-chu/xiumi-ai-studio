import { expect, it } from 'vitest'
import { backgroundAt, baseColor, CONTENT_W, gradientBands, layoutScene, PAD_X, resolveStyle } from '../../src/core/replay/layout'
import { defaultAction, defaultReplay, makeItem, makeScene, normalizeReplay, validateReplay } from '../../src/core/replay/schema'

it('hydrates an imported image and bounds its surrounding canvas and playback options', () => {
  const image = { src: '/media/replay.jpg', assetId: 'fixture', width: '640', height: 480, ignored: true }
  const raw = {
    canvas: { width: 1200, background: { type: 'image', value: 'not a color', image, grid: { color: '#AbC', size: '350' } } },
    textMode: 'svg-text', playback: { trigger: 'tap', pace: 'normal', loop: { hold: -1 }, start: '5000', triggerId: 'Replay-1', replay: true, typeSpeed: '100' },
    cursors: { count: 3.6, show: false, names: ['123456789012extra', 5, {}] },
    budget: { sceneKB: '100', totalKB: Number.NaN },
  }
  const before = structuredClone(raw)
  const doc = normalizeReplay(raw)
  expect(doc.canvas).toEqual({ width: 750, background: { type: 'image', value: '#071226', image: { src: image.src, assetId: 'fixture', width: 640, height: 480 }, grid: { color: '#AbC', size: 300 } } })
  expect(doc.playback).toEqual({ trigger: 'tap', pace: 'normal', loop: { hold: 0 }, start: 3600, triggerId: 'Replay-1', replay: true, typeSpeed: 60 })
  expect(doc.textMode).toBe('svg-text')
  expect(doc.cursors).toEqual({ count: 4, show: false, names: ['123456789012', '5', ''] })
  expect(doc.budget).toEqual({ sceneKB: 100, totalKB: 400 })
  expect(raw).toEqual(before)
})

it('keeps valid gradient stops and discards malformed colors and controls', () => {
  const doc = normalizeReplay({
    canvas: { background: { type: 'gradient', value: '#024, junk #fff #123456 #ABC #aaaaaa #ccc #444', grid: false } },
    playback: { start: -1, triggerId: '8-invalid', replay: false, typeSpeed: ' ', loop: { hold: Number.NaN } },
    theme: { accent: 'rgb(1,2,3)', text: '#eEE', alert: ' #abc ', cursorPalette: ['n/a', '#abc', ...Array(10).fill('#ffffff')] },
    cursors: { names: [null, {}], count: Number.POSITIVE_INFINITY },
  })
  expect(doc.canvas.background).toEqual({ type: 'gradient', value: '#024,#fff,#123456,#ABC,#aaaaaa,#ccc' })
  expect(doc.theme).toMatchObject({ accent: defaultReplay().theme.accent, text: '#eEE', alert: '#abc' })
  expect(doc.theme.cursorPalette).toHaveLength(8)
  expect(doc.theme.cursorPalette[0]).toBe('#abc')
  expect(doc.cursors).toEqual({ count: 3, show: true })
  expect(doc.playback).toEqual({ trigger: 'auto', pace: 'fast', loop: { hold: 2 } })
  expect(normalizeReplay({ canvas: { background: { type: 'gradient', value: '#fff' } } }).canvas.background.value).toBe('#071226,#0d2a52')
})

it('normalizes an absolute imported frame, text styles and cursor without copying unknown fields', () => {
  const doc = normalizeReplay({ scenes: [{
    id: 7, layout: 'absolute', finale: 'swarm', height: '250.6', overlap: 0, padding: 999, gap: -2,
    items: [{
      id: 'group', type: 'image', content: 'a'.repeat(2001), label: 'b'.repeat(201),
      image: { src: '/media/png.webp', width: '480', height: -1, assetId: 'one' }, cursor: { action: 'drag', who: 4.8 },
      frame: { x: -999, y: Number.NaN, w: '900', h: 0 }, delay: 80, enter: 'drag-in',
      style: { color: 'invalid', fill: '', stroke: '#aAa', fontSize: Number.POSITIVE_INFINITY, fontWeight: 460, align: 'both', lineHeight: 7, letterSpacing: -50, radius: 999, face: 'zcool' },
      foreign: true,
    }],
  }] })
  expect(doc.scenes[0]).toMatchObject({ id: '7', layout: 'absolute', finale: 'swarm', height: 251, overlap: 0.1, padding: 300, gap: 0 })
  expect(doc.scenes[0].items[0]).toEqual({
    id: 'group', type: 'image', content: 'a'.repeat(2000), label: 'b'.repeat(200),
    image: { src: '/media/png.webp', width: 480, assetId: 'one' }, cursor: { action: 'drag', who: 5 },
    frame: { x: -750, y: 0, w: 900, h: 1 }, delay: 10, enter: 'drag-in',
    style: { color: '#ffffff', fill: '', stroke: '#aAa', fontSize: 28, fontWeight: 400, align: 'left', lineHeight: 3, letterSpacing: -2, radius: 200, face: 'zcool' },
  })
})

it('bounds scene and item arrays and lists malformed absolute coordinates without mutating inputs', () => {
  const makeParts = () => Array.from({ length: 41 }, (_, i) => ({ id: 'part' + i, type: 'divider' }))
  const doc = normalizeReplay({ scenes: Array.from({ length: 13 }, (_, i) => ({ id: 'scene' + i, items: makeParts() })) })
  expect(doc.scenes).toHaveLength(12)
  expect(doc.scenes.every(s => s.items.length === 40)).toBe(true)
  expect(doc.scenes.at(-1)?.items.at(-1)?.id).toBe('part39')
  expect(validateReplay({ playback: { pace: 'not-supported' }, scenes: [null, { layout: 'absolute', items: [{ type: 'text' }] }] })).toEqual([
    '第 1 个场景格式错误', '场景 2 第 1 个元素缺少位置，按自动排版放置', '节奏无效，已改为 fast',
  ])
  expect(validateReplay([])).toEqual(['数据不是对象，已使用默认模板'])
  expect(defaultAction('drag-in')).toBe('drag')
  expect(defaultAction('type-on')).toBe('type')
  expect(defaultAction('count-up')).toBe('click')
})

it('lays out a labelled image and explicit frame while placing the next item at a valid fallback height', () => {
  const doc = defaultReplay()
  const image = makeItem('image', { image: { src: '/media/p.jpg', width: 200, height: 1000 }, label: '保留图注', frame: { x: 25, y: 50, w: 100, h: 650 } })
  const scene = { ...makeScene([image, makeItem('shape', { content: 'ring' })]), layout: 'absolute' as const, height: 800 }
  const layout = layoutScene(scene, doc)
  expect(layout.items[0].item.image).toEqual(image.image)
  expect(layout.items[0].box).toEqual({ x: 25, y: 50, w: 100, h: 650 })
  expect(layout.items[0].label?.lines.join('')).toBe('保留图注')
  expect(layout.items[0].label?.y).toBe(562)
  expect(layout.items[1].box).toEqual({ x: PAD_X, y: 730, w: 96, h: 96 })
  expect(layout.overflow).toBe(true)
})

it('positions narrow shapes, lines and caps labelled photo geometry in flow order', () => {
  const doc = defaultReplay()
  const items = [
    makeItem('shape', { content: 'line', style: { align: 'right' } }),
    makeItem('shape', { content: 'circle', style: { align: 'center' } }),
    makeItem('image', { image: { src: '/media/p.jpg', width: 100, height: 4000 }, label: '高图注' }),
    makeItem('divider'),
  ]
  const layout = layoutScene({ ...makeScene(items), padding: 20, gap: 7 }, doc)
  const [line, circle, image, divider] = layout.items
  expect(line.box).toEqual({ x: PAD_X + CONTENT_W - 120, y: 20, w: 120, h: 10 })
  expect(circle.box).toEqual({ x: PAD_X + (CONTENT_W - 96) / 2, y: 37, w: 96, h: 96 })
  expect(image.box.y).toBe(140)
  expect(image.label?.y).toBe(image.box.y + 912)
  expect(divider.box.y).toBe(image.box.y + image.box.h + 7)
  expect(layout.height).toBe(divider.box.y + divider.box.h + 20)
})

it('applies author formatting and keeps keyword offsets correct after line breaks', () => {
  const doc = defaultReplay()
  doc.glyphs = { zcool: { 甲: { d: 'M0 0', adv: 1000 } } }
  const scene = makeScene([
    makeItem('text', { content: '甲 **乙**\n丙 **丁**', label: '小标题', style: { face: 'zcool', fill: '#111', fontSize: 26, align: 'right' } }),
    makeItem('text', { content: '甲甲', style: { face: 'zcool' } }),
  ])
  const [rich, glyph] = layoutScene(scene, doc).items
  expect(rich.label?.lines).toEqual(['小标题'])
  expect(rich.text).toMatchObject({ lines: ['甲 乙','丙 丁'], marks: [[2,3],[6,7]], starts: [0,4], color: resolveStyle(scene.items[0], doc).color, align: 'right' })
  expect(rich.text?.glyphs).toBeUndefined()
  expect(glyph.text?.glyphs).toBe(doc.glyphs.zcool)
  expect(glyph.text?.lines).toEqual(['甲甲'])
})

it('uses consistent background samples from gradient bands, and permits image backgrounds without a paint color', () => {
  const doc = defaultReplay()
  doc.canvas.background = { type: 'gradient', value: '#000000,#404040,#ffffff' }
  const bands = gradientBands(doc, 320)!
  expect(bands).toHaveLength(32)
  expect(bands.at(0)).toEqual({ y:0, h:11, color:'#000000' })
  expect(bands.at(-1)).toEqual({ y:310, h:11, color:'#ffffff' })
  expect(backgroundAt(doc, 160, 320)).toBe('#404040')
  expect(backgroundAt(doc, -5, 320)).toBe(baseColor(doc))
  expect(backgroundAt(doc, 999, 320)).toBe('#ffffff')
  doc.canvas.background = { type: 'image', value: '#111111', image: { src:'/media/bg.jpg' } }
  expect(gradientBands(doc,320)).toBeNull()
  expect(backgroundAt(doc, 5, 320)).toBeNull()
  expect(baseColor(doc)).toBe('#000000')
})

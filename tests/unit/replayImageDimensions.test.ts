import { expect, it } from 'vitest'
import { normalizeReplay } from '../../src/core/replay/schema'

function importImage(raw: string) {
  const image: unknown = JSON.parse(raw)
  const doc = normalizeReplay({ canvas: { background: { type: 'image', image } }, scenes: [{ items: [{ type: 'image', image }] }] })
  return [doc.canvas.background.image, doc.scenes[0].items[0].image]
}

it.each([
  ['"Infinity"', '"Infinity"', {}],
  ['1e309', '"1e999"', {}],
  ['0', '-10', {}],
  ['"640"', '"Infinity"', { width: 640 }],
  ['-9', '720', { height: 720 }],
  ['"640"', '480', { width: 640, height: 480 }],
])('normalizes image dimensions %s/%s without losing the image', (width, height, dimensions) => {
  const input = `{"src":"/media/p.jpg","assetId":"fixture","width":${width},"height":${height}}`
  expect(importImage(input)).toEqual(Array(2).fill({ src: '/media/p.jpg', assetId: 'fixture', ...dimensions }))
})

it('preserves a positive finite height when the imported image has no width', () => {
  expect(importImage('{"src":"/media/p.jpg","height":720}')).toEqual(Array(2).fill({ src: '/media/p.jpg', height: 720 }))
})

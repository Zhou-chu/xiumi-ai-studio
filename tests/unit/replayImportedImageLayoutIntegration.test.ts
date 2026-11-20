import { expect, it } from 'vitest'
import { layoutScene } from '../../src/core/replay/layout'
import { normalizeReplay } from '../../src/core/replay/schema'

it('keeps an imported image and following text in finite scene geometry', () => {
  const doc = normalizeReplay(JSON.parse('{"scenes":[{"items":[{"type":"image","image":{"src":"/media/p.jpg","width":"Infinity","height":"Infinity"}},{"type":"text","content":"保留后文"}]}]}'))
  const result = layoutScene(doc.scenes[0], doc)
  expect(result.items[0].item.image?.src).toBe('/media/p.jpg')
  expect(result.items[1].text?.lines.join('')).toBe('保留后文')
  expect([result.height, ...result.items.flatMap(item => [item.box.x,item.box.y,item.box.w,item.box.h])].every(Number.isFinite)).toBe(true)
})

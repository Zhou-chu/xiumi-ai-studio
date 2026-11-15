import { expect, it } from 'vitest'
import { glyphMeasure, glyphTable } from '../../src/core/replay/layout'
import { normalizeReplay } from '../../src/core/replay/schema'

it('retains valid glyph advances and rejects unsupported glyph rows and face values', () => {
  const doc = normalizeReplay({
    glyphs: {
      'not valid': { 字: { d: '', adv: 10 } },
      zcool: { 字: { d: 'M0 0L10 3Z', adv: '1000' }, '😀': { d: 'M0 0', adv: 4444 }, 两字: { d: '', adv: 10 }, 坏: { d: 'not path', adv: 10 }, 零: { d: '', adv: -1 }, 未: { d: 'M0 0', adv: Number.NaN } },
      absent: [],
    },
    scenes: [{ items: [{ type: 'text', style: { face: 'a face' }, image: { src: '' } }] }],
  })
  expect(doc.glyphs).toEqual({ zcool: { 字: { d: 'M0 0L10 3Z', adv: 1000 }, '😀': { d: 'M0 0', adv: 3000 }, 零: { d: '', adv: 0 }, 未: { d: 'M0 0', adv: 1000 } } })
  expect(doc.scenes[0].items[0]).not.toHaveProperty('style')
  expect(doc.scenes[0].items[0]).not.toHaveProperty('image')
  expect(glyphTable(doc, 'zcool', '字 😀')).toBe(doc.glyphs!.zcool)
  expect(glyphTable(doc, 'zcool', '字 外')).toBeUndefined()
  expect(glyphMeasure(doc.glyphs!.zcool)('字 😀', { size: 10, weight: 400, letterSpacing: 1 })).toBe(46)
})

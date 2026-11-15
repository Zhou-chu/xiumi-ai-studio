import { expect, it } from 'vitest'
import { glyphMeasure } from '../../src/core/replay/layout'
import { wrapText } from '../../src/core/replay/text'

const font = { size: 10, weight: 400 as const, letterSpacing: 0 }
const uniform = (text: string) => [...text].length * 10

it.each(['😀','𠮷'])('wraps supplementary glyph %s as one code point, never separated surrogate halves', symbol => {
  const measure = glyphMeasure({ 甲: { d: '', adv: 1000 }, [symbol]: { d: '', adv: 2000 } })
  const text = '甲' + symbol
  const lines = wrapText(text, font, 10, measure)
  expect(lines).toEqual(['甲',symbol])
  expect(lines.join('')).toBe(text)
})

it('keeps ASCII word wrapping, Chinese punctuation and explicit blank lines', () => {
  expect(wrapText('hi all', font, 30, uniform)).toEqual(['hi','all'])
  expect(wrapText('甲乙，丙\n\n后文', font, 20, uniform)).toEqual(['甲乙，','丙','','后文'])
})

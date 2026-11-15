import { describe, expect, it } from 'vitest'
import { normalizeDesign } from '../../src/core/aiDesign'
import { lum } from '../../src/core/color'

describe('normalizeDesign', () => {
  it('repairs garbage input into a valid spec', () => {
    const d = normalizeDesign({ palette: { primary: 'red', text: '#eeeeee' }, type: { fontSize: 40 }, styles: { heading: 'nope' }, sections: 'x' }, 3)
    expect(d.palette.primary).toMatch(/^#[0-9a-f]{6}$/i)
    expect(lum(d.palette.text)).toBeLessThan(0.35)
    expect(d.type.fontSize).toBe(17)
    expect(d.styles.heading).toBe('number')
    expect(d.sections).toHaveLength(3)
  })
  it('darkens primary colors too light for white text', () => {
    const d = normalizeDesign({ palette: { primary: '#ffe9a8' } }, 1)
    expect(lum(d.palette.primary)).toBeLessThanOrEqual(0.5)
  })
})

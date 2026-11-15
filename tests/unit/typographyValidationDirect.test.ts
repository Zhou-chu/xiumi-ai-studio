import { describe, expect, it } from 'vitest'
import { safeTextFont, safeTextSize } from '../../src/core/textTypography'
describe('document typography validation', () => {
  it.each(['Noto Serif SC Variable, Noto Serif SC, SimSun, serif', 'Arial, sans-serif', '"Times New Roman", serif', "'宋体', serif", 'Consolas, Courier New, monospace'])('accepts restricted family syntax %s', font => expect(safeTextFont(font)).toBe(font))
  it.each([undefined, null, 12, '', '   ', ',', 'Arial,,serif', '"Arial', 'Arial"', 'serif;position:fixed', 'url(http://example)', 'var(--font)', '<script>', 'a\\62', 'a\nfont', 'a'.repeat(181)])('rejects invalid or injectable family %j', font => expect(safeTextFont(font)).toBeUndefined())
  it.each(['8px', '96px', '15.5px'])('accepts bounded pixel size %s', size => expect(safeTextSize(size)).toBe(size))
  it.each([null, 24, '', '7px', '97px', '-1px', '1e1px', 'calc(2px)', '16em', '12px;color:red', 'Infinitypx'])('rejects invalid size %j', size => expect(safeTextSize(size)).toBeUndefined())
})

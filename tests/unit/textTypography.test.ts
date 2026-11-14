import { describe, expect, it } from 'vitest'
import { compileBlock } from '../../src/core/compiler'
import { createBlock } from '../../src/core/blocks'
import { THEMES } from '../../src/core/themes'

describe('selected text typography export', () => {
  it('renders font family and size with other marks without changing adjacent text', () => {
    const block = createBlock('paragraph', { content: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'before ' },
      { type: 'text', text: 'selected', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'Noto Serif SC Variable, Noto Serif SC, SimSun, serif', fontSize: '24px', color: '#123456' } }] },
      { type: 'text', text: ' after' },
    ] }] } })
    const html = compileBlock(block, THEMES[0])
    expect(html).toContain('font-family:Noto Serif SC Variable, Noto Serif SC, SimSun, serif;')
    expect(html).toContain('font-size:24px;')
    expect(html).toContain('color:#123456;')
    expect(html).toContain('before ')
    expect(html).not.toContain('before&nbsp;')
    expect(html).toContain('font-weight:700;color:#123456;')
  })
  it('rejects untrusted font declarations and unreasonable sizes', () => {
    const html = compileBlock(createBlock('paragraph', { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'safe', marks: [{ type: 'textStyle', attrs: { fontFamily: 'serif;position:fixed', fontSize: '99999px' } }] }] }] } }), THEMES[0])
    expect(html).not.toContain('position:fixed')
    expect(html).not.toContain('99999px')
    expect(html).toContain('safe')
  })
})

import { safeTextFont, safeTextSize, TEXT_FONTS } from '../../src/core/textTypography'
it('validates font and size bounds without accepting declaration injection', () => {
  for (const font of TEXT_FONTS) expect(safeTextFont(font.value)).toBe(font.value)
  for (const bad of [null, 12, '', 'a; color:red', '<script>', 'url(http://x)', 'x'.repeat(181)]) expect(safeTextFont(bad)).toBeUndefined()
  for (const good of ['8px','96px','15.5px']) expect(safeTextSize(good)).toBe(good)
  for (const bad of [null, 24, '7px','97px','-1px','calc(2px)','16em','12px;color:red']) expect(safeTextSize(bad)).toBeUndefined()
})

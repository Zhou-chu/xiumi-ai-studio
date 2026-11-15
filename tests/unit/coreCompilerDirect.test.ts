import { describe, expect, it } from 'vitest'
import { BLOCK_TYPES, createBlock } from '../../src/core/blocks'
import { compileBlock, css, lintWechatHtml } from '../../src/core/compiler'
import { THEMES } from '../../src/core/themes'

describe('css()', () => {
  it('drops unsupported or unsafe declarations', () => {
    expect(css({ position: 'absolute', color: '#fff', 'background-color': 'url(x)', width: 'var(--a)' })).toBe('color:#fff;')
    expect(css({ margin: 0, 'line-height': 1.8, 'font-size': 15 })).toBe('margin:0;line-height:1.8;font-size:15px;')
  })
})

describe('every block renders with every theme', () => {
  it('no throws and non-empty output', () => {
    // 套件的图片模块没放图片时导出为空（导出前另有提示），画布模式下显示占位
    const imageOnly = new Set(['carousel', 'frame', 'photos'])
    for (const t of BLOCK_TYPES)
      for (const theme of THEMES) {
        expect(compileBlock(createBlock(t), theme, { hints: true }).length).toBeGreaterThan(10)
        if (!imageOnly.has(t)) expect(compileBlock(createBlock(t), theme).length).toBeGreaterThan(10)
      }
  })
  it('escapes user text', () => {
    const html = compileBlock(createBlock('quote', { text: '<img src=x onerror=alert(1)>' }), THEMES[0])
    expect(html).not.toContain('<img')
  })
  it('turns external links into text', () => {
    const b = createBlock('paragraph', {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '官网', marks: [{ type: 'link', attrs: { href: 'https://a.com' } }] }] }] },
    })
    const html = compileBlock(b, THEMES[0])
    expect(html).not.toContain('<a ')
    expect(html).toContain('https://a.com')
  })
})

describe('lint', () => {
  it('flags local images and forbidden markup', () => {
    expect(lintWechatHtml('<img src="/media/a.jpg">').length).toBe(1)
    expect(lintWechatHtml('<p class="x"><script></script></p>').length).toBe(2)
  })
})

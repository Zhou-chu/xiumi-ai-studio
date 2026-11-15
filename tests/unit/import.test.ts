import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { exporterSmoke } from './helpers'
import { parseArticle } from '../../src/core/outline'
import { THEMES } from '../../src/core/themes'
import type { Block, Doc } from '../../src/core/types'
import { componentPieces } from '../../src/core/fragments'
import { skeleton } from '../../src/core/slots'
import { articleToHtmlBlocks, articleToMarkdown, cardContent, extractArticle } from '../../src/core/wxImport'

const page = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'wechat-article.html'), 'utf8')
import { blocksOf, card, chapter, parse } from './importCardFixture'
const doc = (blocks: Block[]): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId: THEMES[0].id, blocks, createdAt: 0, updatedAt: 0 })

describe('wechat article import', () => {
  const a = extractArticle(parse(page))
  it('reads meta information', () => {
    expect(a.title).toBe('测试推文：社团招新季')
    expect(a.account).toBe('测试公众号')
    expect(a.cover).toBe('https://mmbiz.qpic.cn/mmbiz_jpg/COVERcover123/0?wx_fmt=jpeg')
    expect(a.digest).toBe('一年一度的社团招新来啦')
  })
  it('cleans the content and replaces widgets', () => {
    const html = a.root.innerHTML
    expect(html).not.toMatch(/<script|<iframe|onclick|onload|class=|visibility: hidden|mp-style/)
    expect(html).toContain('［原文此处为公众号名片，导入时已移除］')
    expect(html).toContain('<section style="color: #333;">'.replace(';', '')) // div → section
  })
  it('splits into html blocks: styled sections alone, plain paragraphs grouped', () => {
    const blocks = articleToHtmlBlocks(a.root) as Block<'html'>[]
    expect(blocks.length).toBeGreaterThanOrEqual(5)
    expect(blocks[0].props.html).toContain('社团招新季')
    expect(blocks[0].props.label.startsWith('社团招新季')).toBe(true)
    expect(blocks.some((b) => b.props.label === '原文图片')).toBe(true)
    // 编译后无脚本，图片地址可被映射
    const r = compileDoc(doc(blocks), { mapImage: (u) => u.replace('mmbiz.qpic.cn', 'img.test') })
    expect(r.html).toContain('https://img.test/mmbiz_jpg/ABCdef123/640?wx_fmt=jpeg')
    expect(r.html).not.toMatch(/<script|onclick/)
  })
  describe('sections that hold a whole chapter in one card (collection integration)', () => {
it('keeps the bare card content for the component library', () => {
      // 两个同样的小标题在卡片不同位置：模块的外壳边距不同，但收藏用的内容结构相同；纯文字段落不收
      const blocks = blocksOf(card(chapter))
      const content = blocks.map((b) => cardContent.get(b) ?? '')
      expect(content[0]).not.toBe('')
      expect(content[0]).not.toContain('repeat-y')
      expect(content[0]).toContain('font-size: 16px')
      expect(skeleton(content[0], parse)).toBe(skeleton(content[3], parse))
      expect(skeleton(blocks[0].props.html, parse)).not.toBe(skeleton(blocks[3].props.html, parse))
      expect(componentPieces(content[1], 'x', parse)).toEqual([])
      expect(componentPieces(content[2], 'x', parse)).toHaveLength(1)
      expect(cardContent.get(blocks[6])).toBeUndefined()
    })
  })
  it('converts to markdown for re-layout', () => {
    const { markdown, images } = articleToMarkdown(a)
    expect(markdown.startsWith('# 测试推文：社团招新季')).toBe(true)
    expect(markdown).toContain('## 活动安排')
    expect(images).toEqual(['https://mmbiz.qpic.cn/mmbiz_jpg/ABCdef123/640?wx_fmt=jpeg'])
    const o = parseArticle(markdown)
    expect(o.sections.map((s) => s.heading)).toContain('活动安排')
    expect(o.sections.flatMap((s) => s.quotes).some((q) => q.source.includes('张同学'))).toBe(true)
  })
  it('exports html blocks to markdown text', () => {
    expect(exporterSmoke(articleToHtmlBlocks(a.root))).toContain('温馨提示：请携带学生证')
  })
})

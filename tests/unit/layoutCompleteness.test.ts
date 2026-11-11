import { expect, it } from 'vitest'
import { normalizeOutline, parseArticle, sectionTables } from '../../src/core/outline'
import { buildVariants } from '../../src/core/layouts'
import { docToMarkdown } from '../../src/core/exporters'
import { compileDoc } from '../../src/core/compiler'
import { buildFromDesign, normalizeDesign, SECTION_LAYOUTS } from '../../src/core/aiDesign'

it('preserves every source quotation in every offline layout and actual export', () => {
  const quotes = ['引语首标记AAA', '引语中标记BBB', '引语尾标记CCC', '第四条引语DDD']
  const outline = parseArticle('# 引语完整性\n\n## 第一章\n\n' + quotes.map(q => '> ' + q).join('\n\n'))
  expect(outline.sections[0].quotes).toHaveLength(quotes.length)
  for (const { recipe, doc } of buildVariants(outline, [])) {
    for (const output of [docToMarkdown(doc), JSON.stringify(doc), compileDoc(doc).html]) {
      for (const quote of quotes) expect(output, recipe.id).toContain(quote)
      expect(quotes.map(q => output.indexOf(q))).toEqual([...quotes.map(q => output.indexOf(q))].sort((a, b) => a - b))
    }
  }
})

it('keeps every table in a section rather than overwriting the previous one', () => {
  const input = '# 双表测试\n\n## 第一章\n\n| A | B |\n|---|---|\n| 首表唯一AAA | 数据甲 |\n\n表间正文保留。\n\n| C | D |\n|---|---|\n| 尾表唯一BBB | 数据乙 |'
  for (const { recipe, doc } of buildVariants(parseArticle(input), [])) {
    for (const output of [docToMarkdown(doc), JSON.stringify(doc), compileDoc(doc).html]) {
      expect(output, recipe.id).toContain('首表唯一AAA')
      expect(output, recipe.id).toContain('尾表唯一BBB')
      expect(output, recipe.id).toContain('表间正文保留')
      expect(output.indexOf('首表唯一AAA')).toBeLessThan(output.indexOf('尾表唯一BBB'))
    }
  }
})

it('retains all timeline description clauses and their punctuation', () => {
  const input = '# 时间测试\n\n## 第一章\n\n09:00 开始，说明甲，说明乙；说明丙\n\n10:00 结束，尾甲，尾乙'
  const outline = parseArticle(input)
  expect(outline.sections[0].timeline[0].desc).toBe('说明甲，说明乙；说明丙')
  expect(outline.sections[0].timeline[1].desc).toBe('尾甲，尾乙')
  for (const { recipe, doc } of buildVariants(outline, [])) {
    for (const output of [docToMarkdown(doc), JSON.stringify(doc), compileDoc(doc).html]) {
      for (const marker of ['说明甲', '说明乙', '说明丙', '尾甲', '尾乙']) expect(output, recipe.id).toContain(marker)
    }
  }
})

it('preserves all quotations in every AI design layout without a real model dependency', () => {
  const quotes = ['首条AAA', '中间BBB', '第三CCC', '末条DDD']
  const outline = parseArticle('# 完整设计\n\n## 第一章\n\n' + quotes.map(q => '> ' + q).join('\n\n'))
  for (const layout of SECTION_LAYOUTS) {
    const design = normalizeDesign({ sections: [{ layout, images: 0 }] }, 1)
    const doc = buildFromDesign(outline, [], design)
    for (const marker of quotes) expect(docToMarkdown(doc), layout).toContain(marker)
  }
})

it('keeps all tables through outline normalization and each design layout', () => {
  const parsed = parseArticle('# 双表设计\n\n## 第一章\n\n| 首表头 |\n|---|\n| 首表AAA |\n\n分隔正文。\n\n| 尾表头 |\n|---|\n| 尾表BBB |')
  const outline = normalizeOutline(parsed, parsed)
  expect(sectionTables(outline.sections[0])).toHaveLength(2)
  for (const layout of SECTION_LAYOUTS) {
    const design = normalizeDesign({ sections: [{ layout, images: 0 }] }, 1)
    const doc = buildFromDesign(outline, [], design)
    const output = docToMarkdown(doc)
    expect(output, layout).toContain('首表AAA')
    expect(output, layout).toContain('尾表BBB')
    expect(doc.blocks.filter(b => b.type === 'table')).toHaveLength(2)
  }
})

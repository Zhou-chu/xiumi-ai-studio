import { expect, it } from 'vitest'
import { checkCopy, copyToMarkdown, findAnchor, levelCounts, limitLevels, normalizeCopyText, parseCopy, robotPhrases, sectionOf } from '../../src/core/copy'

it('parses mixed heading syntax and preserves quote, byline and body order across CRLF', () => {
  const text = '# **活动回顾**\r\n副标题：春日现场\r\n第一段导语\r\n## **开场**\r\n- 第一条正文\r\n【二级标题】嘉宾\r\n> 「保留这句话」 —— 嘉宾\r\n![](https://images.test/a.png)\r\n---\r\n文字：编辑部'
  expect(parseCopy(text)).toEqual({
    title: '活动回顾', subtitle: '春日现场', credits: ['文字：编辑部'], items: [
      { id: 'P1', kind: 'para', text: '第一段导语' },
      { id: 'P2', kind: 'heading', level: 1, text: '开场' },
      { id: 'P3', kind: 'para', text: '第一条正文' },
      { id: 'P4', kind: 'heading', level: 2, text: '嘉宾' },
      { id: 'P5', kind: 'quote', text: '保留这句话', source: '嘉宾' },
    ],
  })
})

it('retains IDs and source document when flattening excess levels and serializing', () => {
  const copy = parseCopy('# 固定标题\n副标题：副文\n## 主章\n### 次章\n> 没有来源\n编辑：甲')
  const snapshot = structuredClone(copy)
  const limited = limitLevels(copy, 1)
  expect(copy).toEqual(snapshot)
  expect(levelCounts(limited)).toEqual([1, 0, 0])
  expect(limited.items[1]).toEqual({ id: copy.items[1].id, kind: 'para', text: '**次章**' })
  expect(copyToMarkdown(limited)).toBe('# 固定标题\n\n副标题：副文\n\n## 主章\n\n**次章**\n\n> 没有来源\n\n编辑：甲')
})

it('diagnoses raw skipped heading depths even when parsed levels are compact', () => {
  const check = checkCopy('# 标题\n## 一\n#### 二\n**正文**【待补充】\n【待补充】', 1)
  expect(check.counts).toEqual([1, 1, 0])
  expect(check.todo).toBe(2)
  expect(check.chars).toBe('正文【待补充】【待补充】'.length)
  expect(check.problems).toEqual([expect.stringContaining('超过'), expect.stringContaining('跳级')])
  expect(checkCopy('一条没有井号的正文', 3).problems).toEqual(expect.arrayContaining([expect.stringContaining('第一行'), expect.stringContaining('没有标出')]))
})

it('finds first explicit anchoring phrase and labels its section', () => {
  const copy = parseCopy('# 主标题\n导语\n## 首章\n**活动** 如期举行。\n## 下一章\n活动如期举行。')
  expect(findAnchor(copy, '「活动 如期举行。」')).toBe('P3')
  expect(findAnchor(copy, ' “ ” 。')).toBe('')
  expect(findAnchor(copy, '不存在')).toBe('')
  expect(sectionOf(copy, 'P1')).toBe('导语')
  expect(sectionOf(copy, 'P3')).toBe('首章')
})

it.each([
  [{ markdown: '\r\n```md\r\n 新标题\r\n正文\r\n```\r\n' }, '# 新标题\n正文'],
  [' # 已有标题\r正文', '# 已有标题\n正文'],
  [{ unexpected: 'not markdown' }, ''],
  [null, ''],
])('normalizes model output without inventing content: %j', (raw, expected) => {
  expect(normalizeCopyText(raw)).toBe(expected)
})

it('reports repeated tolerated boilerplate but not its single occurrence', () => {
  expect(robotPhrases('本次活动首先签到，此次活动如期结束。本次活动圆满结束。')).toEqual(['首先', '本次活动'])
})

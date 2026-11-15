// 按标准名称套用模块：文案结构决定顺序，模板只提供模块
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Kit } from '../../src/core/assemble'
import { createBlock } from '../../src/core/blocks'
import { checkCopy, copyLevels, findAnchor, limitLevels, normalizeCopyText, parseCopy } from '../../src/core/copy'
import { checkPlan, fixedPlacements, type PhotoUnit } from '../../src/core/photoPlan'
import { guessRole, guessTemplateRoles, rolesForPhotos, type RoleId } from '../../src/core/roles'
import type { Block } from '../../src/core/types'

const parse = (s: string) => new JSDOM(s).window.document
const html = (h: string, label = '片段') => createBlock('html', { html: h, label })
const OLD = 'https://mmbiz.qpic.cn/old/640?wx_fmt=jpeg'

/** 仿照常见活动推文：封面、章节标题、正文、单图、双图、花边、结尾署名 */
const blocks: Block[] = [
  html(`<section style="background-color: #fdf3e7; padding: 20px"><p style="font-size: 24px; color: #a0522d"><strong>2025 秋季运动会圆满结束</strong></p><p style="font-size: 18px; color: #999"><strong>旧副标题奔跑吧少年</strong></p></section>`),
  html('<section style="text-align: center"><span style="font-size: 26px; color: #a0522d">01</span><p style="font-size: 18px"><strong>旧章节开幕式</strong></p></section>'),
  html('<p style="font-size: 15px; text-indent: 2em">旧正文第一段，去年的开幕式在体育场举行，三千名同学参加了入场式。</p>'),
  html(`<section style="padding: 8px; border: 1px solid #a0522d"><img src="${OLD}" style="width: 100%"><p style="font-size: 12px; text-align: center">▲图｜旧图注</p></section>`),
  html(`<section style="display: flex"><section style="width: 50%"><img src="${OLD}"></section><section style="width: 50%"><img src="${OLD}"></section></section><p style="font-size: 12px">组图｜旧组图说明</p>`),
  html('<p style="text-align: center; color: #a0522d">· · ·</p>'),
  html('<section style="text-align: center"><p>END</p><p style="font-size: 12px">文字｜张三 图片｜李四</p><p style="font-size: 12px">点击蓝字关注我们</p></section>'),
]
const kitOf = (list: Block[], rs: RoleId[]): Kit => {
  const kit: Kit = {}
  list.forEach((b, i) => {
    if (rs[i] !== 'other' && !kit[rs[i]]) kit[rs[i]] = { role: rs[i], block: b, from: '模板' }
  })
  return kit
}
const kit = kitOf(blocks, ['cover', 'h1', 'body', 'img1', 'img2lr', 'divider', 'ending'])

const MD = `# 2026 秋季科技文化节圆满落幕
副标题：十天四十场活动

十天、四十余场活动，三千余人次参与。

## 开幕式

主楼广场的灯一盏盏亮起来。

五个院系的同学完成了光的接力。

## 创客市集

四十二个摊位上摆满了作品。

> 科学是每个愿意提问的人的冒险 —— 王老师

文字：学生科协宣传部
图片：摄影协会`

describe('standard module names', () => {
  let roles: RoleId[]
  beforeAll(() => { roles = guessTemplateRoles(blocks, { parse }) })
  it('guesses roles for a typical template', () => {
    expect(roles).toEqual(['cover', 'h1', 'body', 'img1', 'img2lr', 'divider', 'ending'])
  })
  it('reads photo layouts from widths', () => {
    const two = (a: number, b: number) => html(`<section style="display: flex"><section style="width: ${a}%"><img src="${OLD}"></section><section style="width: ${b}%"><img src="${OLD}"></section></section>`)
    expect(guessRole(two(66, 34), { parse })).toBe('img2big')
    expect(guessRole(html(`<img src="${OLD}" style="width: 100%"><img src="${OLD}" style="width: 100%">`), { parse })).toBe('img2tb')
    expect(guessRole(html(`<section style="display: flex"><img src="${OLD}"><img src="${OLD}"><img src="${OLD}"></section>`), { parse })).toBe('img3row')
    expect(guessRole(html(`<img src="${OLD}" style="width: 100%"><section style="display: flex"><img src="${OLD}"><img src="${OLD}"></section>`), { parse })).toBe('img3big')
    expect(guessRole(html(`<section style="overflow-x: auto; white-space: nowrap"><img src="${OLD}"><img src="${OLD}"><img src="${OLD}"></section>`), { parse })).toBe('carousel')
    expect(guessRole(html('<p>标题</p>', '二级标题 · 实验室见闻'), { parse })).toBe('h2')
    expect(guessRole(createBlock('photos', { count: 4 }))).toBe('img4')
    expect(rolesForPhotos(3)).toEqual(['img3big', 'img3row', 'carousel'])
  })
})

describe('copy with heading levels', () => {
  it('parses title, subtitle, levels, quotes and credits', () => {
    const c = parseCopy(MD.replace('## 创客市集', '### 市集现场'))
    expect(c.title).toBe('2026 秋季科技文化节圆满落幕')
    expect(c.subtitle).toBe('十天四十场活动')
    expect(c.items.filter((i) => i.kind === 'heading').map((i) => [i.text, (i as { level: number }).level])).toEqual([['开幕式', 1], ['市集现场', 2]])
    expect(c.items.find((i) => i.kind === 'quote')).toMatchObject({ text: '科学是每个愿意提问的人的冒险', source: '王老师' })
    expect(c.credits).toEqual(['文字：学生科协宣传部', '图片：摄影协会'])
  })
  it('accepts labeled headings and falls back to short lines', () => {
    expect(copyLevels(parseCopy('标题\n【一级标题】开场\n正文。\n【二级标题】细节\n正文。'))).toBe(2)
    const plain = parseCopy('活动回顾\n导语一段话，交代背景。\n开幕式\n正文内容。')
    expect(plain.items.find((i) => i.kind === 'heading')).toMatchObject({ level: 1, text: '开幕式' })
  })
  it('limits levels by turning deeper headings into bold lines', () => {
    const c = limitLevels(parseCopy('# T\n## 一\n正文\n### 二\n正文'), 1)
    expect(copyLevels(c)).toBe(1)
    expect(c.items.some((i) => i.kind === 'para' && i.text === '**二**')).toBe(true)
  })
  it('finds the paragraph holding a pasted sentence', () => {
    const c = parseCopy(MD)
    expect(findAnchor(c, ' 主楼广场的灯一盏盏亮起来 ')).toBe(c.items.find((i) => i.text.startsWith('主楼'))!.id)
    expect(findAnchor(c, '不存在的句子')).toBe('')
  })
  it('flags robotic phrases, skipped levels and missing headings', () => {
    const r = checkCopy('# T\n## 一\n首先，本次活动旨在助力成长。\n#### 三\n正文', 3)
    expect(r.robot).toEqual(expect.arrayContaining(['首先', '旨在', '助力']))
    expect(r.problems.some((p) => p.includes('跳级'))).toBe(true)
    expect(checkCopy('# T\n只有正文', 2).problems.some((p) => p.includes('没有标出章节标题'))).toBe(true)
    expect(normalizeCopyText({ markdown: '```markdown\n标题\n## 一\n```' })).toBe('# 标题\n## 一')
  })
})

describe('photo plan', () => {
  const copy = parseCopy(MD)
  const anchor = '主楼广场的灯一盏盏亮起来'
  const singles = (ids: number[], a = anchor): PhotoUnit[] => ids.map((i) => ({ key: `a${i}`, photos: [i], grouped: false, anchor: a }))

  it('asks when several single photos follow the same sentence', () => {
    const c = checkPlan(copy, kit, singles([0, 1]), { parse })
    expect(c.crowded).toHaveLength(1)
    expect(c.crowded[0]).toMatchObject({ photos: [0, 1], layouts: ['img2lr'], section: '开幕式' })
    expect(checkPlan(copy, kit, singles([0], '没有这句'), { parse }).unmatched).toHaveLength(1)
    expect(checkPlan(parseCopy('# T\n## 一\n### 二\n正文'), kit, []).levels).toEqual({ copy: 2, kit: 1 })
    const group: PhotoUnit = { key: 'g', photos: [0, 1, 2], grouped: true, layout: '' }
    expect(checkPlan(copy, kit, [group], { parse }).noLayout).toHaveLength(1)
  })
  it('applies the decision for crowded sentences', () => {
    const input = { copy, kit, units: singles([0, 1]), singlesFor: new Set<string>(), opts: { parse } }
    const after = findAnchor(copy, anchor)
    expect(fixedPlacements({ ...input, crowd: { [after]: { mode: 'group', layout: 'img2lr' } } }).fixed).toEqual([{ after, photos: [0, 1], layout: 'img2lr' }])
    expect(fixedPlacements({ ...input, crowd: { [after]: { mode: 'singles' } } }).fixed[0].layout).toBe('singles')
    expect(fixedPlacements({ ...input, crowd: { [after]: { mode: 'ai', request: '并排' } } }).askAi).toEqual([{ after, photos: [0, 1], request: '并排' }])
  })
})

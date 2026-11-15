import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { docToMarkdown } from '../../src/core/exporters'
import type { Block, Doc, RichText } from '../../src/core/types'
import { defaultReplay } from '../../src/core/replay/schema'

const doc = (...blocks: Block[]): Doc => ({
  id: 'fixture', title: 'ignored document title', author: '', digest: '', themeId: 'default',
  blocks, createdAt: 1, updatedAt: 1,
})
const rich = (text: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const lines = (...parts: string[]) => parts.join('\n\n') + '\n'
const image = { src: '/media/a.jpg?fit=3:2' }

it('exports cover, heading, body, emphasized card, quote and footer in document order without mutation', () => {
  const body = rich('正文'); body.content![0].content![0].marks = [{ type: 'bold' }]
  const fixture = doc(
    createBlock('cover', { title: '封面', subtitle: '副题', meta: '日期', image }),
    createBlock('heading', { index: '01', title: '标题', subtitle: '导语' }),
    createBlock('paragraph', { content: body }),
    createBlock('card', { title: '要点', content: rich('卡片内容') }),
    createBlock('quote', { text: '所引内容', source: '原文' }),
    createBlock('ending', { text: '结束语', author: '作者', note: '附注' }),
  )
  const expected = lines('# 封面','> 副题','日期','![](/media/a.jpg?fit=3:2)','## 01 标题','导语','**正文**','**要点**','卡片内容','> 所引内容\n>\n> —— 原文','---','**结束语**','附注','作者')
  const before = structuredClone(fixture)
  expect(docToMarkdown(fixture)).toBe(expected)
  expect(fixture).toEqual(before)
})
it('omits empty optional labels and image slots rather than outputting broken placeholders', () => {
  const result = docToMarkdown(doc(
    createBlock('cover', { title: '封面', subtitle: '', meta: '', image: undefined }),
    createBlock('heading', { index: '', title: '标题', subtitle: '' }),
    createBlock('card', { title: '', content: rich('内容') }),
    createBlock('quote', { text: '无出处', source: '' }),
    createBlock('imageText', { title: '', image: undefined, content: rich('说明') }),
    createBlock('image', { image: undefined, caption: '' }),
    createBlock('gallery', { images: [], caption: '' }),
    createBlock('frame', { image: undefined, caption: '' }),
    createBlock('ending', { text: '', note: '', author: '' }),
  ))
  expect(result).toBe(lines('# 封面','## 标题','内容','> 无出处','说明','---'))
})
it('retains image sources, captions, gallery order and profile identity', () => {
  const result = docToMarkdown(doc(
    createBlock('imageText', { title: '图文', image, content: rich('两栏') }),
    createBlock('image', { image, caption: '图注' }),
    createBlock('gallery', { images: [image, { src: '/media/b.png' }], caption: '组图' }),
    createBlock('profile', { image, name: '姓名', role: '身份', bio: '介绍' }),
    createBlock('frame', { image, caption: '相框' }),
  ))
  expect(result).toBe(lines('![](/media/a.jpg?fit=3:2)','**图文**','两栏','![图注](/media/a.jpg?fit=3:2)','*图注*',
    '![](/media/a.jpg?fit=3:2)\n![](/media/b.png)','*组图*','![姓名](/media/a.jpg?fit=3:2)','**姓名** · 身份','介绍','![相框](/media/a.jpg?fit=3:2)','*相框*'))
})
it('outputs timeline and table rows with an exact heading divider and recurses into boxes', () => {
  const table = createBlock('table', { headers: ['列一','列二'], rows: [['甲','乙'],['丙','丁']] })
  const timeline = createBlock('timeline', { items: [{ time: '08:00', title: '签到', desc: '' }, { time: '09:00', title: '开场', desc: '介绍' }] })
  const box = createBlock('box', { title: '组块', children: [timeline, table, createBlock('divider')] })
  expect(docToMarkdown(doc(box))).toBe(lines('### 组块','- **08:00** 签到\n- **09:00** 开场：介绍','| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n| 丙 | 丁 |','---'))
})
it('limits photo grids to their declared count, skips blanks and preserves captioned carousel order', () => {
  const a = { image: { src: '/media/a.jpg' }, caption: '甲' }
  const b = { image: { src: '/media/b.jpg' }, caption: '' }
  const result = docToMarkdown(doc(
    createBlock('photos', { count: 2, pics: [a, { caption: '无图' }, b] }),
    createBlock('carousel', { pics: [b, { caption: '空项' }, a] }),
  ))
  expect(result).toBe(lines('![甲](/media/a.jpg)','*甲*','![](/media/b.jpg)','![甲](/media/a.jpg)','*甲*'))
})
it('converts supported entities and line boundaries in imported HTML while retaining image URLs', () => {
  const source = '<section><h2>片段 &amp; 示例</h2><p>甲&nbsp;&lt;乙&gt;<br/>下一行</p><img src="/media/ref?a=1&amp;b=2"></section>'
  expect(docToMarkdown(doc(createBlock('html', { html: source })))).toBe(lines('片段 & 示例\n甲 <乙>\n下一行','![](/media/ref?a=1&b=2)'))
})
it('renders a static replay synopsis without omitted art, animation identifiers or unfilled image slots', () => {
  const replay = defaultReplay()
  replay.scenes = [{ id: 'scene-fixture', layout: 'flow', finale: 'exit', items: [
    { id: '1', type: 'title', content: '章节' }, { id: '2', type: 'text', content: '内容' },
    { id: '3', type: 'quote', content: '引号', label: '出处' }, { id: '4', type: 'quote', content: '另引' },
    { id: '5', type: 'stat', content: '100%', label: '完成' }, { id: '6', type: 'stat', content: '48' },
    { id: '7', type: 'image', content: '', image, label: '帧图' }, { id: '8', type: 'image', content: '无图' },
    { id: '9', type: 'divider', content: '不输出的线' }, { id: '10', type: 'shape', content: '不输出的装饰' },
  ] }]
  expect(docToMarkdown(doc(createBlock('replay', replay)))).toBe(lines('## 章节','内容','> 引号 —— 出处','> 另引','**100%** 完成','**48** ','![帧图](/media/a.jpg?fit=3:2)'))
})

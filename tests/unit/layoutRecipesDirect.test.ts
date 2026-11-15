import { afterEach, expect, it, vi } from 'vitest'
import { buildDoc, buildVariants, ImagePool, RECIPES } from '../../src/core/layouts'
import type { Outline, OutlineSection } from '../../src/core/outline'
import type { Block, ImageRef, RichNode } from '../../src/core/types'
const section = (changes: Partial<OutlineSection> = {}): OutlineSection => ({ heading: '章节', paragraphs: ['正文'], imageRefs: [], quotes: [], timeline: [], people: [], ...changes })
const outline = (changes: Partial<Outline> = {}): Outline => ({ title: '标题', subtitle: '摘要', kicker: '眉题', meta: '日期', intro: [], sections: [section()], highlights: [], ending: { text: '结束', author: '', note: '' }, ...changes })
const images = (count: number): ImageRef[] => Array.from({ length: count }, (_, i) => ({ src: `/fixture/${i}.jpg`, alt: `${i}.jpg` }))
const recipe = (id: string) => RECIPES.find(r => r.id === id)!
function usedImages(blocks: Block[]): string[] {
  return blocks.flatMap(b => {
    if (b.type === 'gallery') return b.props.images.map(i => i.src)
    if (b.type === 'image' || b.type === 'imageText' || b.type === 'cover') return b.props.image ? [b.props.image.src] : []
    return []
  })
}
const plain = (node: RichNode): string => node.text ?? (node.content ?? []).map(plain).join('')
afterEach(() => vi.restoreAllMocks())
it('allocates preferred basename or alt once, then falls back in order without mutating caller images', () => {
  const input = images(4), copy = structuredClone(input), pool = new ImagePool(input)
  input[2].alt = 'special'; copy[2].alt = 'special'
  expect(pool.take(2, ['absent', '/path/special', 'special'])).toEqual([input[2], input[0]])
  expect(pool.size).toBe(2)
  expect(pool.one(['/else/3.jpg'])).toBe(input[3])
  expect(pool.rest()).toEqual([input[1]]); expect(pool.rest()).toEqual([])
  expect(pool.one()).toBeUndefined(); expect(input).toEqual(copy)
})
it('binds document metadata and override theme while leaving the typed outline and images untouched', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1234)
  const o = outline({ subtitle: '摘'.repeat(60) }), pics = images(2)
  const before = structuredClone({ o, pics })
  const doc = buildDoc(o, pics, recipe('narrative'), 'explicit-theme')
  expect(doc).toMatchObject({ title: '标题', digest: '摘'.repeat(54), author: '', themeId: 'explicit-theme', createdAt: 1234, updatedAt: 1234, cover: pics[0] })
  expect(doc.id).toBeTruthy(); expect(new Set(doc.blocks.map(b => b.id)).size).toBe(doc.blocks.length)
  expect({ o, pics }).toEqual(before)
})
it('renders all three recipes with independent documents and preserves every supplied image', () => {
  const pics = images(14), o = outline({ intro: ['导语'], sections: [section(), section({ heading: '第二节' }), section({ heading: '第三节' })], highlights: ['亮点1', '亮点2'] })
  const variants = buildVariants(o, pics)
  expect(variants.map(x => x.doc.themeId)).toEqual(RECIPES.map(x => x.defaultTheme))
  expect(new Set(variants.map(x => x.doc.id)).size).toBe(3)
  for (const { doc } of variants) {
    expect(usedImages(doc.blocks).sort()).toEqual(pics.map(p => p.src).sort())
    expect(doc.blocks.at(-1)).toMatchObject({ type: 'ending', props: { author: '文字 / 图片 / 编辑：' } })
  }
})
it('does not consume and lose the section image when a card chapter contains no paragraph', () => {
  const pics = images(2)
  const doc = buildDoc(outline({ sections: [section({ paragraphs: [] })] }), pics, recipe('cards'))
  expect(usedImages(doc.blocks)).toEqual(pics.map(p => p.src))
})
it('keeps narrative extras and limits quotations without changing source arrays', () => {
  const s = section({ paragraphs: ['一', '二', '三'], timeline: [{ time: '10:00', title: '开场', desc: '内容' }], table: { headers: ['列'], rows: [['值']] }, people: [{ name: '人物', role: '职务', bio: '简介' }], quotes: [{ text: '引言1', source: '甲' }, { text: '引言2', source: '乙' }, { text: '引言3', source: '丙' }] })
  const before = structuredClone(s)
  const doc = buildDoc(outline({ sections: [s, section()] }), images(6), recipe('narrative'))
  expect(doc.blocks.filter(b => b.type === 'quote')).toHaveLength(2)
  expect(doc.blocks.find(b => b.type === 'timeline')).toMatchObject({ props: { items: s.timeline } })
  expect(doc.blocks.find(b => b.type === 'table')).toMatchObject({ props: { headers: ['列'], rows: [['值']], caption: '' } })
  expect(doc.blocks.find(b => b.type === 'profile')).toMatchObject({ props: s.people[0] })
  expect(doc.blocks.filter(b => b.type === 'divider')).toHaveLength(1)
  expect(s).toEqual(before)
})
it.each([['有句号', '首'.repeat(80) + '。' + '尾'.repeat(70), 81], ['无句号', '文'.repeat(151), 120]] as const)('splits long card paragraphs without losing text: %s', (_label, text, cut) => {
  const doc = buildDoc(outline({ sections: [section({ paragraphs: [text, '中段', '末段'] }), section({ heading: '次章', paragraphs: ['短句'] })] }), images(3), recipe('cards'))
  const paired = doc.blocks.filter(b => b.type === 'imageText')
  expect(paired.map(b => b.props.imagePosition)).toEqual(['left', 'right'])
  expect(plain(paired[0].props.content)).toBe(text.slice(0, cut))
  expect(plain(doc.blocks.find(b => b.type === 'paragraph')!.props.content)).toBe(text.slice(cut))
  const lastCard = doc.blocks.find(b => b.type === 'card')!
  expect(plain(lastCard.props.content)).toBe('末段'); expect(lastCard.props.variant).toBe('fill')
})
it.each(['narrative', 'cards', 'photo'])('handles no images or empty sections in %s without phantom image blocks', id => {
  const doc = buildDoc(outline({ intro: ['长'.repeat(91)], sections: [section({ paragraphs: [] }), section()], ending: { text: '完', author: '原作者', note: '保留' } }), [], recipe(id))
  expect(usedImages(doc.blocks)).toEqual([])
  expect(doc.blocks.at(-1)).toMatchObject({ type: 'ending', props: { author: '原作者', note: '保留' } })
  expect(doc.blocks.some(b => b.type === 'paragraph' && plain(b.props.content) === '正文')).toBe(true)
})
it.each([1, 2, 3])('retains small photo remainders and picks a matching final gallery column count: %i', count => {
  const doc = buildDoc(outline({ sections: [] }), images(count + 1), recipe('photo'))
  expect(doc.blocks.find(b => b.type === 'gallery')).toMatchObject({ props: { columns: count, images: images(count + 1).slice(1) } })
})

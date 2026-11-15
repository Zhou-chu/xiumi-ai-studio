import { expect, it } from 'vitest'
import { buildFromDesign, designTheme, normalizeDesign, outlineBrief } from '../../src/core/aiDesign'
import type { Outline, OutlineSection } from '../../src/core/outline'
import { richToPlain } from '../../src/core/richtext'
import { SANS, SERIF } from '../../src/core/themes'

const section = (patch: Partial<OutlineSection> = {}): OutlineSection => ({
  heading: '本节标题', paragraphs: [], quotes: [], timeline: [], people: [], imageRefs: [], ...patch,
})
const outline = (patch: Partial<Outline> = {}): Outline => ({
  title: '标题', subtitle: '副标题', kicker: '预设', meta: '来源', intro: [], sections: [],
  highlights: [], ending: { text: '结尾', author: '', note: '尾注' }, ...patch,
})
const image = (name: string) => ({ src: '/media/' + name + '.jpg', width: 640, height: 480 })

it('turns an AI design into bounded typography and keeps explicit image radius separate', () => {
  const style = normalizeDesign({ type: { headingFont: 'serif', fontSize: '16', h2Size: 10, h1Size: 50, lineHeight: -2, radius: 15, imageRadius: 2 }, styles: { cover: 'band', heading: 'bar', card: 'accent' } }, 0)
  expect(designTheme(style)).toMatchObject({
    fontBody: SANS, fontHeading: SERIF, fontSize: 16, h2Size: 17, h1Size: 30, lineHeight: 1.6,
    radius: 15, imageRadius: 2, coverVariant: 'band', headingVariant: 'bar', cardVariant: 'accent',
    smallSize: 12, colors: { bg: '#FFFFFF', primary: style.palette.primary },
  })
  expect(designTheme(normalizeDesign({ type: { radius: 5 } }, 0))).toMatchObject({ fontHeading: SANS, imageRadius: 5 })
})

it('bounds and validates section-plan fields without allowing extra sections or raw layout strings', () => {
  const style = normalizeDesign({
    name: '  ' + '名'.repeat(24) + '  ', concept: '构'.repeat(90), dividers: false, closingColumns: '2',
    sections: [{ layout: 'timeline', images: 80, subtitle: '副'.repeat(30) }, { layout: 'invalid', images: -3, subtitle: 5 }, { layout: 'cards', images: 4 }],
  }, 2, 1)
  expect(style).toMatchObject({
    name: '名'.repeat(16), concept: '构'.repeat(80), dividers: false, closingColumns: 2,
    sections: [
      { layout: 'timeline', images: 4, subtitle: '副'.repeat(24) },
      { layout: 'imageText', images: 0, subtitle: '' },
    ],
  })
})

it('summarizes counts and the first sentence without retaining the rest of an article', () => {
  const source = outline({ intro: ['开头', '次行'], highlights: ['重点'], sections: [
    section({ paragraphs: ['首句！不应发给摘要的后文。', '另一段'], table: { headers: ['科目'], rows: [['名单']] }, people: [{ name: '人名', role: '角色', bio: '简介' }] }),
    section(),
  ] })
  const brief = outlineBrief(source, 3)
  expect(brief).toEqual({
    title: source.title, subtitle: source.subtitle, introChars: 4, highlights: ['重点'], imageCount: 3,
    sections: [
      { heading: '本节标题', paragraphs: 2, chars: source.sections[0].paragraphs.join('').length, firstSentence: '首句', timeline: 0, quotes: 0, table: true, people: 1 },
      { heading: '本节标题', paragraphs: 0, chars: 0, firstSentence: '', timeline: 0, quotes: 0, table: false, people: 0 },
    ],
  })
  expect(JSON.stringify(brief)).not.toContain('不应发给摘要的后文')
})

it('preserves first-paragraph remainder when pairing images and alternates placement by section', () => {
  const lead = '缘'.repeat(55) + '。'
  const remainder = '后'.repeat(80)
  const first = lead + remainder
  const source = outline({ sections: [
    section({ heading: '第一节', paragraphs: [first, '次段'] }),
    section({ heading: '第二节', paragraphs: ['独立段'] }),
  ] })
  const style = normalizeDesign({ dividers: false, sections: [{ layout: 'imageText' }, { layout: 'imageText' }] }, 2)
  const doc = buildFromDesign(source, [image('cover'), image('a'), image('b')], style)
  expect(doc.blocks.map(block => block.type)).toEqual(['cover', 'heading', 'imageText', 'paragraph', 'paragraph', 'heading', 'imageText', 'ending'])
  const layouts = doc.blocks.filter(block => block.type === 'imageText')
  expect(layouts.map(block => [block.props.imagePosition, block.props.image?.src, richToPlain(block.props.content)])).toEqual([
    ['left', '/media/a.jpg', lead], ['right', '/media/b.jpg', '独立段'],
  ])
  expect(doc.blocks.filter(block => block.type === 'paragraph').map(block => richToPlain(block.props.content))).toEqual([remainder, '次段'])
  expect(source.sections[0].paragraphs).toEqual([first, '次段'])
})

it('preserves timeline, tables, profiles and lead-plus-remainder quotations once', () => {
  const quotes = [{ text: '第一引语', source: '甲' }, { text: '第二引语', source: '乙' }]
  const timeline = [{ time: '10:30', title: '开幕', desc: '大厅' }]
  const table = { headers: ['项目'], rows: [['正文']] }
  const people = [{ name: '作者', role: '编辑', bio: '工作' }]
  const source = outline({ intro: ['导读'], highlights: ['20 个', '5 人'], sections: [
    section({ quotes, timeline, table, people, paragraphs: ['本段'] }),
  ] })
  const doc = buildFromDesign(source, [], normalizeDesign({ opening: 'quote', sections: [{ layout: 'quoteLead' }] }, 1))
  expect(doc.blocks.map(block => block.type)).toEqual(['cover', 'quote', 'card', 'heading', 'quote', 'paragraph', 'timeline', 'table', 'profile', 'quote', 'ending'])
  expect(doc.blocks.filter(block => block.type === 'quote').map(block => block.props.text)).toEqual(['导读', '第一引语', '第二引语'])
  expect(doc.blocks.find(block => block.type === 'table')?.props).toMatchObject(table)
  expect(doc.blocks.find(block => block.type === 'timeline')?.props.items).toEqual(timeline)
  expect(doc.blocks.find(block => block.type === 'profile')?.props).toMatchObject(people[0])
})

it('keeps a lone unused image in the closing gallery and clamps columns to its count', () => {
  const images = [image('cover'), image('unused')]
  const doc = buildFromDesign(outline(), images, normalizeDesign({ closingColumns: 3 }, 0))
  expect(doc.cover).toEqual(images[0])
  expect(doc.blocks.map(block => block.type)).toEqual(['cover', 'heading', 'gallery', 'ending'])
  expect(doc.blocks.find(block => block.type === 'gallery')?.props).toMatchObject({ images: [images[1]], columns: 1 })
})
it.each([1,2,3,4])('places %i available gallery images without duplicating cover or losing text',count=>{
  const images=[image('cover'),...Array.from({length:count},(_,i)=>image('gallery-'+i))]
  const source=outline({sections:[section({paragraphs:['All body'],imageRefs:[]})]})
  const design=normalizeDesign({sections:[{layout:'galleryLead',images:count}]},1)
  const result=buildFromDesign(source,images,design)
  expect(result.blocks.map(b=>b.type)).toEqual(['cover','heading',count===1?'image':'gallery','paragraph','ending'])
  const body=result.blocks[2]
  if(body.type==='image')expect(body.props.image).toEqual(images[1])
  else if(body.type==='gallery'){expect(body.props.images).toEqual(images.slice(1));expect(body.props.columns).toBe(count===2||count===4?2:3)}
  else throw Error('expected image material')
  const paragraph=result.blocks[3]
  if(paragraph.type!=='paragraph')throw Error('expected preserved paragraph')
  expect(richToPlain(paragraph.props.content)).toBe('All body')
})
it('keeps long image-text material at the fixed fallback split when it has no sentence stop',()=>{
  const full='字'.repeat(140)
  const result=buildFromDesign(outline({sections:[section({paragraphs:[full]})]}),[image('cover'),image('inline')],normalizeDesign({sections:[{layout:'imageText',images:1}]},1))
  expect(result.blocks.filter(b=>b.type==='imageText').map(b=>richToPlain(b.props.content))).toEqual([full.slice(0,110)])
  expect(result.blocks.filter(b=>b.type==='paragraph').map(b=>richToPlain(b.props.content))).toEqual([full.slice(110)])
})
it.each(['missing-image','missing-text'] as const)('keeps the surviving imageText material for %s',missing=>{
  const images=missing==='missing-image'?[]:[image('cover'),image('body')]
  const result=buildFromDesign(outline({sections:[section({paragraphs:missing==='missing-text'?[]:['Retained body']})]}),images,normalizeDesign({sections:[{layout:'imageText',images:1}]},1))
  expect(result.blocks.map(b=>b.type)).toEqual(['cover','heading',missing==='missing-image'?'paragraph':'image','ending'])
  const material=result.blocks[2]
  if(material.type==='paragraph')expect(richToPlain(material.props.content)).toBe('Retained body')
  else if(material.type==='image')expect(material.props.image).toEqual(images[1])
  else throw Error('expected preserved material')
})
it('uses cards only for the first three short paragraphs and keeps oversized or later paragraphs verbatim',()=>{
  const text=['short', '长'.repeat(260),'third','fourth']
  const result=buildFromDesign(outline({sections:[section({paragraphs:text})]}),[],normalizeDesign({sections:[{layout:'cards',images:0}]},1))
  expect(result.blocks.map(b=>b.type)).toEqual(['cover','heading','card','paragraph','card','paragraph','ending'])
  expect(result.blocks.filter(b=>b.type==='card'||b.type==='paragraph').map(b=>richToPlain(b.props.content))).toEqual(text)
})
it.each(['timeline','quoteLead','imageTop','text'] as const)('keeps empty %s section safe and emits inter-section separators only once',layout=>{
  const result=buildFromDesign(outline({sections:[section(),section({paragraphs:['next']})]}),[],normalizeDesign({sections:[{layout,images:0},{layout,images:0}],dividers:true},2))
  expect(result.blocks.map(b=>b.type)).toEqual(['cover','heading','divider','heading','paragraph','ending'])
  expect(result.blocks.filter(b=>b.type==='paragraph').map(b=>richToPlain(b.props.content))).toEqual(['next'])
})
it('uses timeline material once and falls back to the text plan when a design omits later section plans',()=>{
  const items=[{time:'1',title:'Start',desc:'description'}]
  const result=buildFromDesign(outline({ending:{text:'End',author:'Named editor',note:''},sections:[section({timeline:items,paragraphs:['after timeline']}),section({paragraphs:['first','rest']})]}),[],normalizeDesign({sections:[{layout:'timeline'}]},1))
  expect(result.blocks.filter(b=>b.type==='timeline').map(b=>b.props.items)).toEqual([items])
  expect(result.blocks.filter(b=>b.type==='paragraph').map(b=>richToPlain(b.props.content))).toEqual(['after timeline','first','rest'])
  expect(result.blocks.at(-1)).toMatchObject({type:'ending',props:{author:'Named editor'}})
})
it.each(['card','quote'] as const)('preserves intro text when opening=%s and quote text exceeds its short limit',opening=>{
  const intro=['intro '+ 'x'.repeat(121),'second']
  const result=buildFromDesign(outline({intro,highlights:['one','two']}),[],normalizeDesign({opening,highlights:'none'},0))
  expect(result.blocks.map(b=>b.type)).toEqual(opening==='card'?['cover','card','ending']:['cover','paragraph','paragraph','ending'])
  const content=result.blocks.filter(b=>b.type==='paragraph'||b.type==='card').map(b=>richToPlain(b.props.content)).join('\n')
  expect(content).toBe(intro.join('\n'))
})
it('retains valid soft palette values but repairs same-as-primary accents and invalid numeric typography',()=>{
  const design=normalizeDesign({palette:{primary:'#112233',accent:'#112233',primarySoft:'#fafafa',surface:'#ffffff',border:'#eeeeee'},type:{fontSize:'bad',lineHeight:Infinity,letterSpacing:NaN},kicker:'  Banner  '},0)
  expect(design.palette).toMatchObject({primary:'#112233',primarySoft:'#fafafa',surface:'#ffffff',border:'#eeeeee'})
  expect(design.palette.accent).not.toBe(design.palette.primary)
  expect(design.type).toMatchObject({fontSize:15,lineHeight:1.8,letterSpacing:0.5})
  expect(design.kicker).toBe('Banner')
})

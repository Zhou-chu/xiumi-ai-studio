// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attrs, coverColor, drawRun, el, frameRect, group, itemBody, lineBox, lineSegments, markerAttrs, markSpans, rand, shape, type RenderCtx } from '../../src/core/replay/draw'
import type { TextRun } from '../../src/core/replay/layout'
import type { TimedItem } from '../../src/core/replay/schedule'
import { defaultReplay } from '../../src/core/replay/schema'
import { replayEnv, setReplayEnv } from '../../src/core/replay/text'

const svg = (markup: string) => new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + markup + '</svg>', 'image/svg+xml')
const run = (patch: Partial<TextRun> = {}): TextRun => ({
  x: 10, y: 20, w: 100, lines: ['a<& b','cd'], font: { size: 20, weight: 400, letterSpacing: 0 },
  color: '#111', lineHeight: 30, align: 'left', ...patch,
})
const item = (type: TimedItem['item']['type'], content = ''): TimedItem => ({
  item: { id: 'one', type, content }, index: 0, box: { x: 10,y: 20,w: 100,h: 80 },
  style: { color: '#111', fill: '', stroke: '', fontSize: 20, fontWeight: 400, align: 'left', lineHeight: 1.5, letterSpacing: 0, radius: 0 },
  preset: 'pop', action: 'none', tStart: 0, tEnd: 1,
})
const ctx = (): RenderCtx => ({
  doc: { ...defaultReplay(), textMode: 'svg-text' }, mode: { kind: 'once' }, sceneHeight: 400,
  idsAllowed: false, sid: 'scene', img: vi.fn((url: string) => url), warn: vi.fn(),
})
let previous: ReturnType<typeof replayEnv>
beforeEach(() => {
  previous = replayEnv()
  setReplayEnv({ measure: (text,f) => [...text].length * (f.weight === 700 ? 8 : 5), rasterize: null })
})
afterEach(() => setReplayEnv(previous))

it('rounds nonempty attributes, preserves numeric zero and escapes quoted markup', () => {
  expect(attrs({ empty: '', off: false, absent: undefined, unset: null, x: 0, y: 2.345, note: '"<&' })).toBe(' x="0" y="2.35" note="&quot;&lt;&amp;"')
  expect(el('circle',{r:5})).toBe('<circle r="5"/>')
})

it('transparently omits redundant groups but preserves specified animations and attributes', () => {
  const c = ctx(), inner = '<path d="M0 0"/>'
  const animation = { attr: 'opacity', keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }
  expect(group(c,{x:2},[animation],'')).toBe('')
  expect(group(c,{off: false,nothing: null,empty: ''},[null,false,undefined],inner)).toBe(inner)
  expect(group(c,{opacity: 0},[],inner)).toBe('<g opacity="0">'+inner+'</g>')
  const styled = svg(group(c,{opacity: 0},[false,animation],inner))
  expect(styled.querySelector('g > animate')?.getAttribute('attributeName')).toBe('opacity')
  expect(styled.querySelector('g > path')).not.toBeNull()
  expect(svg(shape('rect',{x:8}, c, [null,animation])).querySelector('rect > animate')).not.toBeNull()
  expect(shape('rect',{x:8},c,[null])).toBe('<rect x="8"/>')
})

it('splits overlapping line/mark boundaries and retains unmarked glyphs, color and text', () => {
  const text = run({ lines: ['ABCD','EF'], starts: [0,4], marks: [[1,5]], markColor:'#f00' })
  expect(lineSegments(text,0)).toEqual([{text:'A',color:'#111',weight:400},{text:'BCD',color:'#f00',weight:700}])
  expect(lineSegments(text,1,'#333')).toEqual([{text:'E',color:'#333',weight:700},{text:'F',color:'#333',weight:400}])
  expect(lineSegments({...text,lines:[...text.lines, 'Unmarked'],starts:[0,4,6]},2)).toEqual([{text:'Unmarked',color:'#111',weight:400}])
  expect(lineSegments(run({ marks: [[0,1]] }),0)).toEqual([{text:'a<& b',color:'#111',weight:400}])
})

it.each([['left',15],['center',56],['right',97]] as const)('measures actual marker geometry for %s alignment', (align,x) => {
  const text = run({ lines:['ABC'], starts:[0], marks:[[1,2]], align })
  const spans = markSpans(text)
  expect(spans).toEqual([{x,y:20,w:8,h:30,line:0}])
  expect(markerAttrs(spans[0],'#abc')).toMatchObject({x:x-2,y:36.5,width:12,height:9,fill:'#abc','fill-opacity':0.22})
  expect(markSpans({...text,font:{...text.font,weight:700}})).toEqual([])
  expect(markSpans({...text,marks:undefined})).toEqual([])
})

it.each([['left',10],['center',55],['right',100]] as const)('measures a line for %s without exceeding the run bounds', (align,x) => {
  expect(lineBox(run({lines:['AB'],align}),0)).toEqual({x,y:20,w:10,h:30})
  expect(lineBox(run({lines:['AB'],w:3,align}),0)).toEqual({x:10,y:20,w:3,h:30})
  expect(lineBox(run({align}),8).h).toBe(30)
})

it('uses glyph advances, alignment and mark-free path output, falling back when a glyph is missing', () => {
  const c = ctx()
  const text = run({ align:'right', lines:['甲 甲'], glyphs:{甲:{d:'M0 0L5 7',adv:500}} })
  const out = svg(drawRun(text,c).join(''))
  expect(out.querySelector('g')?.getAttribute('transform')).toBe('translate(10 42.2) scale(0.02)')
  const paths = [...out.querySelectorAll('path')]
  expect(paths.map(p=>p.getAttribute('d'))).toEqual(['M0 0L5 7','M0 0L5 7'])
  expect(paths.map(p=>p.getAttribute('transform'))).toEqual(['translate(3700 0)','translate(4500 0)'])
  expect(lineBox(text,0)).toEqual({x:84,y:20,w:26,h:30})
  expect(svg(drawRun(text,c,{lines:['甲外']}).join('')).querySelector('text')?.textContent).toBe('甲外')
})

it.each([['left','10',null],['center','60','middle'],['right','110','end']] as const)('emits escaped text and correct %s SVG anchor', (align,x,anchor) => {
  const text = run({align,starts:[0,6],marks:[[1,3]],markColor:'#f00',font:{size:20,weight:400,letterSpacing:2,family:'Fixture Serif'}})
  const c = ctx(), output = svg(drawRun(text,c).join('')), nodes=[...output.querySelectorAll('text')]
  expect(nodes.map(n=>n.textContent)).toEqual(text.lines)
  expect(nodes[0].getAttribute('x')).toBe(x)
  expect(nodes[0].getAttribute('text-anchor')).toBe(anchor)
  expect(nodes[0].getAttribute('font-family')).toBe('Fixture Serif')
  expect(nodes[0].getAttribute('letter-spacing')).toBe('2')
  expect(nodes[0].querySelector('tspan')?.getAttribute('fill')).toBe('#f00')
  expect(+nodes[1].getAttribute('y')! - +nodes[0].getAttribute('y')!).toBe(30)
  expect(svg(drawRun(text,c,{lines:['']}).join('')).querySelector('text')?.textContent).toBe(' ')
  expect(c.warn).not.toHaveBeenCalled()
})

it('maps generated raster URLs and passes exact whole/per-line bounds and mark segments', () => {
  const c=ctx(); c.doc.textMode='image'
  const raster = vi.fn(()=>'data:image/png;base64,AA')
  setReplayEnv({rasterize:raster})
  const text = run({lines:['ab','cd'],starts:[0,2],marks:[[2,3]],markColor:'#abc'})
  const whole=svg(drawRun(text,c).join('')).querySelector('image')!
  expect(whole.getAttribute('height')).toBe('60')
  expect(whole.getAttribute('href')).toBe('data:image/png;base64,AA')
  expect(raster).toHaveBeenLastCalledWith(expect.objectContaining({lines:['ab','cd'],width:100,height:60,segments:[[{text:'ab',color:'#111',weight:400}],[{text:'c',color:'#abc',weight:700},{text:'d',color:'#111',weight:400}]]}))
  const perLine = svg(drawRun(text,c,{perLine:true,color:'#369'}).join(''))
  expect([...perLine.querySelectorAll('image')].map(img=>[img.getAttribute('y'),img.getAttribute('height')])).toEqual([['20','30'],['50','30']])
  expect(raster).toHaveBeenLastCalledWith(expect.objectContaining({lines:['cd'],color:'#369',height:30}))
  expect(c.img).toHaveBeenCalledTimes(3)
  expect(c.warn).not.toHaveBeenCalled()
})

it('falls back to full SVG text with one warning if any raster line is unavailable', () => {
  const c=ctx(); c.doc.textMode='image'
  setReplayEnv({rasterize:vi.fn<() => string|null>().mockReturnValueOnce('data:image/png;base64,AA').mockReturnValueOnce(null)})
  const text = run({lines:['First','Second']})
  const out=svg(drawRun(text,c,{perLine:true}).join(''))
  expect([...out.querySelectorAll('text')].map(node=>node.textContent)).toEqual(text.lines)
  expect(out.querySelector('image')).toBeNull()
  expect(c.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('svg-text'))
})

it('caps frame radius, preserves stroke-only cards, and lets text overrides bypass highlights', () => {
  const c = ctx(), card = item('text')
  expect(frameRect(card)).toBe('')
  card.style.stroke='#123'; card.style.radius=999
  card.text=run({lines:['AB'],marks:[[0,1]],starts:[0]})
  const frame=svg(frameRect(card)).querySelector('rect')!
  expect([frame.getAttribute('rx'),frame.getAttribute('fill'),frame.getAttribute('stroke-width')]).toEqual(['40','none','2'])
  expect(svg(itemBody(card,c)).querySelector('rect[fill-opacity]')).not.toBeNull()
  expect(svg(itemBody(card,c,{color:'#987'})).querySelector('rect[fill-opacity]')).toBeNull()
  const override = svg(itemBody(card,c,{noFrame:true,textOverride:'<text>override</text>'}))
  expect(override.querySelector('rect')).toBeNull()
  expect(override.querySelector('text')?.textContent).toBe('override')
})

it('keeps image crop, source mapping and label below its custom photo viewport', () => {
  const c=ctx(), photo=item('image')
  photo.item.image={src:'/media/p.jpg?previous=1'}
  photo.style.stroke='#123'
  photo.label=run({y:92,lines:['Caption']})
  const d=svg(itemBody(photo,c)), image=d.querySelector('image')!, border=d.querySelector('rect')!
  expect(image.getAttribute('href')).toBe('/media/p.jpg?w=1500')
  expect(image.getAttribute('height')).toBe('60')
  expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice')
  expect(border.getAttribute('height')).toBe('60')
  expect(d.querySelector('text')?.textContent).toBe('Caption')
  photo.item.image={src:'https://example.test/p.jpg?format=original'}
  photo.style.stroke=''
  const remote=svg(itemBody(photo,c))
  expect(remote.querySelector('image')?.getAttribute('href')).toBe(photo.item.image.src)
  expect(remote.querySelector('rect')).toBeNull()
  delete photo.item.image; delete photo.label
  const fallback=svg(itemBody(photo,c))
  expect(fallback.querySelector('path')?.getAttribute('d')).toBe('M10 20L110 100M110 20L10 100')
  expect(fallback.querySelector('text')?.textContent).toBe('IMAGE  100 × 80')
})

it('renders quote rail and label, divider, and all three shape silhouettes with correct paint', () => {
  const c = ctx(), quote = item('quote')
  quote.label=run({lines:['Source']})
  expect(svg(itemBody(quote,c)).querySelector('rect')?.getAttribute('fill')).toBe(c.doc.theme.accent)
  quote.style.stroke='#abc'
  expect(svg(itemBody(quote,c)).querySelector('rect')?.getAttribute('fill')).toBe('#abc')
  expect(svg(itemBody(quote,c,{noFrame:true})).querySelector('text')?.textContent).toBe('Source')
  const divider=item('divider');divider.style.stroke='#123'
  expect(svg(itemBody(divider,c)).querySelector('rect')?.getAttribute('height')).toBe('2')
  expect(svg(itemBody(item('shape','circle'),c)).querySelector('circle')?.getAttribute('r')).toBe('40')
  expect(svg(itemBody(item('shape','ring'),c)).querySelector('circle')?.getAttribute('r')).toBe('37')
  const bar=item('shape','rect');bar.style.fill='#123';bar.style.radius=5
  const rendered=svg(itemBody(bar,c)).querySelector('rect')!
  expect([rendered.getAttribute('fill'),rendered.getAttribute('rx')]).toEqual(['#123','5'])
})

it('prefers element paint over scene paint and has no occluder for image backgrounds', () => {
  const c=ctx(), title=item('title')
  c.doc.canvas.background={type:'gradient',value:'#000000,#ffffff'}
  expect(coverColor(title,c,200)).toBe('#808080')
  c.doc.canvas.background={type:'image',value:'#000',image:{src:'/media/b.jpg'}}
  expect(coverColor(title,c,200)).toBeNull()
  title.style.fill='#abc'; expect(coverColor(title,c,200)).toBe('#abc')
})

it('keeps deterministic seeded drawing variation without returning a constant', () => {
  const next=rand(21), actual=Array.from({length:4},()=>next())
  const repeat=rand(21); expect(actual).toEqual(Array.from({length:4},()=>repeat()))
  expect(new Set(actual).size).toBe(4)
  expect(actual.every(value=>value>=0&&value<1)).toBe(true)
})

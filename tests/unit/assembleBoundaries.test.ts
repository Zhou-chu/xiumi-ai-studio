import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { assemble, autoPlace, fillModule, layoutsFor, photoCapacity, type Kit } from '../../src/core/assemble'
import { richToPlain } from '../../src/core/richtext'
import { createBlock } from '../../src/core/blocks'
import type { Block, ImageRef } from '../../src/core/types'
import type { Copy } from '../../src/core/copy'
import type { RoleId } from '../../src/core/roles'
const parse = (s: string) => new JSDOM(s).window.document
const photo: ImageRef = {src:'/media/test.jpg',width:1000,height:800}
const html = (s: string) => createBlock('html', {html:s})
const kit = (entries: Partial<Record<RoleId, Block>>): Kit => Object.fromEntries(Object.entries(entries).map(([role,block])=>[role,{role,block,from:'test'}]))
const copy = (patch: Partial<Copy> = {}): Copy => ({title:'标题',subtitle:'',items:[],credits:[],...patch})
const props = (b: Block, f: Parameters<typeof fillModule>[1] = {}) => fillModule(b,f).block.props as any

describe('assembly builtin module boundaries',()=>{
  it('fills and clears heading and cover fields without mutating templates',()=>{
    const b=createBlock('heading',{title:'old',subtitle:'old',index:'99'})
    expect(props(b)).toMatchObject({title:'',subtitle:'',index:'99'})
    expect(props(b,{titles:['新标题','副标题'],number:3})).toMatchObject({title:'新标题',subtitle:'副标题',index:'03'})
    expect(b.props.title).toBe('old')
    expect(props(createBlock('cover'),{titles:['封面'],photos:[photo]})).toMatchObject({title:'封面',subtitle:'',meta:'',image:photo})
    expect(props(createBlock('cover')).image).toBeUndefined()
  })
  it.each(['paragraph','card','imageText','box','quote'] as const)('fills and clears %s text',type=>{
    const b=createBlock(type)
    const full=props(b,{titles:['新标题'],body:['第一段','第二段'],notes:['来源'],photos:[photo]})
    const empty=props(b)
    if(type==='paragraph'||type==='card'||type==='imageText'){expect(richToPlain(full.content)).toContain('第一段');expect(richToPlain(empty.content)).toBe('')}
    if(type==='card'||type==='imageText')expect(empty.title).toBe('')
    if(type==='imageText')expect(full.image).toEqual(photo)
    if(type==='box'){expect(full.children).toHaveLength(1);expect(empty.children).toEqual([])}
    if(type==='quote'){expect(full).toMatchObject({text:'第一段',source:'来源'});expect(empty).toMatchObject({text:'',source:''})}
  })
  it.each(['image','frame','photos','carousel','gallery'] as const)('fills and clears %s photo slots',type=>{
    const b=type==='photos'?createBlock('photos',{count:2}):createBlock(type)
    const full=fillModule(b,{photos:[photo],captions:['图注'],groupCaption:'整组说明'})
    expect(full.placed).toBe(1);expect(fillModule(b,{}).placed).toBe(0)
    const p=full.block.props as any
    if(type==='image'||type==='frame')expect(p).toMatchObject({image:photo,caption:'图注'})
    if(type==='photos'){expect(p.pics).toEqual([{image:photo,caption:'图注'},{caption:''}])}
    if(type==='carousel')expect(p.pics).toEqual([{image:photo,caption:'图注'}])
    if(type==='gallery')expect(p).toMatchObject({images:[photo],caption:'整组说明'})
  })
  it('caps galleries/carousels and keeps ending defaults until credits exist',()=>{
    expect(fillModule(createBlock('carousel'),{photos:Array(40).fill(photo)}).placed).toBe(30)
    expect(fillModule(createBlock('gallery'),{photos:Array(12).fill(photo)}).placed).toBe(9)
    const b=createBlock('ending',{author:'original'})
    expect(props(b).author).toBe('original');expect(props(b,{credits:['文字：甲','摄影：乙']}).author).toBe('文字：甲\n摄影：乙')
    const decor=createBlock('divider');expect(fillModule(decor,{}).block.props).toEqual(decor.props)
  })
  it('reports each builtin capacity and rejects unusable photo layouts',()=>{
    for(const type of ['image','frame','imageText','cover'] as const)expect(photoCapacity(createBlock(type))).toBe(1)
    expect(photoCapacity(createBlock('paragraph'))).toBe(0)
    expect(photoCapacity(createBlock('photos',{count:4}))).toBe(4)
    expect(photoCapacity(createBlock('carousel'))).toBe(30);expect(photoCapacity(createBlock('gallery'))).toBe(9)
    expect(layoutsFor(kit({carousel:createBlock('image'),img2lr:createBlock('image')}),2)).toEqual([])
    expect(layoutsFor(kit({carousel:createBlock('carousel')}),2)).toEqual(['carousel'])
  })
})

describe('assembly flow fallbacks',()=>{
  it('handles empty copy and missing selected modules with honest warnings',()=>{
    const a=assemble(copy(),{},[],[]);expect(a.doc.digest).toBe('');expect(a.doc.blocks).toEqual([]);expect(a.warnings).toHaveLength(1)
    const b=assemble(copy({items:[{id:'a',kind:'heading',level:8,text:'小节'},{id:'b',kind:'quote',text:'引用',source:''},{id:'c',kind:'quote',text:'引用二',source:'作者'}],credits:['文字：甲']}),{},[photo],[])
    expect(b.doc.blocks.length).toBeGreaterThan(0);expect(b.warnings.length).toBeGreaterThan(3)
  })
  it('places overflow photos as singles, filters invalid indices, and appends unknown anchors',()=>{
    const k=kit({img2lr:createBlock('photos',{count:2}),img1:createBlock('frame')})
    const a=assemble(copy(),k,[photo,photo,photo],[{after:'missing',photos:[0,1,2,99],layout:'img2lr'},{after:'missing',photos:[99]}])
    expect(a.doc.blocks.map(b=>b.type)).toEqual(['photos','frame']);expect(a.warnings.some(s=>s.includes('1'))).toBe(true)
    const b=assemble(copy(),{},[photo,photo],[{after:'x',photos:[0,1]}]);expect(b.doc.blocks.map(b=>b.type)).toEqual(['image','image'])
    const c=assemble(copy(),{},[photo],[{after:'x',photos:[0],layout:'singles'}]);expect(c.doc.blocks).toHaveLength(1)
  })
  it('uses cover, intro container, quote and theme overrides',()=>{
    const a=assemble(copy({subtitle:'副标题',items:[{id:'p',kind:'para',text:'开篇'},{id:'h',kind:'heading',level:1,text:'章节'},{id:'q',kind:'quote',text:'引用',source:'作者'},{id:'q2',kind:'quote',text:'引用二',source:''},{id:'p2',kind:'para',text:'正文'}],credits:['文字：甲']}),kit({cover:createBlock('cover'),topDecor:createBlock('divider'),body:createBlock('paragraph'),container:createBlock('box'),h1:createBlock('heading'),quote:createBlock('quote'),ending:createBlock('ending')}),[photo],[{after:'cover',photos:[0]}],{theme:{themeId:'minimal-magazine',themeOverrides:{fontSize:18} as any}})
    expect(a.doc.cover).toEqual(photo);expect(a.doc.digest).toBe('副标题');expect(a.doc.blocks.map(b=>b.type)).toEqual(['divider','cover','box','heading','quote','quote','paragraph','ending'])
    expect(a.doc.themeOverrides).toEqual({fontSize:18})
  })
  it.each(['box','paragraph','html'] as const)('wraps nested paragraphs and photo pieces in %s containers',type=>{
    const container=type==='html'?html('<section style="border:1px solid #111"><p>这是一段足够长的原始正文，用来识别容器中可以替换的正文槽位。</p></section>'):createBlock(type)
    const a=assemble(copy({items:[{id:'a',kind:'para',text:'前言'},{id:'h',kind:'heading',level:1,text:'章节'},{id:'p',kind:'para',text:'正文'},{id:'h2',kind:'heading',level:1,text:'章节二'}]}),kit({container,h1:createBlock('heading'),divider:createBlock('divider')}),[photo],[{after:'p',photos:[0]}],{parse})
    expect(a.doc.blocks.length).toBeGreaterThan(2);expect(a.doc.blocks.some(b=>b.type==='divider')).toBe(true)
  })
  it('falls back from an HTML container with no body and serializes HTML child pieces',()=>{
    const a=assemble(copy({items:[{id:'p',kind:'para',text:'正文'}]}),kit({container:html('<p>标签</p>'),img1:html('<img src="https://example.com/photo.jpg" style="width:100%">')}),[photo],[{after:'p',photos:[0]}],{parse})
    expect(a.doc.blocks.length).toBeGreaterThan(0)
  })
  it('automatically distributes sections and respects busy anchors',()=>{
    const c=copy({items:[{id:'h',kind:'heading',level:1,text:'标题'},{id:'p',kind:'para',text:'一段'},{id:'p2',kind:'para',text:'二段'},{id:'h2',kind:'heading',level:1,text:'空章节'}]})
    expect(autoPlace(c,[])).toEqual([])
    expect(autoPlace(c,[[0],[1]])).toEqual([{after:'p',photos:[0]},{after:'h2',photos:[1]}])
    expect(autoPlace(c,[[0]],[{after:'p',photos:[1]}])[0].after).toBe('h2')
    expect(autoPlace(c,[[0]],[{after:'p',photos:[1]},{after:'h2',photos:[2]}])[0].after).toBe('p')
  })
})
describe('HTML assembly slot semantics',()=>{
  const render=(s:string,f:Parameters<typeof fillModule>[1])=>{
    const result=fillModule(html(s),f,{parse});return {text:parse((result.block.props as any).html).body.textContent,html:(result.block.props as any).html,placed:result.placed}
  }
  it('renumbers decorative English counters while preserving labels',()=>{
    const a=render('<p>SECTION 01 / 04</p><p style="font-size:22px"><strong>FIELD NOTES · 实地笔记</strong></p><p style="font-size:22px">第一章</p>',{number:3,total:8})
    expect(a.text).toContain('03 / 08');expect(a.text).toContain('FIELD NOTES')
    expect(render('<p>PART 01</p>',{number:2}).text).toContain('02')
    expect(render('<p>PART 01</p>',{}).text).toContain('01')
  })
  it('matches credits by synonyms and clears unprovided template personal data',()=>{
    const a=render('<p>文字：旧人 摄影：旧摄影 编辑：旧编辑</p><p>摄影</p><p>旧摄影姓名</p><p>欢迎关注</p><p>这是一段不应该保留的往期人物介绍。</p>',{credits:['文案：甲','图片：乙']})
    expect(a.text).toContain('甲');expect(a.text).toContain('乙');expect(a.text).not.toContain('旧人');expect(a.text).not.toContain('往期')
    const b=render('<p>审核</p><p>END</p>',{credits:[]});expect(b.text).toContain('审核')
  })
  it('fills first body once and clears unused body slots',()=>{
    const s='<p>这是一段足够长的正文内容，用于确定这不是一个标题而是正文。</p><p>这也是一段足够长的正文内容，不应该重复放入同一段正文文字。</p>'
    const a=render(s,{body:['替换第一段','替换第二段']});expect(a.text?.match(/替换第一段/g)).toHaveLength(1)
    expect(render(s,{}).text).toBe('')
  })
  it('combines captions for a group and respects image-specific captions',()=>{
    const img='<img src="https://mmbiz.qpic.cn/test/640" style="width:100%">'
    const one=render(img+img+'<p style="font-size:12px">▲图：原图注</p>',{photos:[photo,photo],captions:['第一张','第二张']})
    expect(one.text).toContain('第一张');expect(one.text).toContain('第二张');expect(one.placed).toBe(2)
    const two=render(img+'<p style="font-size:12px">▲图：原图注</p>'+img+'<p style="font-size:12px">原图注</p><p style="font-size:12px">整组说明</p>',{photos:[photo,photo],captions:['▲图：已有前缀','第二张'],groupCaption:'整组新说明'})
    expect(two.text).toContain('整组新说明');expect(two.text).toContain('已有前缀')
    expect(render(img+'<p style="font-size:12px">原图注</p>',{}).placed).toBe(0)
  })
  it('uses note captions before photos and retains source metadata',()=>{
    const b=createBlock('html',{html:'<p style="font-size:12px">说明标签</p><img src="https://mmbiz.qpic.cn/test/640">',source:{kind:'original',title:'source',url:'',account:''}})
    const a=fillModule(b,{notes:['新说明'],photos:[photo]},{parse});expect((a.block.props as any).source).toEqual(b.props.source)
    expect((a.block.props as any).html).toContain('新说明')
  })
})

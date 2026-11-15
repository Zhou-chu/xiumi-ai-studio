import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { applyOp, applyOps, describeOp, orderInsert, summarize, validateOp } from '../../src/core/ops'
import { textToRich } from '../../src/core/richtext'
import type { Block, Doc, DocOp } from '../../src/core/types'

const paragraph=(id:string,value=id)=>({...createBlock('paragraph',{content:textToRich(value)}),id})
const doc=(blocks:Block[]=[paragraph('a'),paragraph('b'),paragraph('c')]):Doc=>({
  id:'fixture',title:'原始标题',author:'作者',digest:'原摘要',themeId:'fixture-theme',blocks,
  createdAt:1,updatedAt:1,
})
type Insert=Extract<DocOp,{op:'insert'}>
const after=(id:string,anchor='a'):Insert=>({op:'insert',index:1,anchor:{id:anchor,side:'after'},block:paragraph(id)})
const before=(id:string,anchor='a'):Insert=>({op:'insert',index:0,anchor:{id:anchor,side:'before'},block:paragraph(id)})
const ids=(d:Doc)=>d.blocks.map(block=>block.id)

it('normalizes finite unanchored insertion positions and defaults a missing position to the end',()=>{
  const d=doc(), block={type:'paragraph',props:{content:'新段落'}}
  expect(validateOp(d,{op:'insert',index:-4,block}).op).toMatchObject({op:'insert',index:0})
  expect(validateOp(d,{op:'insert',index:'9',block}).op).toMatchObject({op:'insert',index:3})
  expect(validateOp(d,{op:'insert',block}).op).toMatchObject({op:'insert',index:3})
  expect(validateOp(d,{op:'insert',index:null,block}).op).toMatchObject({op:'insert',index:3})
  expect(validateOp(d,{op:'insert',index:1.5,block}).op).toMatchObject({op:'insert',index:1})
  expect(validateOp(d,{op:'insert',index:'2.75',block}).op).toMatchObject({op:'insert',index:2})
  for(const index of ['invalid',Infinity, NaN, true]) {
    expect(validateOp(d,{op:'insert',index,block})).toEqual({error:'插入位置必须是有限数字'})
  }
})

it('uses a unique current anchor and never falls back to numeric insertion on a bad anchor',()=>{
  const d=doc(), block={type:'paragraph',props:{content:'新段落'}}
  expect(validateOp(d,{op:'insert',index:99,block,anchor:{id:'b',side:'before'}}).op).toMatchObject({op:'insert',index:1,anchor:{id:'b',side:'before'}})
  expect(validateOp(d,{op:'insert',index:0,block,anchor:{id:'b',side:'after'}}).op).toMatchObject({op:'insert',index:2})
  for(const anchor of [null,{id:42,side:'before'},{id:'a',side:'beside'},{id:'missing',side:'after'}]) {
    expect(validateOp(d,{op:'insert',index:1,block,anchor}).error).toContain('位置或锚点无效')
  }
  const duplicate=doc([paragraph('a'),paragraph('a')])
  expect(validateOp(duplicate,{op:'insert',index:1,block,anchor:{id:'a',side:'after'}}).error).toContain('位置或锚点无效')
  expect(applyOp(duplicate,after('new'))).toBe(duplicate)
})

it('builds fresh IDs for inserted modules and children and rejects invalid imported insert trees',()=>{
  const d=doc()
  const nested={type:'paragraph',id:'a',props:{content:'新内容'}}
  const raw={type:'box',id:'b',props:{title:'新框',children:[nested]}}
  const valid=validateOp(d,{op:'insert',block:raw}).op
  expect(valid?.op).toBe('insert')
  if(valid?.op!=='insert'||valid.block.type!=='box')throw Error('Expected a new box insertion')
  expect(valid.block.id).not.toBe(raw.id)
  expect(valid.block.props.children[0].id).not.toBe(nested.id)
  expect(summarize(valid.block)).toBe('新框；新内容')
  for(const children of [null,'invalid',[raw],[{type:'html'}],[{type:'unknown'}]]) {
    expect(validateOp(d,{op:'insert',block:{...raw,props:{children}}}).error).toContain('类型无效')
  }
  for(const type of ['html','replay','unknown']) expect(validateOp(d,{op:'insert',block:{type}}).error).toContain('类型无效')
})

it('routes editable fields of nested blocks without allowing their container children to be replaced',()=>{
  const child=paragraph('child','原文')
  const container={...createBlock('box',{title:'初始框',children:[child]}),id:'outer'}
  const d=doc([container])
  const childChange=validateOp(d,{op:'update',id:'child',props:{content:'新文字'},reason:'精简'})
  expect(childChange.op).toMatchObject({op:'update',id:'child',props:{content:textToRich('新文字')},reason:'精简'})
  expect(validateOp(d,{op:'update',id:'outer',props:{children:[]}}).error).toContain('没有有效字段')
  expect(validateOp(d,{op:'update',id:'outer',props:null}).error).toContain('没有有效字段')
  expect(validateOp(d,{op:'update',id:'outer',props:{title:'改名',children:[]}}).op).toMatchObject({op:'update',props:{title:'改名'}})
  const changed=applyOp(d,childChange.op!)
  expect(summarize(changed.blocks[0])).toBe('初始框；新文字')
  expect(summarize(d.blocks[0])).toBe('初始框；原文')
  expect(validateOp(d,{op:'remove',id:'child'}).op).toMatchObject({op:'remove',id:'child'})
  expect((applyOp(d,{op:'remove',id:'child'}).blocks[0] as Block<'box'>).props.children).toEqual([])
})

it('changes captions without replacing the photo source or ordering',()=>{
  const photos={...createBlock('photos',{count:2,pics:[{image:{src:'/media/a.jpg'},caption:'原一'},{image:{src:'/media/b.jpg'},caption:'原二'}]}),id:'photos'}
  const d=doc([photos])
  const update=validateOp(d,{op:'update',id:'photos',props:{pics:[{image:{src:'/media/unrelated.jpg'},caption:'新一'}]}}).op
  expect(update?.op).toBe('update')
  expect(update).toMatchObject({props:{pics:[{image:{src:'/media/a.jpg'},caption:'新一'},{image:{src:'/media/b.jpg'},caption:'原二'}]}})
  expect(summarize(photos)).toContain('原一 / 原二')
})

it('rejects malformed operations and nonexistent or non-top-level move identities',()=>{
  const replay={...createBlock('replay'),id:'replay'}
  const d=doc([replay,{...createBlock('box',{children:[paragraph('child')]}),id:'box'}])
  expect(validateOp(d,null).error).toContain('不是对象')
  expect(validateOp(d,42).error).toContain('不是对象')
  expect(validateOp(d,{op:'unknown'}).error).toContain('未知操作')
  expect(validateOp(d,{op:'setTheme',themeId:23}).error).toContain('缺少 themeId')
  expect(validateOp(d,{op:'update',id:'replay',props:{title:'copy'}}).error).toContain('不支持 AI 修改')
  for(const op of ['remove','update','move']) expect(validateOp(d,{op,id:'missing'}).error).toContain('找不到模块')
  expect(validateOp(d,{op:'move',id:'child',to:0}).error).toContain('找不到模块')
  expect(validateOp(d,{op:'move',id:'box',to:'1'}).op).toMatchObject({to:1})
  expect(validateOp(d,{op:'move',id:'box',to:'2.75'}).op).toMatchObject({to:2})
  expect(validateOp(d,{op:'move',id:'box',to:-2.75}).op).toMatchObject({to:-2})
  expect(validateOp(d,{op:'move',id:'box'}).op).toMatchObject({to:0})
  for(const to of ['nan',Infinity, NaN, true]) {
    expect(validateOp(d,{op:'move',id:'box',to})).toEqual({error:'移动位置必须是有限数字'})
  }
})

it('keeps metadata fields not requested, resets overrides on theme change, and applies bounded top-level reorder',()=>{
  const start={...doc(),themeOverrides:{fontSize:23}}
  expect(applyOp(start,{op:'move',id:'missing',to:9})).toBe(start)
  expect(ids(applyOp(start,{op:'move',id:'a',to:99}))).toEqual(['b','c','a'])
  expect(ids(applyOp(start,{op:'move',id:'c',to:-99}))).toEqual(['c','a','b'])
  const theme:DocOp={op:'setTheme',themeId:'new-theme'}
  expect(validateOp(start,theme).op).toBe(theme)
  expect(applyOp(start,theme)).toMatchObject({themeId:'new-theme',themeOverrides:undefined,title:start.title})
  const meta:DocOp={op:'setMeta',title:'新标题',author:''}
  expect(validateOp(start,meta).op).toBe(meta)
  for(const fields of [{title:5},{digest:null},{author:false}]) {
    expect(validateOp(start,{op:'setMeta',...fields})).toEqual({error:'文章信息必须是文字'})
  }
  expect(applyOp(start,meta)).toMatchObject({title:'新标题',author:'',digest:start.digest})
  expect(start.themeOverrides).toEqual({fontSize:23})
})

it('places a proposal before its next adjacent accepted sibling or after its previous one',()=>{
  const one=after('one'),two=after('two'),three=after('three')
  const earlier=doc([paragraph('a'),one.block,paragraph('b'),paragraph('c')])
  expect(orderInsert(earlier,two,[one])).toMatchObject({anchor:{id:'one',side:'after'}})
  const later=doc([paragraph('a'),three.block,paragraph('b'),paragraph('c')])
  expect(orderInsert(later,two,[],[three])).toMatchObject({anchor:{id:'three',side:'before'}})
  const beforeA=before('one')
  expect(orderInsert(doc([beforeA.block,paragraph('a')]),before('two'),[beforeA])).toMatchObject({anchor:{id:'one',side:'after'}})
  expect(ids(applyOps(doc(),[one,two,three]))).toEqual(['a','one','two','three','b','c'])
})

it('does not follow a moved-out sibling or an unrelated anchor while ordering a proposal',()=>{
  const one=after('one'),two=after('two')
  const moved=doc([paragraph('a'),paragraph('b'),one.block])
  expect(orderInsert(moved,two,[one])).toBe(two)
  expect(orderInsert(moved,two,[after('other','b')])).toBe(two)
  expect(orderInsert(doc([paragraph('b')]),two,[one])).toBe(two)
  const unchanged:DocOp={op:'remove',id:'a'}
  expect(orderInsert(moved,unchanged,[one])).toBe(unchanged)
})

it('describes edits against the supplied snapshot rather than silently synthesizing a missing block',()=>{
  const d=doc([paragraph('a','原文')])
  expect(describeOp(d,{op:'insert',index:0,block:paragraph('b','新段')})).toEqual({title:'在第 1 位插入 paragraph',after:'新段'})
  expect(describeOp(d,{op:'update',id:'a',props:{content:textToRich('修改后')}})).toEqual({title:'修改 paragraph「原文」',before:'原文',after:'修改后'})
  expect(describeOp(d,{op:'update',id:'missing',props:{title:'不应合成'}})).toEqual({title:'修改 ',before:'',after:''})
  expect(describeOp(d,{op:'remove',id:'missing'})).toEqual({title:'删除 ',before:''})
  expect(describeOp(d,{op:'remove',id:'a'})).toEqual({title:'删除 paragraph「原文」',before:'原文'})
  expect(describeOp(d,{op:'move',id:'a',to:2})).toEqual({title:'移动 paragraph「原文」 到第 3 位'})
  expect(describeOp(d,{op:'setTheme',themeId:'theme'})).toEqual({title:'切换主题为 theme'})
  expect(describeOp(d,{op:'setMeta',title:'新标题',digest:'新摘要'})).toEqual({title:'修改文章信息',after:'新标题 / 新摘要'})
})

it('produces readable summaries from distinct block types and omits empty optional metadata',()=>{
  const listed=[
    [createBlock('card',{title:'小卡',content:textToRich('**正文**')}),'小卡：正文'],
    [createBlock('imageText',{title:'图文',content:textToRich('说明')}),'图文：说明'],
    [createBlock('gallery',{images:[{src:'/media/p.jpg'}],columns:2,caption:'画廊'}),'1 张图，2 列 画廊'],
    [createBlock('timeline',{items:[{time:'09:00',title:'开始',desc:'地点'}]}),'09:00 开始'],
    [createBlock('table',{headers:['甲','乙'],rows:[['一','二']]}),'甲 | 乙\n一 | 二'],
    [createBlock('image',{caption:'照片'}),'图片 照片'],
    [createBlock('divider',{variant:'dots'}),'分割 dots'],
    [createBlock('frame',{caption:'说明',label:'标签'}),'图片框 说明 · 标签'],
    [createBlock('html',{label:'片段',html:'<p>保留文字 <b>正文</b></p>'}),'片段：保留文字 正文'],
    [createBlock('quote',{text:'语录',source:'来源'}),'语录 · 来源'],
  ] as const
  for(const [block,output] of listed)expect(summarize(block)).toBe(output)
})

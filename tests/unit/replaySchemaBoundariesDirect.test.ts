import {expect,it} from 'vitest'
import {normalizeReplay,validateReplay} from '../../src/core/replay/schema'

it('preserves valid glyph paths and clamps advances while rejecting malformed faces and entries',()=>{
 const raw={glyphs:{'bad face':{'A':{d:'M0 0',adv:1}},invalid:[],empty:{AB:{d:'M0 0'}},regular:{
  'A':{d:'M0 0L1 2Z',adv:-1},'😀':{d:'M1 2',adv:4000},'B':{d:'',adv:'bad'},
  'CC':{d:'M0 0'},'D':null,'E':{d:8},'F':{d:'M'.repeat(20001)},'G':{d:'script(1)'},
 }}}
 const snapshot=structuredClone(raw)
 expect(normalizeReplay(raw).glyphs).toEqual({regular:{A:{d:'M0 0L1 2Z',adv:0},'😀':{d:'M1 2',adv:3000},B:{d:'',adv:1000}}})
 expect(raw).toEqual(snapshot)
})
it('omits unusable glyph dictionaries instead of persisting empty or arbitrary metadata',()=>{
 for(const glyphs of [null,[],{invalid:[]},{regular:{AB:{d:'M0 0'}}}])expect(normalizeReplay({glyphs}).glyphs).toBeUndefined()
})
it('limits glyph tables to four faces and two thousand single-character records',()=>{
 const table=Object.fromEntries(Array.from({length:2001},(_,i)=>[String.fromCodePoint(0x4e00+i),{d:'M0 0',adv:12}]))
 const result=normalizeReplay({glyphs:{a:table,b:{B:{d:'M0 0'}},c:{C:{d:'M0 0'}},d:{D:{d:'M0 0'}},e:{E:{d:'M0 0'}}}})
 expect(Object.keys(result.glyphs!)).toEqual(['a','b','c','d'])
 expect(Object.keys(result.glyphs!.a)).toHaveLength(2000)
 expect(result.glyphs!.a[String.fromCodePoint(0x4e00+2000)]).toBeUndefined()
})
it('normalizes optional item styles without accepting arbitrary CSS face names or invalid numeric fields',()=>{
 const result=normalizeReplay({scenes:[{items:[{type:'text',style:{color:'bad',fill:'',stroke:'',fontWeight:800,align:'center',lineHeight:'',letterSpacing:-9,radius:999,face:'bad face'},frame:{x:'',y:0,w:1,h:''},cursor:{action:'bad',who:NaN}},{type:'text',style:{fontWeight:200,face:'Valid-Face_2'}}]}]})
 expect(result.scenes[0].items[0]).toMatchObject({style:{color:'#ffffff',fill:'',stroke:'',fontWeight:700,align:'center',lineHeight:1.6,letterSpacing:-2,radius:200},frame:{x:0,y:0,w:1,h:100},cursor:{who:0}})
 expect(result.scenes[0].items[0].style).not.toHaveProperty('face');expect(result.scenes[0].items[0].cursor).not.toHaveProperty('action')
 expect(result.scenes[0].items[1].style).toEqual({fontWeight:400,face:'Valid-Face_2'})
})
it('drops invalid scene/item shapes and keeps explicit zero-height metadata bounded',()=>{
 const result=normalizeReplay({scenes:[null, {items:'bad'}, {height:'',items:[null,{}, {type:'unknown'}, {type:'image',image:{src:'',width:0}}]}, {height:0,items:[]}]})
 expect(result.scenes.map(s=>s.items.length)).toEqual([0,0,1,0])
 expect(result.scenes[0]).toMatchObject({layout:'flow',finale:'exit'})
 expect(result.scenes[2]).not.toHaveProperty('height');expect(result.scenes[2].items[0]).not.toHaveProperty('image')
 expect(result.scenes[3].height).toBe(200)
})
it('reports invalid scenes and absolute placements without inventing issues for valid items',()=>{
 expect(validateReplay(null)).toEqual(['数据不是对象，已使用默认模板'])
 expect(validateReplay({scenes:'wrong',playback:{pace:'invalid'}})).toEqual(['没有场景，已补一个默认场景','节奏无效，已改为 fast'])
 expect(validateReplay({scenes:[null,{layout:'absolute',items:'not-array'},{layout:'absolute',items:[{type:'text'},null,{type:'text',frame:{},enter:'bad'}]}]})).toEqual([
  '第 1 个场景格式错误','场景 3 第 2 个元素类型无效，已移除','场景 3 第 3 个元素的进场预设无效，已改为默认','场景 3 第 1 个元素缺少位置，按自动排版放置',
 ])
 expect(validateReplay({scenes:[{items:[{type:'text',enter:'pop'}]}],playback:{pace:'normal'}})).toEqual([])
})

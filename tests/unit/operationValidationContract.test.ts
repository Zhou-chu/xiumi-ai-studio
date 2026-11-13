// @vitest-environment jsdom
import {expect,it} from 'vitest'
import {applyOp,validateOp} from '../../src/core/ops'
import {createBlock,isBlockType,normalizeBlocks,coerceProps} from '../../src/core/blocks'
import type {Doc} from '../../src/core/types'
import {previewProposal} from '../../src/editor/proposalSafety'
const doc=():Doc=>({id:'validation-contract',title:'Title',author:'Author',digest:'Summary',themeId:'minimal-magazine',createdAt:1,updatedAt:1,blocks:[{...createBlock('heading'),id:'a'},{...createBlock('heading'),id:'b'}]})
it.each([NaN,Infinity,-Infinity,'not-a-position'])('rejects non-finite insertion index %s instead of inconsistent placement',index=>{
 expect(validateOp(doc(),{op:'insert',index,block:{type:'divider',props:{}}}).error).toBeTruthy()
})
it.each([NaN,Infinity,-Infinity,'not-a-position'])('rejects non-finite move target %s',to=>{
 expect(validateOp(doc(),{op:'move',id:'a',to}).error).toBeTruthy()
})
it('normalizes fractional insert positions before preview anchoring',()=>{
 const before=doc(),result=validateOp(before,{op:'insert',index:1.8,block:{type:'divider',props:{}}})
 expect(result.error).toBeUndefined();expect(result.op).toMatchObject({index:1})
 const proposal={base:before,summary:'Insert',errors:[],items:[{op:result.op!,status:'pending' as const}]}
 expect(previewProposal(proposal,before).blocks.map(b=>b.id)).toEqual(applyOp(before,result.op!).blocks.map(b=>b.id))
 expect(previewProposal(proposal,before).blocks.at(-1)?.id).toBe('b')
})
it.each([{text:'nested reason'},['reason'],12,true,null])('rejects non-text reasons before they reach React %j',reason=>{
 expect(validateOp(doc(),{op:'setMeta',title:'Safe',reason}).error).toBeTruthy()
})
it.each(['title','author','digest'])('rejects malformed metadata field %s without modifying draft',key=>{
 const before=doc(),snapshot=structuredClone(before)
 for(const value of [{html:'bad'},['array'],42,null])expect(validateOp(before,{op:'setMeta',[key]:value}).error).toBeTruthy()
 expect(before).toEqual(snapshot)
})
it('preserves supported default positions and empty text metadata',()=>{
 expect(validateOp(doc(),{op:'insert',block:{type:'divider',props:{}}}).op).toMatchObject({index:2})
 expect(validateOp(doc(),{op:'move',id:'a'}).op).toMatchObject({to:0})
 expect(validateOp(doc(),{op:'setMeta',title:'',reason:''}).op).toMatchObject({title:'',reason:''})
})

it.each(['constructor','toString','__proto__'])('rejects inherited block type %s',type=>{
 expect(isBlockType(type)).toBe(false)
 expect(validateOp(doc(),{op:'insert',block:{type,props:{}}}).error).toBeTruthy()
 expect(normalizeBlocks([{id:'bad',type,props:{}}])).toEqual([])
})
it.each([
 {op:{toString:null}},
 {op:'unknown'},
 {op:'update',id:{toString:null}},
 {op:'remove',id:{toString:null}},
 {op:'move',id:{toString:null}},
 {op:'insert',block:{type:{toString:null}}},
 {op:'insert',block:{type:['heading']}},
])('rejects malformed operation identity without unsafe coercion: %j',raw=>{
 const before=doc(),snapshot=structuredClone(before)
 expect(()=>validateOp(before,raw)).not.toThrow()
 expect(validateOp(before,raw).error).toBeTruthy()
 expect(before).toEqual(snapshot)
})
it('coerces only finite primitive numeric props, never invokes JSON object conversion',()=>{
 const hostile={toString:null}
 expect(coerceProps('gallery',{columns:hostile},true)).toMatchObject({columns:2})
 expect(coerceProps('photos',{count:hostile},true)).toMatchObject({count:2})
 const image=coerceProps('image',{image:{src:'/media/a.png',width:hostile,height:hostile}},true)
 expect(image).toEqual({image:{src:'/media/a.png'}})
 for(const value of [Infinity,-Infinity,NaN,'Infinity',hostile,[],true]){
  expect(coerceProps('gallery',{columns:value},true)).toMatchObject({columns:2})
  expect(coerceProps('photos',{count:value},true)).toMatchObject({count:2})
  expect(coerceProps('image',{image:{src:'/media/a.png',width:value,height:value}},true)).toEqual({image:{src:'/media/a.png'}})
 }
 const before={...doc(),blocks:[{...createBlock('gallery'),id:'g'}]},snapshot=structuredClone(before)
 expect(validateOp(before,{op:'update',id:'g',props:{columns:hostile}}).op).toMatchObject({props:{columns:2}})
 expect(before).toEqual(snapshot)
})
it('retains finite numeric string coercion and bounded native values',()=>{
 expect(coerceProps('gallery',{columns:'3'},true)).toMatchObject({columns:3})
 expect(coerceProps('photos',{count:'4'},true)).toMatchObject({count:4})
 expect(coerceProps('image',{image:{src:'/media/a.png',width:'640',height:480}},true)).toEqual({image:{src:'/media/a.png',width:640,height:480}})
 expect(coerceProps('gallery',{columns:99},true)).toMatchObject({columns:3})
 expect(coerceProps('photos',{count:99},true)).toMatchObject({count:4})
})

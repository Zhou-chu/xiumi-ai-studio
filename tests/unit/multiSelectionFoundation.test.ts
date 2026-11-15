// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { applyOps } from '../../src/core/ops'
import { createBlock } from '../../src/core/blocks'
import { emptyDoc, useStore } from '../../src/editor/store'
vi.mock('../../src/editor/api',()=>({api:{saveProject:vi.fn(async(d)=>d)}}))
const p=(id:string)=>({...createBlock('paragraph'),id})
const doc=()=>({...emptyDoc(),blocks:[{...createBlock('box'),id:'box',props:{...createBlock('box').props,children:[p('child')]}},p('b'),p('c')]})
const state=()=>useStore.getState()
beforeEach(()=>state().load(doc()))

it('toggle keeps primary inside selected set and ordinary selection collapses it',()=>{
 state().select('box');(state().select as any)('b',{toggle:true});expect((state() as any).selectedIds).toEqual(['box','b']);expect(state().selectedId).toBe('b')
 ;(state().select as any)('b',{toggle:true});expect(state().selectedId).toBe('box');state().select('c');expect((state() as any).selectedIds).toEqual(['c']);state().select(null);expect((state() as any).selectedIds).toEqual([])
})
it('parent-child batch removal commits once and undo/redo never revives review',()=>{
 state().select('box');(state().select as any)('child',{toggle:true});(state().select as any)('b',{toggle:true})
 state().propose('old',[{op:'update',id:'c',props:{content:'old'}}]);const n=state().past.length
 ;(state() as any).removeSelected();expect(state().doc.blocks.map(b=>b.id)).toEqual(['c']);expect(state().past).toHaveLength(n+1);expect((state() as any).selectedIds).toEqual([])
 state().undo();expect(state().doc.blocks.map(b=>b.id)).toEqual(['box','b','c']);expect(state().proposal).toBeNull();state().redo();expect(state().doc.blocks.map(b=>b.id)).toEqual(['c']);expect(state().proposal).toBeNull()
})
it('single edit and picking narrow a multi selection; deletion clears invalid descendants',()=>{
 state().select('box');(state().select as any)('b',{toggle:true});state().setEditing('b');expect((state() as any).selectedIds).toEqual(['b'])
 state().select('child');(state().select as any)('c',{toggle:true});state().removeBlock('box');expect((state() as any).selectedIds).toEqual(['c']);state().setPicking('c');expect((state() as any).selectedIds).toEqual(['c'])
})
it('multi proposal filtering still permits remove and stable sibling inserts accepted in reverse',()=>{
 const ops=[{op:'insert',index:1,block:p('one')},{op:'insert',index:1,block:p('two')},{op:'remove',id:'b'}]
 state().propose('multi',ops,['box','b'] as any,{policy:'filter'});expect(state().proposal!.items).toHaveLength(3)
 const preview=applyOps(state().doc,state().proposal!.items.map(i=>i.op));state().resolveProposal(1,'accepted');state().resolveProposal(0,'accepted');state().resolveProposal(2,'accepted');expect(state().doc.blocks.map(b=>b.type)).toEqual(preview.blocks.map(b=>b.type))
 expect(state().proposal!.items.every(i=>i.status==='accepted')).toBe(true)
})
it('selection entry rejects duplicate identities and document switch clears every UI reference',()=>{
 const d=doc();d.blocks.push(p('b'));state().load(d);state().select('b');expect(state().selectedId).toBeNull()
 state().select('child');state().select('c',{toggle:true});state().load({...doc(),id:'new'});expect(state().selectedIds).toEqual([]);expect(state().selectedId).toBeNull()
})
it('insert, duplicate and replacement all establish coherent single selection; stale replay update remains rejected',()=>{
 state().select('box');state().select('b',{toggle:true});const id=state().insertBlock('paragraph');expect(state().selectedIds).toEqual([id])
 state().duplicateBlock('b');expect(state().selectedIds).toEqual([state().selectedId]);state().replaceBlock('b',[p('replaced')]);expect(state().selectedIds).toEqual(['replaced'])
 const replay={...createBlock('replay'),id:'replay'};state().load({...doc(),blocks:[replay,p('b')]});state().propose('invalid replay',[{op:'update',id:'replay',props:{title:'x'}}],['replay','b'],{policy:'filter'});expect(state().proposal!.items).toEqual([])
})
it('multi anchored insertion follows a moved root but refuses a deleted anchor without disturbing other accepted items',()=>{
 state().propose('inserts',[{op:'insert',index:0,block:p('one')},{op:'insert',index:3,block:p('two')}],['box','c'],{policy:'filter'})
 state().moveBlock('box',2);state().resolveProposal(0,'accepted');const firstId=(state().proposal!.items[0].op as any).block.id;expect(state().doc.blocks.findIndex(b=>b.id===firstId)+1).toBe(state().doc.blocks.findIndex(b=>b.id==='box'))
 state().removeBlock('c');state().resolveProposal(1,'accepted');expect(state().proposal!.items.map(i=>i.status)).toEqual(['accepted','rejected'])
})
it('single removeSelected retains existing neighbor selection behavior',()=>{
 state().select('b');state().removeSelected();expect(state().selectedId).toBe('c');expect(state().selectedIds).toEqual(['c'])
})
it('bulk insertion and moving retain valid multi selection while every structural commit prunes removed ids',()=>{
 state().select('child');state().select('b',{toggle:true});state().insertBlocks([p('inserted')]);expect(state().selectedIds).toEqual(['child','b']);expect(state().selectedId).toBe('b')
 state().moveBlockTo('b','box',0);expect(state().selectedIds).toEqual(['child','b']);state().moveBlock('b',1);expect(state().selectedIds).toEqual(['child','b'])
 state().commit({...state().doc,blocks:state().doc.blocks.filter(b=>b.id!=='box')});expect(state().selectedIds).toEqual([]);expect(state().selectedId).toBeNull()
})

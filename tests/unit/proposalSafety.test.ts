// @vitest-environment jsdom
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { useStore,emptyDoc } from '../../src/editor/store'
import { previewProposal } from '../../src/editor/proposalSafety'
import { createBlock } from '../../src/core/blocks'
const state=()=>useStore.getState()
beforeEach(()=>{vi.useFakeTimers();state().load({...emptyDoc(),blocks:[{...createBlock('heading'),id:'h',props:{index:'01',title:'Original',subtitle:'Sub',variant:'auto'}}]})})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})
it('single insert is idempotent and invalid indices are no-ops',()=>{
 state().propose('insert',[{op:'insert',index:1,block:{type:'heading',props:{title:'New'}}}])
 state().resolveProposal(0,'accepted');const doc=state().doc
 state().resolveProposal(0,'accepted');state().resolveProposal(-1,'accepted');state().resolveProposal(99,'rejected')
 expect(state().doc).toBe(doc);expect(doc.blocks).toHaveLength(2)
})
it('rejecting an already accepted update is a no-op',()=>{
 state().propose('edit',[{op:'update',id:'h',props:{title:'AI'}}]);state().resolveProposal(0,'accepted');state().resolveProposal(0,'rejected')
 expect(state().proposal!.items[0].status).toBe('accepted')
})
it('does not overwrite manually changed target fields',()=>{
 state().propose('edit',[{op:'update',id:'h',props:{title:'AI'}}]);state().updateProps('h',{title:'Manual'});state().resolveProposal(0,'accepted')
 expect(state().doc.blocks[0].props).toMatchObject({title:'Manual'});expect(state().proposal!.items[0].status).toBe('stale')
})
it('preserves independent field edits',()=>{
 state().propose('edit',[{op:'update',id:'h',props:{title:'AI'}}]);state().updateProps('h',{subtitle:'Manual'});state().resolveProposal(0,'accepted')
 expect(state().doc.blocks[0].props).toMatchObject({title:'AI',subtitle:'Manual'})
})
it('batch acceptance is one commit and conflicts do not silently overwrite',()=>{
 state().propose('edit',[{op:'update',id:'h',props:{title:'First'}},{op:'update',id:'h',props:{title:'Second'}},{op:'update',id:'h',props:{subtitle:'AI sub'}}])
 state().resolveProposal('all','accepted');expect(state().past).toHaveLength(1)
 expect(state().doc.blocks[0].props).toMatchObject({title:'First',subtitle:'AI sub'});expect(state().proposal!.items[1].status).toBe('stale')
})
it('undo closes review and restores document; redo cannot revive stale review',()=>{
 state().propose('edit',[{op:'update',id:'h',props:{title:'AI'}}]);state().resolveProposal(0,'accepted');state().undo()
 expect(state().proposal).toBeNull();expect(state().toast?.text).toContain('审阅');state().redo();expect(state().proposal).toBeNull()
})
it('rejects obsolete proposal handler tokens',()=>{
 state().propose('one',[{op:'update',id:'h',props:{title:'one'}}]);const old=state().proposal!
 state().propose('two',[{op:'update',id:'h',props:{title:'two'}}]);state().resolveProposal(0,'accepted',old)
 expect(state().doc.blocks[0].props).toMatchObject({title:'Original'})
})
it('HTML structure changes cannot retarget old slot IDs',()=>{
 state().load({...emptyDoc(),blocks:[{id:'html',type:'html',props:{label:'HTML',html:'<p>One</p><p>Two</p>'}}]})
 state().propose('slot',[{op:'update',id:'html',slots:{t1:'AI two'}}]);state().updateProps('html',{html:'<p>Added</p><p>One</p><p>Two</p>'});state().resolveProposal(0,'accepted')
 expect(state().proposal!.items[0].status).toBe('stale');expect(state().doc.blocks[0].props).toMatchObject({html:'<p>Added</p><p>One</p><p>Two</p>'})
})
it('independent HTML slots merge against current content',()=>{
 state().load({...emptyDoc(),blocks:[{id:'html',type:'html',props:{label:'HTML',html:'<p>One</p><p>Two</p>'}}]})
 state().propose('slot',[{op:'update',id:'html',slots:{t1:'AI two'}}]);state().updateProps('html',{html:'<p>Manual one</p><p>Two</p>'});state().resolveProposal(0,'accepted')
 expect(state().doc.blocks[0].props).toMatchObject({html:'<p>Manual one</p><p>AI two</p>'})
})

it('merges independent caption leaves without overwriting another caption',()=>{
 const block=createBlock('photos');block.id='photos';block.props.pics=[{caption:'A'},{caption:'B'}]
 state().load({...emptyDoc(),blocks:[block]})
 state().propose('captions',[{op:'update',id:'photos',props:{pics:[{caption:'AI A'},{caption:'B'}]}}])
 state().updateProps('photos',{pics:[{caption:'A'},{caption:'Manual B'}]});state().resolveProposal(0,'accepted')
 expect((state().doc.blocks[0].props as any).pics.map((p:any)=>p.caption)).toEqual(['AI A','Manual B'])
})
it('multiple insertions retain stable identities and one undo transaction',()=>{
 state().propose('insert',[{op:'insert',index:1,block:{type:'heading',props:{title:'A'}}},{op:'insert',index:1,block:{type:'heading',props:{title:'B'}}}])
 const ids=state().proposal!.items.map(i=>(i.op as any).block.id)
 state().resolveProposal('all','accepted');expect(state().doc.blocks.slice(1).map(b=>b.id)).toEqual(ids)
 expect(state().past).toHaveLength(1)
})
it('manual structural changes invalidate positional insertion',()=>{
 state().propose('insert',[{op:'insert',index:1,block:{type:'heading',props:{title:'AI'}}}]);state().insertBlock('paragraph');state().resolveProposal(0,'accepted')
 expect(state().proposal!.items[0].status).toBe('stale');expect(state().doc.blocks).toHaveLength(2)
})
it('deleted targets and changed metadata become stale without changing document',()=>{
 state().propose('mixed',[{op:'update',id:'h',props:{title:'AI'}},{op:'setMeta',title:'AI title'}])
 state().removeBlock('h');state().setDocFields({title:'Manual title'});const doc=state().doc;state().resolveProposal('all','accepted')
 expect(state().doc).toBe(doc);expect(state().proposal!.items.map(i=>i.status)).toEqual(['stale','stale'])
})

it('missing or null ancestors of new leaves are stale rather than throwing',()=>{
 for(const replacement of [null,undefined]) {
  state().load({...emptyDoc(),blocks:[{...createBlock('heading'),id:'h'}]})
  const base=state().doc; (base.blocks[0].props as any).nested={existing:'keep'}
  state().propose('nested',[])
  const proposal=state().proposal!;proposal.items=[{status:'pending',op:{op:'update',id:'h',props:{nested:{existing:'keep',added:'AI'}}}}]
  state().updateProps('h',{nested:replacement});const doc=state().doc
  expect(()=>state().resolveProposal(0,'accepted')).not.toThrow()
  expect(state().doc).toBe(doc);expect(state().proposal!.items[0].status).toBe('stale')
 }
})
it('photo identity changes with unchanged caption cannot redirect a suggestion',()=>{
 const block=createBlock('photos');block.id='photos';block.props.pics=[{caption:'Same',image:{src:'a'} as any},{caption:'Same',image:{src:'b'} as any}]
 state().load({...emptyDoc(),blocks:[block]});state().propose('caption',[{op:'update',id:'photos',props:{pics:[{caption:'AI'},{caption:'Same'}]}}])
 state().updateProps('photos',{pics:[...block.props.pics].reverse()});state().resolveProposal(0,'accepted')
 expect(state().proposal!.items[0].status).toBe('stale')
})

it('safe preview matches batch acceptance while preserving manual fields and slots',()=>{
 const block=createBlock('photos');block.id='photos';block.props.pics=[{caption:'A'},{caption:'B'}]
 state().load({...emptyDoc(),blocks:[block,{id:'html',type:'html',props:{label:'HTML',html:'<p>One</p><p>Two</p>'}}]})
 state().propose('preview',[{op:'update',id:'photos',props:{pics:[{caption:'AI'},{caption:'B'}]}},{op:'update',id:'html',slots:{t1:'AI two'}},{op:'update',id:'html',slots:{t1:'conflict'}}])
 state().updateProps('photos',{pics:[{caption:'A'},{caption:'Manual B'}]});state().updateProps('html',{html:'<p>Manual one</p><p>Two</p>'})
 const proposal=state().proposal!,doc=state().doc,preview=previewProposal(proposal,doc)
 expect(state().proposal).toBe(proposal);expect(state().doc).toBe(doc);expect(proposal.items.every(i=>i.status==='pending')).toBe(true)
 expect((preview.blocks[0].props as any).pics[1].caption).toBe('Manual B')
 expect((preview.blocks[1].props as any).html).toBe('<p>Manual one</p><p>AI two</p>')
 state().resolveProposal('all','accepted')
 expect({...state().doc,updatedAt:0}).toEqual({...preview,updatedAt:0})
})

it('array length changes cannot reuse positional caption targets',()=>{
 const block=createBlock('photos');block.id='photos';block.props.pics=[{caption:'A'},{caption:'B'}]
 state().load({...emptyDoc(),blocks:[block]});state().propose('caption',[{op:'update',id:'photos',props:{pics:[{caption:'AI'},{caption:'B'}]}}])
 state().updateProps('photos',{pics:[{caption:'A'},{caption:'B'},{caption:'New'}]});const doc=state().doc
 expect(previewProposal(state().proposal!,doc)).toBe(doc)
 state().resolveProposal(0,'accepted');expect(state().doc).toBe(doc);expect(state().proposal!.items[0].status).toBe('stale')
})
it('preview inserts use stable identities and match one batch transaction',()=>{
 state().propose('insert',[{op:'insert',index:0,block:{type:'heading',props:{title:'A'}}},{op:'insert',index:1,block:{type:'heading',props:{title:'B'}}}])
 const proposal=state().proposal!,preview=previewProposal(proposal,state().doc)
 expect(proposal.items.every(i=>i.status==='pending')).toBe(true)
 state().resolveProposal('all','accepted')
 expect({...state().doc,updatedAt:0}).toEqual({...preview,updatedAt:0})
})

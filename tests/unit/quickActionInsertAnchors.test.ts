// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { QUICK_ACTIONS } from '../../src/core/quickActions'
import { createBlock } from '../../src/core/blocks'
import { textToRich, richToPlain } from '../../src/core/richtext'
import { previewProposal } from '../../src/editor/proposalSafety'
import { useStore, emptyDoc } from '../../src/editor/store'
import { EDIT_SYSTEM } from '../../server/ai'
const state=()=>useStore.getState()
beforeEach(()=>vi.useFakeTimers())
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})
for(const mode of ['all','forward','reverse'] as const) {
 it(`chapter insertions keep base anchors in preview and ${mode} acceptance`,()=>{
  const blocks=['h1','p1','h2','p2','h3','p3'].map(id=>({...createBlock(id.startsWith('h')?'heading':'paragraph'),id}))
  state().load({...emptyDoc(),blocks});const original=state().doc
  const action=QUICK_ACTIONS.find(a=>a.id==='section-dividers')!.run(original)
  state().propose(action.summary,action.ops)
  const order=(doc:typeof original)=>doc.blocks.map(b=>b.type==='divider'?'divider':b.id)
  const expected=['h1','p1','divider','h2','p2','divider','h3','p3']
  expect(order(previewProposal(state().proposal!,original))).toEqual(expected)
  if(mode==='all')state().resolveProposal('all','accepted')
  else for(const i of mode==='reverse'?[1,0]:[0,1])state().resolveProposal(i,'accepted')
  expect(order(state().doc)).toEqual(expected)
  while(state().past.length)state().undo()
  expect(state().doc.blocks).toEqual(original.blocks)
 })
 it(`split paragraphs preserve complete reading order with ${mode} acceptance and undo`,()=>{
  const text=['A','B','C'].map(x=>x.repeat(110)+'。'+x.toLowerCase().repeat(110)+'。')
  const blocks=text.map((content,i)=>({...createBlock('paragraph',{content:textToRich(content)}),id:`p${i}`}))
  state().load({...emptyDoc(),blocks});const original=state().doc
  const action=QUICK_ACTIONS.find(a=>a.id==='split-long')!.run(original)
  state().propose(action.summary,action.ops)
  const contents=(doc:typeof original)=>doc.blocks.map(b=>b.type==='paragraph'?richToPlain(b.props.content):'').join('')
  expect(contents(previewProposal(state().proposal!,original))).toBe(text.join(''))
  if(mode==='all')state().resolveProposal('all','accepted')
  else for(const i of mode==='reverse'?[5,4,3,2,1,0]:[0,1,2,3,4,5])state().resolveProposal(i,'accepted')
  expect(state().doc.blocks).toHaveLength(6)
  expect(contents(state().doc)).toBe(text.join(''))
  while(state().past.length)state().undo()
  expect(state().doc.blocks).toEqual(original.blocks)
 })
}
it('AI instructions define original-document insertion coordinates',()=>{
 expect(EDIT_SYSTEM).toContain('insert.index')
 expect(EDIT_SYSTEM).toContain('不得累加')
})

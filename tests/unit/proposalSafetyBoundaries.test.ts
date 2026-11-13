// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {useStore,emptyDoc,type Proposal} from '../../src/editor/store'
import {getProposalItemIssue,previewProposal,rebaseProposalOp} from '../../src/editor/proposalSafety'
import {createBlock} from '../../src/core/blocks'
import type {DocOp} from '../../src/core/types'
const s=()=>useStore.getState()
const proposal=(ops:DocOp[]):Proposal=>({base:s().doc,summary:'Review',errors:[],items:ops.map(op=>({op,status:'pending'}))})
beforeEach(()=>{vi.useFakeTimers();s().load({...emptyDoc(),blocks:[{...createBlock('heading'),id:'h'},{...createBlock('paragraph'),id:'p'}]})})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})
it('invalid indexes, resolved items and document switches return explicit issues',()=>{
 const p=proposal([{op:'remove',id:'h'}]);expect(getProposalItemIssue(p,s().doc,-1)).toBeTruthy();expect(getProposalItemIssue(p,s().doc,0.1)).toBeTruthy();p.items[0].status='rejected';expect(getProposalItemIssue(p,s().doc,0)).toBeTruthy();p.items[0].error='Already handled';expect(getProposalItemIssue(p,s().doc,0)).toBe('Already handled');expect(previewProposal(p,s().doc)).toBe(s().doc);p.items[0].status='pending';expect(getProposalItemIssue(p,{...s().doc,id:'other'},0)).toBeTruthy()
})
it('remove/move guard changed blocks and positional order while preserving safe preview',()=>{
 const p=proposal([{op:'remove',id:'h'},{op:'move',id:'p',to:0}]);s().updateProps('h',{title:'Manual'});expect(getProposalItemIssue(p,s().doc,0)).toBeTruthy();expect(getProposalItemIssue(p,s().doc,1)).toBeNull();s().moveBlock('p',0);expect(getProposalItemIssue(p,s().doc,1)).toBeTruthy()
 s().load(p.base);const safe=previewProposal(proposal([{op:'remove',id:'h'}]),s().doc);expect(safe.blocks.map(b=>b.id)).toEqual(['p'])
})
it('theme/metadata changes stale only affected operations; malformed validated ops never mutate preview or store',()=>{
 const p=proposal([{op:'setTheme',themeId:'minimal-magazine'},{op:'setMeta',author:'AI'}]);s().setDocFields({themeId:'changed',author:'Manual'});expect(getProposalItemIssue(p,s().doc,0)).toBeTruthy();expect(getProposalItemIssue(p,s().doc,1)).toBeTruthy()
 const malformed=proposal([{op:'update',id:'h',props:{unknown:'bad'}}]);const doc=s().doc;expect(previewProposal(malformed,doc)).toBe(doc);useStore.setState({proposal:malformed});s().resolveProposal(0,'accepted');expect(s().doc).toBe(doc);expect(s().proposal?.items[0].status).toBe('stale')
})
it('HTML layout/theme edits cannot erase manual HTML changes; slot edits guard missing or changed targets',()=>{
 s().load({...emptyDoc(),blocks:[{id:'html',type:'html',props:{label:'HTML',html:'<p>One</p><p>Two</p>'}}]})
 for(const op of [{op:'update',id:'html',props:{},themeId:'minimal-magazine'},{op:'update',id:'html',props:{},layout:{gap:12}}] as DocOp[]){const p=proposal([op]);s().updateProps('html',{html:'<p>Manual</p><p>Two</p>'});expect(getProposalItemIssue(p,s().doc,0)).toBeTruthy();s().load(p.base)}
 const missing=proposal([{op:'update',id:'html',props:{},slots:{t99:'Missing'}}]);expect(getProposalItemIssue(missing,s().doc,0)).toBeTruthy()
 const changed=proposal([{op:'update',id:'html',props:{},slots:{t0:'AI'}}]);s().updateProps('html',{html:'<p>Manual</p><p>Two</p>'});expect(getProposalItemIssue(changed,s().doc,0)).toBeTruthy()
})
it('array primitive changes and anonymous permutations are conservatively stale; deletions rebase precisely',()=>{
 // Explicit in-memory proposal boundary: these arbitrary props model corrupted/legacy input,
 // and must be guarded before validateOp rejects unsupported fields.
 for(const [before,after,current] of [
  [['A','B'],['AI','B'],['A','Manual']],
  [[{caption:'A'},{caption:'B'}],[{caption:'AI'},{caption:'B'}],[{caption:'B'},{caption:'A'}]],
  [[{caption:'A'}],[{caption:'AI'}],[null]],
 ] as unknown[][]){s().updateProps('h',{nested:before});const p=proposal([{op:'update',id:'h',props:{nested:after}}]);s().updateProps('h',{nested:current});expect(getProposalItemIssue(p,s().doc,0)).toBeTruthy()}
 s().updateProps('h',{nested:{keep:'K',remove:'R'}});const p=proposal([{op:'update',id:'h',props:{nested:{keep:'K'}}}]);s().updateProps('h',{nested:{keep:'Manual',remove:'R'}});expect(getProposalItemIssue(p,s().doc,0)).toBeNull();expect(rebaseProposalOp(p,s().doc,0)).toMatchObject({props:{nested:{keep:'Manual'}}})
})
it('unchanged primitive arrays and independent object changes remain valid',()=>{
 s().updateProps('h',{nested:['A','B']});const p=proposal([{op:'update',id:'h',props:{nested:['AI','B']}}]);expect(getProposalItemIssue(p,s().doc,0)).toBeNull();expect(rebaseProposalOp(p,s().doc,0)).toMatchObject({props:{nested:['AI','B']}})
})
it('multiselection proposals cannot include out of scope changes; safe preview equals actual accepted batch',()=>{
 s().propose('Selected',[{op:'update',id:'h',props:{title:'AI'}},{op:'update',id:'p',props:{text:'AI body'}}],['h','p']);const p=s().proposal!,preview=previewProposal(p,s().doc);s().resolveProposal('all','accepted');expect({...s().doc,updatedAt:0}).toEqual({...preview,updatedAt:0});expect(s().past).toHaveLength(1)
 s().propose('Unsafe',[{op:'update',id:'h',props:{title:'Other'}},{op:'remove',id:'p'}],['h','p']);expect(s().proposal?.items).toHaveLength(0);expect(s().proposal?.errors.length).toBeGreaterThan(0)
})

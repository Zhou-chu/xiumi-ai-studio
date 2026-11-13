// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { emptyDoc, type Proposal } from '../../src/editor/store'
import { buildReviewDisplay, reviewInsertionAnchor } from '../../src/editor/reviewDisplay'
const original=createBlock('html',{label:'Original',html:'<h2>Old heading</h2><p>'+('A complete long paragraph. '.repeat(150))+'</p>'})
const doc={...emptyDoc(),blocks:[original]}
const proposal:Proposal={summary:'Review',base:doc,errors:[],items:[{status:'pending',op:{op:'update',id:original.id,props:{},slots:{t0:'New heading'}}}]}
it('renders the complete suggested module without mutating the original or applying the proposal',()=>{
 const before=JSON.stringify(doc);const display=buildReviewDisplay(proposal,doc,0)
 expect(display.html).toContain('New heading');expect(display.html).toContain('A complete long paragraph. '.repeat(150))
 expect(JSON.stringify(doc)).toBe(before);expect(proposal.items[0].status).toBe('pending')
})
it('does not present a stale suggestion as an applicable replacement',()=>{
 const changed={...doc,blocks:[{...original,props:{...original.props,html:'<h2>Manual heading</h2><p>changed</p>'}}]}
 const display=buildReviewDisplay(proposal,changed,0)
 expect(display.issue).toBeTruthy();expect(display.applicable).toBe(false)
})
it('a removal is described honestly and has no fake replacement module',()=>{
 const p:Proposal={...proposal,items:[{status:'pending',op:{op:'remove',id:original.id}}]}
 const display=buildReviewDisplay(p,doc,0)
 expect(display.html).toBeNull();expect(display.kind).toBe('remove')
})
it('an insertion anchors before the real next block or at the end',()=>{
 expect(reviewInsertionAnchor(doc,0)).toBe(original.id)
 expect(reviewInsertionAnchor(doc,1)).toBeNull()
})

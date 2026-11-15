// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { textToRich } from '../../src/core/richtext'
import { extractSlots, fillSlots, setSlotColor } from '../../src/core/slots'
import { emptyDoc, useStore } from '../../src/editor/store'
const state = () => useStore.getState()
const paragraph = (id: string, text: string) => ({ ...createBlock('paragraph', { content: textToRich(text) }), id })
beforeEach(() => state().load({ ...emptyDoc(), blocks: [paragraph('a', 'original'), paragraph('b', 'other')] }))
const htmlSetup=()=>{
 const html='<p style="color:#111111">first</p><p>second</p>'
 state().load({...emptyDoc(),blocks:[{...createBlock('html',{html,label:'original'}),id:'h'}]})
 const ids=extractSlots(html).filter(s=>s.kind==='text').map(s=>s.id)
 state().propose('HTML',[{op:'update',id:'h',slots:{[ids[0]]:'AI'}}]); return {html,ids}
}
it.each(['text','color','structure'])('rejects conflicting HTML %s edits', kind=>{
 const {html,ids}=htmlSetup()
 const changed=kind==='text'?fillSlots(html,{[ids[0]]:'manual'}):kind==='color'?setSlotColor(html,ids[0],'#ff0000'):html.replace('<p>','<section>').replace('second</p>','second</section>')
 state().updateProps('h',{html:changed}); state().resolveProposal('all','accepted')
 expect((state().doc.blocks[0] as any).props.html).toBe(changed); expect(state().proposal!.items[0].status).toBe('rejected')
})
it('preserves an independently edited HTML text slot',()=>{
 const {html,ids}=htmlSetup(); state().updateProps('h',{html:fillSlots(html,{[ids[1]]:'manual second'})}); state().resolveProposal('all','accepted')
 const result=(state().doc.blocks[0] as any).props.html; expect(result).toContain('AI'); expect(result).toContain('manual second')
})

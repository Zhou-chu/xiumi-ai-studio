// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { aiContext } from '../../src/core/quickActions'
import { createBlock } from '../../src/core/blocks'
import { applyOp, validateOp } from '../../src/core/ops'
import { extractSlots } from '../../src/core/slots'
import type { Doc } from '../../src/core/types'
const text = '甲'.repeat(299) + '😀' + '长段落尾部必须保留。'.repeat(45)
function document(): Doc {
 return { id:'d',title:'Long article',themeId:'ink',blocks:[{...createBlock('html',{html:`<p>${text}</p><img src="https://example.test/photo.jpg">`,label:'source'}),id:'long'}],createdAt:0,updatedAt:0 } as unknown as Doc
}
it.each([undefined,'long',['long']])('sends complete replaceable slots in scope %s',focus=>{
 const context=aiContext(document(),focus)
 const block=context.blocks.find(b=>b.id==='long')!
 expect((block.props as {slots:{text:string}[]}).slots[0].text).toBe(text)
})
it('preserves the unseen-tail regression through real slot validation and application',()=>{
 const doc=document(); const context=aiContext(doc)
 const slot=(context.blocks[0].props as {slots:{id:string;text:string}[]}).slots[0]
 const checked=validateOp(doc,{op:'update',id:'long',slots:{[slot.id]:'乙'+slot.text.slice(1)}})
 expect(checked.error).toBeUndefined();expect(checked.op).toBeDefined()
 const result=applyOp(doc,checked.op!)
 const block=result.blocks[0]
 if(block.type!=='html') throw new Error('expected HTML block')
 const html=block.props.html
 const resultSlot=extractSlots(html).find(s=>s.kind==='text')
 expect(resultSlot && resultSlot.kind==='text' && resultSlot.text).toBe('乙'+text.slice(1))
 expect(html).toContain('https://example.test/photo.jpg');expect(html).toContain('😀')
})

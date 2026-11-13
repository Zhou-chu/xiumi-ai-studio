// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { placeReviewBubble, groupReviewMarkers } from '../../src/editor/inlineReviewGeometry'
import { readSlotNodes, extractSlots } from '../../src/core/slots'
it('places narrow bubbles within the visible canvas and flips above near the bottom', () => {
 const p=placeReviewBubble({left:310,top:490,right:340,bottom:510}, {width:350,height:550}, {width:320,height:180})
 expect(p.left).toBeGreaterThanOrEqual(8);expect(p.left+320).toBeLessThanOrEqual(342)
 expect(p.top+180).toBeLessThanOrEqual(490)
})
it('clusters nearby markers but preserves every operation index',()=>{
 expect(groupReviewMarkers([{index:0,x:10,y:20},{index:1,x:15,y:24},{index:2,x:12,y:90}]).map(g=>g.indices)).toEqual([[0,1],[2]])
})
it('maps repeated HTML text by traversal slot identity without mutating authored markup',()=>{
 const root=document.createElement('div');root.innerHTML='<section><p>相同文字</p><p>相同文字</p></section>'
 const before=root.innerHTML;const slots=readSlotNodes(root)
 expect(slots.map(s=>s.slot.id)).toEqual(extractSlots(before).map(s=>s.id))
 expect(slots[0].node).not.toBe(slots[1].node);expect(slots[1].node.textContent).toBe('相同文字')
 expect(root.innerHTML).toBe(before)
})

it('keeps a clicked secondary slot instead of jumping to the first slot', async () => {
 const { selectReviewAnchor } = await import('../../src/editor/inlineReviewGeometry')
 const anchors=[{index:0,slot:'t0',x:1,y:20},{index:0,slot:'t1',x:1,y:90}]
 expect(selectReviewAnchor(anchors,0,'t1')).toBe(anchors[1])
 expect(selectReviewAnchor(anchors,0,null)).toBe(anchors[0])
 expect(selectReviewAnchor(anchors,0,'missing')).toBeUndefined()
})
it('uses user-facing operation headings rather than HTML or block summaries', async () => {
 const { reviewHeading } = await import('../../src/editor/inlineReviewGeometry')
 expect(reviewHeading({op:'update',id:'html1',props:{},slots:{t0:'new'}},0,3)).toBe('文字修改 · 1/3')
 expect(reviewHeading({op:'setMeta',title:'new'},1,3)).toBe('文章信息 · 2/3')
})

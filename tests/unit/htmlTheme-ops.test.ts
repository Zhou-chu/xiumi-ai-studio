// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { validateOp, applyOp } from '../../src/core/ops'
import { useStore, emptyDoc } from '../../src/editor/store'
import { previewProposal } from '../../src/editor/proposalSafety'
import { compileDoc } from '../../src/core/compiler'
import { EDIT_SYSTEM } from '../../server/ai'
const state=()=>useStore.getState()
const html='<h2 style="color:#cc3300">标题</h2><p style="font-size:25px">原文</p><img src="/media/a.png">'
beforeEach(()=>{vi.useFakeTimers();state().load({...emptyDoc(),blocks:[{id:'html',type:'html',props:{html,label:'原文'}}]})})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})
it('rejects unknown themes and arbitrary HTML, while accepting explicit theme update',()=>{
 const doc=state().doc
 expect(validateOp(doc,{op:'update',id:'html',themeId:'injected'}).error).toBeTruthy()
 expect(validateOp(doc,{op:'update',id:'html',props:{html:'<script>bad()</script>'}}).error).toBeTruthy()
 const result=validateOp(doc,{op:'update',id:'html',themeId:'tsinghua-purple',props:{html:'untrusted'}})
 expect(result.op).toMatchObject({op:'update',themeId:'tsinghua-purple'})
 expect(JSON.stringify(applyOp(doc,result.op!))).not.toContain('untrusted')
})
it('previews without modifying document; accepts once and undo restores exact source',()=>{
 state().propose('theme',[{op:'update',id:'html',themeId:'tsinghua-purple'}])
 const preview=previewProposal(state().proposal!,state().doc)
 expect(preview.blocks[0].props).not.toEqual(state().doc.blocks[0].props)
 expect(state().doc.blocks[0].props).toMatchObject({html})
 state().resolveProposal(0,'accepted');const accepted=state().doc
 expect(accepted.blocks[0].props).not.toMatchObject({html})
 state().resolveProposal(0,'accepted');expect(state().doc).toBe(accepted)
 state().undo();expect(state().doc.blocks[0].props).toMatchObject({html})
})
it('reject keeps original exact HTML',()=>{
 state().propose('theme',[{op:'update',id:'html',themeId:'tsinghua-purple'}]);state().resolveProposal(0,'rejected')
 expect(state().doc.blocks[0].props).toMatchObject({html})
})
it.each([html.replace('原文','手改文字'),html.replace('25px','21px')])('stale theme cannot overwrite later text or style edits',current=>{
 state().propose('theme',[{op:'update',id:'html',themeId:'tsinghua-purple'}]);state().updateProps('html',{html:current});state().resolveProposal(0,'accepted')
 expect(state().proposal!.items[0].status).toBe('stale');expect(state().doc.blocks[0].props).toMatchObject({html:current})
})
it('combines slot changes and theme in one safe update',()=>{
 const result=validateOp(state().doc,{op:'update',id:'html',themeId:'tsinghua-purple',slots:{t1:'新正文'}})
 expect(result.op?.op==='update'&&result.op.props.html).toContain('新正文')
 expect(result.op?.op==='update'&&result.op.props.html).toContain('15px')
})
it('system tells model to adapt every imported fragment, not merely setTheme',()=>{
 expect(EDIT_SYSTEM).toContain('不能只 setTheme')
 expect(EDIT_SYSTEM).toContain('tsinghua-purple（清华紫）')
 expect(EDIT_SYSTEM).not.toContain('不能改结构和样式')
})
it('layout proposal rebuilds real structure and accepts, exports and undoes safely',()=>{
 const source='<div><h2>Heading</h2><p>Body <a href="https://example.com">link</a></p><img src="/a.png" alt="original"></div>'
 state().load({...emptyDoc(),blocks:[{id:'html',type:'html',props:{html:source,label:'Original'}}]})
 state().propose('Rebuild',[{op:'update',id:'html',themeId:'tsinghua-purple',layout:'chapters'}])
 expect(state().proposal?.items[0].op).toMatchObject({layout:'chapters'})
 expect(JSON.stringify(previewProposal(state().proposal!,state().doc))).toContain('data-article-layout')
 state().resolveProposal(0,'accepted')
 expect(JSON.stringify(state().doc)).toContain('data-article-layout')
 expect(compileDoc(state().doc).html).toContain('https://example.com')
 expect(compileDoc(state().doc).html).toContain('/a.png')
 expect(compileDoc(state().doc).html).toContain('border-left')
 state().undo();expect(state().doc.blocks[0].props).toMatchObject({html:source})
})
it('rejects invalid layout or layout without explicit theme',()=>{
 expect(validateOp(state().doc,{op:'update',id:'html',themeId:'tsinghua-purple',layout:'arbitrary'}).error).toBeTruthy()
 expect(validateOp(state().doc,{op:'update',id:'html',layout:'editorial'}).error).toBeTruthy()
})

it('protects a layout proposal from later manual HTML edits and reports opaque content',()=>{
 const source='<div><h2>Heading</h2><table><tbody><tr><td>Kept</td></tr></tbody></table></div>'
 state().load({...emptyDoc(),blocks:[{id:'html',type:'html',props:{html:source,label:'Original'}}]})
 state().propose('Rebuild',[{op:'update',id:'html',themeId:'tsinghua-purple',layout:'editorial'}])
 expect(state().proposal?.items[0].op.reason).toContain('1')
 state().updateProps('html',{html:source.replace('Kept','Manual change')})
 state().resolveProposal(0,'accepted')
 expect(state().proposal?.items[0].status).toBe('stale')
 expect(JSON.stringify(state().doc)).toContain('Manual change')
})
it('theme and layout never discard dark panel behind white text',()=>{
 const dark='<section style="background-color:#111111"><p style="color:#ffffff">White on dark</p></section>'
 state().load({...emptyDoc(),blocks:[{id:'html',type:'html',props:{html:'<h2>Heading</h2>'+dark,label:'Original'}}]})
 const result=validateOp(state().doc,{op:'update',id:'html',themeId:'tsinghua-purple',layout:'chapters'})
 expect(result.op?.op==='update' && result.op.props.html).toContain('background-color: rgb(17, 17, 17)')
 expect(result.op?.reason).toContain('1')
})

// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import type { Doc } from '../../src/core/types'
import { createBlock } from '../../src/core/blocks'
import { validateOp, applyOp } from '../../src/core/ops'
import { aiContext } from '../../src/core/quickActions'
import { compileDoc } from '../../src/core/compiler'
import { useStore, emptyDoc } from '../../src/editor/store'
import { previewProposal } from '../../src/editor/proposalSafety'
const state=()=>useStore.getState()
const htmlOf=(doc:Doc)=>{const block=doc.blocks[0];if(block.type!=='html')throw new Error('Expected HTML fixture');return block.props.html}
const source='<div><h2 style="color:#ee2222">标题</h2><p>正文 <a href="https://example.test/page">链接</a></p><img src="/media/original.png" alt="原图"></div>'
const load=(html=source)=>state().load({...emptyDoc(),blocks:[{...createBlock('html',{html,label:'原文'}),id:'html'}]})
const update=(extra:Record<string,unknown>)=>validateOp(state().doc,{op:'update',id:'html',...extra})
beforeEach(()=>load())
it('preview is readonly, acceptance persists/export renders, repeated accept is inert and undo restores source',()=>{
 state().propose('章节重排',[{op:'update',id:'html',themeId:'tsinghua-purple',layout:'chapters'}]);const original=state().doc
 const preview=previewProposal(state().proposal!,original);expect(htmlOf(preview)).toContain('data-article-layout');expect(state().doc).toBe(original)
 state().resolveProposal(0,'accepted');const accepted=state().doc;expect(compileDoc(accepted).html).toContain('border-left');expect(compileDoc(accepted).html).toContain('/media/original.png')
 state().resolveProposal(0,'accepted');expect(state().doc).toBe(accepted);state().undo();expect(htmlOf(state().doc)).toBe(source);state().redo();expect(state().doc).toBe(accepted)
})
it.each([source.replace('正文','手改'),source.replace('original.png','replacement.png'),source.replace('#ee2222','#112233')])('theme/layout rejects any later complete HTML change',changed=>{
 state().propose('重排',[{op:'update',id:'html',themeId:'tsinghua-purple',layout:'chapters'}]);state().updateProps('html',{html:changed});state().resolveProposal(0,'accepted')
 expect(htmlOf(state().doc)).toBe(changed);expect(state().proposal!.items[0].status).not.toBe('accepted')
})
it.each([undefined,'html',['html']].map(scope=>[scope]))('full long slot context survives emoji and image in scope %j',scope=>{
 const text='文'.repeat(299)+'😀'+'尾文'.repeat(200);load(`<p>${text}</p><img src="/media/original.png">`)
 const context=aiContext(state().doc,scope) as any;expect(context.blocks[0].props.slots[0].text).toBe(text)
 const result=update({slots:{t0:'改'+context.blocks[0].props.slots[0].text.slice(1)}});expect(result.error).toBeUndefined()
 const html=htmlOf(applyOp(state().doc,result.op!)) as string;expect(html).toContain('😀');expect(html).toContain('尾文'.repeat(200));expect(html).toContain('/media/original.png')
})
it('pure text-slot proposal still merges independent text and rejects the same-slot edit',()=>{
 load('<p>第一段</p><p>第二段</p>');state().propose('文字',[{op:'update',id:'html',slots:{t0:'建议第一段'}}])
 state().updateProps('html',{html:'<p>第一段</p><p>手改第二段</p>'});state().resolveProposal(0,'accepted')
 expect(htmlOf(state().doc)).toContain('建议第一段');expect(htmlOf(state().doc)).toContain('手改第二段')
 load('<p>第一段</p><p>第二段</p>');state().propose('文字',[{op:'update',id:'html',slots:{t0:'建议第一段'}}]);state().updateProps('html',{html:'<p>手改第一段</p><p>第二段</p>'});state().resolveProposal(0,'accepted');expect(htmlOf(state().doc)).toContain('手改第一段')
})
it('rejecting structural proposal never mutates the source and undo/redo cannot revive it',()=>{
 state().propose('重排',[{op:'update',id:'html',themeId:'tsinghua-purple',layout:'editorial'}]);const doc=state().doc;state().resolveProposal(0,'rejected');expect(state().doc).toBe(doc)
 state().updateProps('html',{label:'手改标签'});state().undo();state().redo();expect(state().proposal).toBeNull()
})
it('theme plus slots uses existing slot writer and subsequent color editing remains available',async()=>{
 const {slotColors,setSlotColor}=await import('../../src/core/slots')
 load('<p style="color:#ff0000">第一段</p><p>第二段</p>');const result=update({themeId:'tsinghua-purple',slots:{t0:'新文'}});expect(result.error).toBeUndefined()
 const html=result.op!.op==='update'?result.op!.props.html:'';const changed=setSlotColor(html,'t0','#123456');expect(slotColors(changed).t0).toBe('#123456');expect(changed).toContain('新文')
})
it('prompt requires explicit structure and states complex/bitmap limitations',async()=>{
 const {EDIT_SYSTEM}=await import('../../server/ai');expect(EDIT_SYSTEM).toContain('layout:"chapters"');expect(EDIT_SYSTEM).toContain('不能只 setTheme');expect(EDIT_SYSTEM).toContain('完全无法安全拆分');expect(EDIT_SYSTEM).toContain('tsinghua-purple')
})
it('does not import a fork-specific insertion index contract with the HTML prompt',async()=>{
 const {EDIT_SYSTEM}=await import('../../server/ai');expect(EDIT_SYSTEM).not.toContain('insert.index 始终指当前请求中原始文稿')
})

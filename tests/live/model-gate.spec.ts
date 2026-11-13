import {test,expect} from '@playwright/test'
import fs from 'node:fs'
// Explicit paid live gate: no provider mocking, no credentials read or logged.
test('real configured model produces safe full-module layout proposals and selected edits',async({page})=>{
 const status=await(await page.request.get('/api/ai/status')).json()
 expect(status.enabled).toBe(true)
 const id=`live-gate-${Date.now()}`,now=Date.now()
 const html='<div><h2>计算机系统概论</h2><p>计算机由硬件与软件共同组成。处理器执行指令，存储器保存程序和数据。</p><h2>系统层次</h2><p>指令集连接软件与硬件，操作系统管理资源。</p></div>'
 const doc={id,title:'Live gate 合成验收文稿',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[{id:'live-html',type:'html',props:{html,label:'原文片段'}},{id:'live-heading',type:'heading',props:{index:'01',title:'课堂练习',subtitle:'说明',variant:'auto'}}]}
 expect((await page.request.put('/api/projects/'+id,{data:doc})).ok()).toBe(true)
 await page.route('**/api/projects',r=>r.fulfill({json:[{id,title:doc.title}]}))
 await page.goto('/');await expect(page.locator('.title-input')).toHaveValue(doc.title)
 await page.getByTestId('tab-ai').click()
 const submit=page.getByRole('button',{name:'生成修改建议',exact:true})
 await page.locator('.ai-suggestion-input textarea').fill('所有不符合清华紫的模块控件全部重做。原文片段需要真正按标题分章重新组织结构，不只是换颜色；保持文字、图片和链接完整。')
 const response=page.waitForResponse('**/api/ai/edit',{timeout:200000});await submit.click();const res=await response;expect(res.ok()).toBe(true)
 const result=await res.json();expect(result.ops.some((o:any)=>o.op==='update'&&o.id==='live-html'&&o.layout)).toBe(true)
 await expect(page.getByTestId('review-item-0')).toBeVisible()
 await page.screenshot({path:'visual-evidence/live-gate-layout.png',fullPage:true})
 await page.locator('.review-menu summary').click();await page.getByTestId('accept-all').click()
 await expect(page.locator('[data-block-id="live-html"] [data-article-layout]')).toHaveCount(1)
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await page.reload();await expect(page.locator('[data-block-id="live-html"]')).toContainText('指令集连接软件与硬件')
 await page.locator('[data-block-id="live-heading"]').click({position:{x:3,y:3}});await page.getByTestId('tab-ai').click();await expect(page.getByTestId('ai-edit-scope')).toHaveValue('selection')
 await page.locator('.ai-suggestion-input textarea').fill('仅将当前选中模块的标题改为“课堂实验”，其他内容不变。')
 const second=page.waitForResponse('**/api/ai/edit',{timeout:200000});await submit.click();const r2=await second;expect(r2.ok()).toBe(true);const edit=await r2.json();expect(edit.ops.length).toBeGreaterThan(0);expect(edit.ops.every((o:any)=>o.op==='update'&&o.id==='live-heading')).toBe(true)
 await page.getByTestId('accept-review').first().click();await expect(page.locator('[data-block-id="live-heading"]')).toContainText('课堂实验');await expect(page.getByTestId('save-status')).toHaveText('已保存')
 const saved=await(await page.request.get('/api/projects/'+id)).json();expect(JSON.stringify(saved)).not.toContain('review-bubble')
 fs.mkdirSync('docs/qa/live',{recursive:true});fs.writeFileSync('docs/qa/live/model-gate.json',JSON.stringify({at:new Date().toISOString(),profile:{provider:status.provider,model:status.model},syntheticDocument:id,realProvider:true,layoutOps:result.ops.map((o:any)=>({op:o.op,id:o.id,layout:o.layout,themeId:o.themeId})),selectedOps:edit.ops.map((o:any)=>({op:o.op,id:o.id})),passed:true},null,2))
})

import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { createBlock } from '../../src/core/blocks'

const pageErrors=new WeakMap<Page,string[]>()
test.beforeEach(async({page})=>{const errors:string[]=[];pageErrors.set(page,errors);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{(window as any).__reviewErrors=[];window.addEventListener('error',e=>(window as any).__reviewErrors.push(e.message))})})
test.afterEach(async({page})=>{expect(pageErrors.get(page)??[]).toEqual([]);for(const frame of page.frames())expect(await frame.evaluate(()=>(window as any).__reviewErrors??[])).toEqual([])})
// Synthetic provider output exercises real proposal resolution; no paid model is called.
const source = '<h2>Original heading</h2><p>Original first sentence.</p><p>Original second sentence.</p>'
const ops = [
  { op: 'update', id: 'review-html', slots: { t0: 'Revised heading' }, reason: 'Clarify the heading' },
  { op: 'update', id: 'review-html', slots: { t1: 'Revised first sentence.' }, reason: 'Clarify the first sentence' },
  { op: 'setMeta', title: 'Revised article title', reason: 'Clarify article metadata' },
]
async function setup(page: Page, width: number, height: number, mode: 'light'|'dark', overrides?: { html?: string; operations?: unknown[]; title?: string }) {
  await page.setViewportSize({width,height})
  await page.addInitScript(mode=>{ if(window.top===window) localStorage.setItem('xiumi-color-mode',mode) },mode)
  const now=Date.now(), id=`inline-review-${now}-${Math.random().toString(36).slice(2)}`
  const doc={id,title:overrides?.title ?? 'Inline review fixture',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[{...createBlock('html',{label:'Review fixture',html:overrides?.html ?? source}),id:'review-html'},...Array.from({length:14},(_,i)=>({...createBlock('paragraph',{content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:`Long body ${i}. `+'Content for scrolling. '.repeat(12)}]}]},align:'left'}),id:`body-${i}`}))]}
  expect((await page.request.put('/api/projects/'+id,{data:doc})).ok()).toBe(true)
  // Select this fixture explicitly rather than depend on another test's latest timestamp.
  await page.route('**/api/projects',route=>route.fulfill({json:[{id,title:doc.title}]}))
  await page.route('**/api/ai/status',route=>route.fulfill({json:{enabled:true,provider:'openai',model:'fixture',name:'Synthetic review fixture',profileId:'fixture'}}))
  await page.route('**/api/ai/suggest-instruction',route=>route.fulfill({json:{suggestion:''}}))
  await page.route('**/api/ai/edit',route=>route.fulfill({json:{summary:'Review independent changes',ops:overrides?.operations ?? ops}}))
  await page.goto('/')
  await expect(page.locator('.title-input')).toHaveValue(doc.title)
  const original=await page.locator('[data-block-id="review-html"] > .block-html').innerHTML()
  if(await page.getByTestId('workspace-right').isVisible()) await page.getByTestId('workspace-right').click()
  await page.getByTestId('tab-ai').click()
  await page.locator('.ai-suggestion-input textarea').fill('Review this fixture')
  await page.getByRole('button',{name:'生成修改建议',exact:true}).click()
  await expect(page.getByTestId('proposal')).toBeVisible()
  return {id,original}
}
const item=(page:Page,index:number)=>page.getByTestId(`review-item-${index}`)
const suggestion=(page:Page,index:number)=>page.frameLocator(`[data-testid="review-suggestion-${index}"]`)
const originalBlock=(page:Page)=>page.locator('[data-block-id="review-html"] > .block-html')
for(const v of [{name:'desktop',width:1440,height:900},{name:'tablet',width:1024,height:768},{name:'phone',width:390,height:844}]) for(const mode of ['light','dark'] as const) {
 test(`full review pairs are directly visible: ${v.name} ${mode}`,async({page})=>{
  const {id,original}=await setup(page,v.width,v.height,mode)
  await expect(page.locator('.panel.right .proposal')).toHaveCount(0)
  await expect(item(page,0)).toBeVisible()
  await expect(suggestion(page,0).locator('body')).toContainText('Revised heading')
  await expect(suggestion(page,0).locator('body')).toContainText('Original first sentence.')
  await expect(page.locator('.review-marker')).toHaveCount(0)
  expect(await originalBlock(page).innerHTML()).toBe(original)
  const a=await page.locator('[data-block-id="review-html"]').boundingBox(),b=await page.getByTestId('review-suggestion-0').boundingBox()
  expect(b!.y).toBeGreaterThanOrEqual(a!.y+a!.height-1)
  expect(b!.x).toBeGreaterThanOrEqual(0);expect(b!.x+b!.width).toBeLessThanOrEqual(v.width)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(v.width)
  const accept=item(page,0).getByTestId('accept-review'),reject=item(page,0).getByTestId('reject-review')
  await expect(accept).toHaveAccessibleName(/接受/);await expect(reject).toHaveAccessibleName(/拒绝/)
  const colors=await Promise.all([accept,reject].map(l=>l.evaluate(e=>getComputedStyle(e).backgroundColor)));expect(colors[0]).not.toBe(colors[1])
  const [green,red]=colors.map(c=>(c.match(/[\d.]+/g)??[]).map(Number));expect(green[1]).toBeGreaterThan(green[0]);expect(red[0]).toBeGreaterThan(red[1])
  await suggestion(page,0).locator('body').evaluate(()=>document.fonts.ready)
  await page.getByTestId('review-original-0').scrollIntoViewIfNeeded()
  mkdirSync('visual-evidence/block-review',{recursive:true});await page.screenshot({path:`visual-evidence/block-review/${v.name}-${mode}.png`})
  expect((await(await page.request.get('/api/projects/'+id)).json()).blocks[0].props.html).toBe(source)
  await accept.click();await expect(originalBlock(page)).toContainText('Revised heading')
  await item(page,1).getByTestId('reject-review').click();await expect(originalBlock(page)).toContainText('Original first sentence.')
  await page.locator('.canvas-scroll').click({position:{x:3,y:3}});await page.keyboard.press('Control+z')
  await expect(originalBlock(page)).toContainText('Original heading');await expect(page.getByTestId('proposal')).toHaveCount(0)
 })
}
test('manual edits disable matching metadata review without overwriting them',async({page})=>{
 await setup(page,1440,900,'dark');await page.locator('.title-input').fill('My later manual title')
 await expect(item(page,2).getByTestId('accept-review')).toBeDisabled();await expect(item(page,2)).toContainText(/变化|过期|重新生成/)
 await expect(page.locator('.title-input')).toHaveValue('My later manual title')
})
test('scroll and zoom keep full review separate from preview and saved content',async({page})=>{
 const {id}=await setup(page,1440,900,'dark');await page.getByTestId('zoom-in').click()
 await expect(page.locator('.phone')).toHaveAttribute('data-zoom','1.1')
 await page.getByTestId('review-suggestion-0').scrollIntoViewIfNeeded();await expect(suggestion(page,0).locator('body')).toContainText('Revised heading')
 await page.locator('.canvas-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight});await page.getByTestId('review-open').click()
 await expect(item(page,0)).toBeInViewport();await page.getByTestId('open-preview').click()
 const preview=page.frameLocator('[data-testid="preview-frame"]')
 await expect(preview.locator('body')).toContainText('Original heading');await expect(preview.locator('body')).not.toContainText('Revised heading')
 await expect(preview.locator('[data-testid^="review-"],.inline-review')).toHaveCount(0)
 const saved=await(await page.request.get('/api/projects/'+id)).json();expect(saved.blocks[0].props.html).toBe(source);expect(JSON.stringify(saved)).not.toContain('review-suggestion')
})
test('long HTML suggestion includes complete module and the last changed slot',async({page})=>{
 const html='<h2>Top unchanged</h2>'+Array.from({length:25},(_,i)=>`<p>Paragraph ${i}: ${'Long text for full module rendering. '.repeat(20)}</p>`).join('')+'<h2>Bottom target</h2>'
 await setup(page,1440,900,'dark',{html,operations:[{op:'update',id:'review-html',slots:{t26:'Revised bottom target'}}]})
 for(const text of ['Top unchanged','Paragraph 24','Revised bottom target']) await expect(suggestion(page,0).locator('body')).toContainText(text)
 await expect(originalBlock(page)).toContainText('Bottom target');await item(page,0).getByTestId('accept-review').click()
 await expect(originalBlock(page).locator('h2').last()).toHaveText('Revised bottom target');await expect(originalBlock(page).locator('h2').first()).toHaveText('Top unchanged')
})
test('review controls isolate Delete and Backspace from article',async({page})=>{
 await setup(page,1440,900,'dark');await page.locator('[data-block-id="review-html"]').click({position:{x:3,y:3}})
 await item(page,0).getByTestId('accept-review').focus();await page.keyboard.press('Delete');await page.keyboard.press('Backspace')
 await expect(originalBlock(page)).toContainText('Original heading')
})
test('multi-slot suggestions display both changes and accept atomically',async({page})=>{
 const html='<h2>First slot</h2><p style="margin-top:1100px">Second slot</p>'
 await setup(page,1440,900,'dark',{html,operations:[{op:'update',id:'review-html',slots:{t0:'Revised first slot',t1:'Revised second slot'}}]})
 for(const text of ['Revised first slot','Revised second slot']) await expect(suggestion(page,0).locator('body')).toContainText(text)
 await item(page,0).getByTestId('accept-review').click()
 for(const text of ['Revised first slot','Revised second slot']) await expect(originalBlock(page)).toContainText(text)
})
test('batch Escape restores trigger while suggestions stay visible',async({page})=>{
 await setup(page,1440,900,'dark');const summary=page.locator('.review-menu summary');await summary.click()
 await page.getByTestId('accept-all').focus();await page.keyboard.press('Escape')
 await expect(page.getByTestId('accept-all')).not.toBeVisible();await expect(summary).toBeFocused();await expect(item(page,0)).toBeVisible()
})
test('removed target remains explicitly stale and cannot apply',async({page})=>{
 await setup(page,1440,900,'dark');const block=page.locator('[data-block-id="review-html"]')
 await block.click({position:{x:3,y:3}});await page.keyboard.press('Delete');await expect(block).toHaveCount(0)
 await expect(item(page,0).getByTestId('accept-review')).toBeDisabled();await expect(item(page,0)).toContainText(/已删除|不存在|无法定位/)
 await item(page,0).getByTestId('reject-review').click();await expect(block).toHaveCount(0)
})
for(const v of [{name:'desktop',width:1440,height:900},{name:'phone',width:390,height:844}]) test(`Chinese full module review visual: ${v.name}`,async({page})=>{
 await setup(page,v.width,v.height,'dark',{title:'思想剧场 · 共创实验',html:'<h2>思想剧场 · 实验 01 温暖</h2><p>关于创作这件事，或许可以更好玩。</p><h3>第三场在场与遇见｜表达的观演关系</h3>',operations:[{op:'update',id:'review-html',slots:{t0:'思想剧场 · 实验 01 共创实验',t2:'第三场在场与遇见｜表达的观看关系'},reason:'让标题对应招募主题，统一正文措辞。'}]})
 await expect(suggestion(page,0).locator('body')).toContainText('共创实验');await suggestion(page,0).locator('body').evaluate(()=>document.fonts.ready);mkdirSync('visual-evidence/block-review',{recursive:true})
 await page.screenshot({path:`visual-evidence/block-review/chinese-${v.name}.png`})
})
test('image import preserves full-module review and acceptance',async({page})=>{
 const url='https://mmbiz.qpic.cn/inline-review-integration';await page.route(url,r=>r.fulfill({status:204,body:''}));let imported=0
 await page.route('**/api/assets/import-article',r=>{imported++;return r.fulfill({json:[{url,status:'imported'}]})})
 const {original}=await setup(page,1440,900,'dark',{html:source+`<img src="${url}" alt="fixture">`})
 let extraModelCalls=0;page.on('request',r=>{if(r.url().endsWith('/api/ai/edit'))extraModelCalls++})
 await page.getByLabel('AI 修改指令').fill('帮我把原文中的图片加入我们自己的素材库')
 await page.getByTestId('ai-image-library-command').click();const dialog=page.getByRole('dialog',{name:'收集文中图片'})
 await dialog.getByRole('button',{name:'确认加入素材库'}).click();await expect(dialog.getByRole('status')).toContainText('新增 1 张');expect(imported).toBe(1);expect(extraModelCalls).toBe(0)
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(item(page,0)).toBeVisible()
 expect(await originalBlock(page).innerHTML()).toBe(original);await item(page,0).getByTestId('accept-review').click()
 await expect(originalBlock(page)).toContainText('Revised heading');await expect(originalBlock(page).locator('img')).toHaveAttribute('src',url)
})
test('delete preserves original until acceptance and insert shows real new module',async({page})=>{
 const inserted={...createBlock('heading',{title:'New proposed heading'}),id:'new-review-heading'}
 await setup(page,1440,900,'dark',{operations:[{op:'remove',id:'review-html'},{op:'insert',index:1,block:inserted}]})
 await expect(originalBlock(page)).toContainText('Original heading');await expect(item(page,0)).toContainText(/删除/)
 await expect(suggestion(page,1).locator('body')).toContainText('New proposed heading');await expect(page.locator('[data-block-type="heading"]').filter({hasText:'New proposed heading'})).toHaveCount(0)
 await item(page,0).getByTestId('reject-review').click();await item(page,1).getByTestId('accept-review').click()
 await expect(page.locator('[data-block-type="heading"]').filter({hasText:'New proposed heading'})).toHaveCount(1);await expect(originalBlock(page)).toContainText('Original heading')
})
test('imported HTML theme proposal previews real purple styling and preserves content and media',async({page})=>{
 const url='/media/theme-fixture.png'
 await page.route('**'+url,r=>r.fulfill({status:204,body:''}))
 const html='<section style="border:1px solid #cc3300"><h2 style="color:#cc3300">清华活动标题</h2><p style="font-size:25px">保留全部正文 <a href="https://example.com/details">详情链接</a></p><img src="'+url+'" alt="原图片"></section>'
 const {id,original}=await setup(page,1440,900,'dark',{html,operations:[{op:'update',id:'review-html',themeId:'tsinghua-purple',reason:'整篇按清华紫适配，保留文字图片与结构'}]})
 await expect(originalBlock(page).locator('h2')).toHaveCSS('color','rgb(204, 51, 0)')
 await expect(suggestion(page,0).locator('h2')).toHaveCSS('color','rgb(102, 8, 116)')
 await expect(suggestion(page,0).locator('body')).toContainText('保留全部正文')
 await expect(suggestion(page,0).locator('a')).toHaveAttribute('href','https://example.com/details')
 await expect(suggestion(page,0).locator('img')).toHaveAttribute('src',url)
 expect(await originalBlock(page).innerHTML()).toBe(original)
 await item(page,0).getByTestId('accept-review').click()
 await expect(originalBlock(page).locator('h2')).toHaveCSS('color','rgb(102, 8, 116)')
 await expect(originalBlock(page).locator('img')).toHaveAttribute('src',url)
 await expect.poll(async()=>JSON.stringify((await(await page.request.get('/api/projects/'+id)).json()).blocks[0].props.html)).toContain('102, 8, 116')
 await page.keyboard.press('Control+z');expect(await originalBlock(page).innerHTML()).toBe(original)
})
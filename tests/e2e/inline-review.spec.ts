import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { createBlock } from '../../src/core/blocks'

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
  const original=await page.getByTestId('canvas').innerHTML()
  if(await page.getByTestId('workspace-right').isVisible()) await page.getByTestId('workspace-right').click()
  await page.getByTestId('tab-ai').click()
  await page.locator('.ai-suggestion-input textarea').fill('Review this fixture')
  await page.getByRole('button',{name:'生成修改建议',exact:true}).click()
  await expect(page.getByTestId('proposal')).toBeVisible()
  return {id,original}
}
for(const v of [{name:'desktop',width:1440,height:900},{name:'tablet',width:1024,height:768},{name:'phone',width:390,height:844}]) for(const mode of ['light','dark'] as const) {
 test(`inline review stays attached and keeps article clean: ${v.name} ${mode}`,async({page})=>{
  const {original}=await setup(page,v.width,v.height,mode)
  await expect(page.locator('.panel.right .proposal')).toHaveCount(0)
  expect(await page.getByTestId('canvas').innerHTML()).toBe(original)
  await page.getByTestId('review-open').click()
  const bubble=page.getByTestId('review-bubble')
  await expect(bubble).toBeVisible()
  await expect(bubble).toContainText('Original heading')
  await expect(bubble).toContainText('Revised heading')
  const rect=await bubble.boundingBox()
  expect(rect!.x).toBeGreaterThanOrEqual(0)
  expect(rect!.x+rect!.width).toBeLessThanOrEqual(v.width)
  expect(rect!.y).toBeGreaterThanOrEqual(0)
  expect(rect!.y+rect!.height).toBeLessThanOrEqual(v.height)
  expect(await page.getByTestId('canvas').innerHTML()).toBe(original)
  mkdirSync('visual-evidence/inline-review',{recursive:true})
  await page.screenshot({path:`visual-evidence/inline-review/${v.name}-${mode}.png`})
  await page.getByTestId('accept-review').click()
  await expect(page.locator('[data-block-id="review-html"]')).toContainText('Revised heading')
  await expect(page.getByTestId('review-bubble')).toContainText('Revised first sentence.')
  await page.getByTestId('reject-review').click()
  await expect(page.locator('[data-block-id="review-html"]')).toContainText('Original first sentence.')
  await page.keyboard.press('Escape')
  await expect(bubble).toHaveCount(0)
  await page.locator('.canvas-scroll').click({position:{x:3,y:3}})
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-block-id="review-html"]')).toContainText('Original heading')
  await expect(page.getByTestId('proposal')).toHaveCount(0)
 })
}

test('manual edits make the matching inline metadata suggestion stale without overwriting it',async({page})=>{
 await setup(page,1440,900,'dark')
 await page.locator('.title-input').fill('My later manual title')
 await page.getByTestId('review-open').click()
 await page.getByTestId('review-next').click()
 await page.getByTestId('review-next').click()
 await expect(page.getByTestId('accept-review')).toBeDisabled()
 await expect(page.getByTestId('review-bubble')).toContainText(/变化|过期|重新生成/)
 await expect(page.locator('.title-input')).toHaveValue('My later manual title')
})

test('scroll and article zoom keep inline review separate from preview and saved content',async({page})=>{
 const {id}=await setup(page,1440,900,'dark')
 await page.getByTestId('review-open').click()
 await expect(page.getByTestId('review-bubble')).toBeVisible()
 await page.getByTestId('zoom-in').click()
 await expect(page.locator('.phone')).toHaveAttribute('data-zoom','1.1')
 await page.getByTestId('review-open').click()
 await expect(page.getByTestId('review-bubble')).toBeVisible()
 const bubble=await page.getByTestId('review-bubble').boundingBox()
 expect(bubble!.x+bubble!.width).toBeLessThanOrEqual(1440)
 await page.locator('.canvas-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight})
 await expect(page.getByTestId('review-bubble')).not.toBeVisible()
 await page.getByTestId('review-open').click()
 await expect(page.getByTestId('review-bubble')).toBeVisible()
 await expect.poll(()=>page.locator('.canvas-scroll').evaluate(el=>el.scrollTop)).toBeLessThan(500)
 await page.keyboard.press('Escape')
 await page.getByTestId('open-preview').click()
 const preview=page.frameLocator('[data-testid="preview-frame"]')
 await expect(preview.locator('body')).toContainText('Original heading')
 await expect(preview.locator('body')).not.toContainText('Revised heading')
 await expect(preview.locator('[data-testid="review-bubble"],.inline-review')).toHaveCount(0)
 const saved=await(await page.request.get('/api/projects/'+id)).json()
 expect(saved.blocks[0].props.html).toBe(source)
 expect(JSON.stringify(saved)).not.toContain('review-bubble')
})

test('a long HTML block anchors to the actual changed slot rather than its block centre',async({page})=>{
 const html='<h2>Top unchanged</h2>'+Array.from({length:25},(_,i)=>`<p>Paragraph ${i}: ${'Long text for precise anchoring. '.repeat(20)}</p>`).join('')+'<h2>Bottom target</h2>'
 await setup(page,1440,900,'dark',{html,operations:[{op:'update',id:'review-html',slots:{t26:'Revised bottom target'},reason:'Change only the last heading'}]})
 await page.getByTestId('review-open').click()
 await expect(page.getByTestId('review-bubble')).toContainText('Bottom target')
 const target=page.locator('[data-block-id="review-html"] h2').last()
 await expect(target).toBeInViewport()
 const marker=page.locator('[data-review-slot="t26"]').first()
 await expect(marker).toBeVisible()
 const a=await target.boundingBox(), b=await marker.boundingBox()
 expect(Math.abs(a!.y-b!.y)).toBeLessThan(50)
 await page.getByTestId('accept-review').click()
 await expect(target).toHaveText('Revised bottom target')
 await expect(page.locator('[data-block-id="review-html"] h2').first()).toHaveText('Top unchanged')
})
test('review focus never turns Delete or Backspace into an article deletion',async({page})=>{
 await setup(page,1440,900,'dark')
 const block=page.locator('[data-block-id="review-html"]')
 await block.click({position:{x:3,y:3}})
 await page.getByTestId('review-open').click()
 await expect(page.getByTestId('review-bubble')).toBeVisible()
 await page.getByTestId('accept-review').focus()
 await page.keyboard.press('Delete')
 await expect(block).toHaveCount(1)
 await page.keyboard.press('Backspace')
 await expect(block).toHaveCount(1)
 await expect(block).toContainText('Original heading')
})

test('the second slot marker opens beside that slot, not the first one',async({page})=>{
 const html='<h2>First slot</h2><p style="margin-top:1100px">Second slot</p>'
 await setup(page,1440,900,'dark',{html,operations:[{op:'update',id:'review-html',slots:{t0:'Revised first slot',t1:'Revised second slot'}}]})
 await page.locator('[data-block-id="review-html"] p').scrollIntoViewIfNeeded()
 const second=page.locator('[data-review-slot="t1"]').first()
 await expect(second).toBeVisible()
 await second.click()
 await expect(page.locator('[data-block-id="review-html"] p')).toBeInViewport()
 await expect(page.getByTestId('review-bubble')).toBeVisible()
 const b=await page.getByTestId('review-bubble').boundingBox(),target=await page.locator('[data-block-id="review-html"] p').boundingBox()
 expect(Math.abs(b!.y-target!.y)).toBeLessThan(350)
 await expect(page.getByTestId('review-bubble')).toContainText('Revised second slot')
})

test('batch menu Escape closes only the menu and restores its trigger',async({page})=>{
 await setup(page,1440,900,'dark')
 const summary=page.locator('.review-menu summary')
 await summary.click()
 await page.getByTestId('accept-all').focus()
 await page.keyboard.press('Escape')
 await expect(page.getByTestId('accept-all')).not.toBeVisible()
 await expect(summary).toBeFocused()
 await expect(page.getByTestId('proposal')).toBeVisible()
})

test('a removed target has an honest stale review instead of a fabricated article anchor',async({page})=>{
 await setup(page,1440,900,'dark')
 const block=page.locator('[data-block-id="review-html"]')
 await block.click({position:{x:3,y:3}})
 await page.keyboard.press('Delete')
 await expect(block).toHaveCount(0)
 await page.getByTestId('review-open').click()
 await expect(page.getByTestId('review-bubble')).toBeVisible()
 await expect(page.getByTestId('accept-review')).toBeDisabled()
 await expect(page.getByTestId('review-bubble')).toContainText(/已删除|不存在|无法定位/)
 await page.getByTestId('reject-review').click()
 await expect(block).toHaveCount(0)
})

for(const v of [{name:'desktop',width:1440,height:900},{name:'phone',width:390,height:844}]) test(`Chinese editorial review visual: ${v.name}`,async({page})=>{
 await setup(page,v.width,v.height,'dark',{title:'思想剧场 · 共创实验',html:'<h2>思想剧场 · 实验 01 温暖</h2><p>关于创作这件事，或许可以更好玩。</p><h3>第三场在场与遇见｜表达的观演共振</h3>',operations:[{op:'update',id:'review-html',slots:{t0:'思想剧场 · 实验 01 共创实验'},reason:'将占位词“温暖”改为与招募呼应的明确主题。'},{op:'update',id:'review-html',slots:{t2:'第三场在场与遇见｜表达的观演共振'},reason:'统一标题标点。'}]})
 await page.getByTestId('review-open').click()
 await expect(page.getByTestId('review-bubble')).toContainText('共创实验')
 await page.screenshot({path:`visual-evidence/inline-review/chinese-${v.name}.png`})
})
test('article image import preserves an existing inline review and its acceptance safeguards', async ({page}) => {
  const imageUrl='https://mmbiz.qpic.cn/inline-review-integration'
  await page.route(imageUrl, route=>route.fulfill({status:204,body:''}))
  let imported=0
  await page.route('**/api/assets/import-article',route=>{imported++;return route.fulfill({json:[{url:imageUrl,status:'imported'}]})})
  const {original}=await setup(page,1440,900,'dark',{html:source+`<img src="${imageUrl}" alt="fixture">`})
  await page.getByTestId('review-open').click()
  await expect(page.getByTestId('review-bubble')).toBeVisible()
  await page.getByTestId('collect-article-images').click()
  const dialog=page.getByRole('dialog',{name:'收集文中图片'})
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button',{name:'确认加入素材库'}).click()
  await expect(dialog.getByRole('status')).toContainText('新增 1 张')
  expect(imported).toBe(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('review-bubble')).toBeVisible()
  expect(await page.getByTestId('canvas').innerHTML()).toBe(original)
  await page.getByTestId('accept-review').click()
  await expect(page.locator('[data-block-id="review-html"]')).toContainText('Revised heading')
  await expect(page.locator('[data-block-id="review-html"] img')).toHaveAttribute('src',imageUrl)
})
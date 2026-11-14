import { test,expect,type Page } from '@playwright/test'
async function setup(page:Page) {
 await page.setViewportSize({width:1440,height:900})
 await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','dark'))
 const id=`selection-${Date.now()}-${Math.random().toString(36).slice(2)}`,now=Date.now()
 const heading=(id:string,title:string)=>({id,type:'heading',props:{index:'01',title,subtitle:`${title} subtitle`,variant:'auto'}})
 const doc={id,title:'Selection fixture',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[heading('a','Alpha'),heading('b','Beta'),{id:'box',type:'box',props:{title:'Parent box',label:'Group',variant:'paper',children:[heading('child','Nested')]}}]}
 expect((await page.request.put('/api/projects/'+id,{data:doc})).ok()).toBe(true)
 await page.route('**/api/projects',route=>route.fulfill({json:[{id,title:doc.title}]}))
 await page.route('**/api/ai/status',route=>route.fulfill({json:{enabled:true,provider:'openai',model:'fixture',name:'Synthetic',profileId:'fixture'}}))
 await page.route('**/api/ai/suggest-instruction',route=>route.fulfill({json:{suggestion:''}}))
 await page.goto('/');await expect(page.locator('.workspace')).toBeVisible();await expect(page.locator('.title-input')).toHaveValue(doc.title)
}
const pick=(page:Page,id:string,modifiers?:('Control'|'Meta')[])=>page.locator(`.block[data-block-id="${id}"]`).click({position:{x:3,y:3},modifiers})
const clear=(page:Page)=>page.locator('.canvas-scroll').click({position:{x:3,y:3}})

test('AI scope follows each selection after an explicit document override and module values stay live',async({page})=>{
 await setup(page);await pick(page,'a');await page.getByTestId('tab-ai').click()
 const scope=page.getByTestId('ai-edit-scope');await expect(scope).toHaveValue('selection');await expect(scope).toContainText('a')
 await scope.selectOption('document');await pick(page,'b');await expect(scope).toHaveValue('selection');await expect(scope).toContainText('b')
 await clear(page);await expect(scope).toHaveValue('document');await pick(page,'a');await expect(scope).toHaveValue('selection')
 await page.getByTestId('tab-style').click();const title=page.locator('.panel.right').getByLabel('标题',{exact:true})
 await expect(title).toHaveValue('Alpha');await pick(page,'b');await expect(title).toHaveValue('Beta')
 await title.fill('Manual Beta');await expect(page.locator('[data-block-id="b"]')).toContainText('Manual Beta')
 await pick(page,'a');await expect(title).toHaveValue('Alpha');await pick(page,'b');await expect(title).toHaveValue('Manual Beta')
})

test('Ctrl and Cmd toggle a safe multi-selection; Delete is one undo transaction',async({page})=>{
 await setup(page);await pick(page,'a');await pick(page,'b',['Control'])
 await expect(page.locator('.block.selected')).toHaveCount(2);await expect(page.getByTestId('multi-selection-properties')).toContainText('已选 2 个模块')
 await expect(page.locator('.panel.right').getByLabel('标题',{exact:true})).toHaveCount(0)
 await pick(page,'b',['Meta']);await expect(page.locator('.block.selected')).toHaveCount(1)
 await pick(page,'b',['Meta']);await page.keyboard.press('Delete')
 await expect(page.locator('[data-block-id="a"]')).toHaveCount(0);await expect(page.locator('[data-block-id="b"]')).toHaveCount(0)
 await page.keyboard.press('Control+z');await expect(page.locator('[data-block-id="a"]')).toHaveCount(1);await expect(page.locator('[data-block-id="b"]')).toHaveCount(1)
 await expect(page.locator('.block.selected')).toHaveCount(0)
 await page.getByTestId('tab-ai').click();await expect(page.getByTestId('ai-edit-scope')).toHaveValue('document')
})

test('parent-child selection can be removed and undone without orphaned module properties',async({page})=>{
 await setup(page);await pick(page,'box');await pick(page,'child',['Control']);await expect(page.getByTestId('multi-selection-properties')).toBeVisible()
 await page.getByTestId('delete-selected-blocks').click();await expect(page.locator('[data-block-id="box"]')).toHaveCount(0)
 await expect(page.getByTestId('tab-style')).toHaveText('文章');await clear(page);await page.keyboard.press('Control+z')
 await expect(page.locator('[data-block-id="child"]')).toHaveCount(1);await expect(page.locator('.block.selected')).toHaveCount(0)
 await pick(page,'child');await expect(page.locator('.panel.right').getByLabel('标题',{exact:true})).toHaveValue('Nested')
})

test('selection changes invalidate an in-flight response even without document edits',async({page})=>{
 await setup(page);await pick(page,'a');await page.getByTestId('tab-ai').click()
 let release!:()=>void;const pending=new Promise<void>(r=>{release=r});let requests=0
 await page.route('**/api/ai/edit',async route=>{requests++;await pending;await route.fulfill({json:{summary:'Late A',ops:[{op:'update',id:'a',props:{title:'Late overwrite'}}]}})})
 await page.locator('.ai-suggestion-input textarea').fill('Edit selected heading');await page.getByRole('button',{name:'生成修改建议',exact:true}).click()
 await expect.poll(()=>requests).toBe(1);await pick(page,'b');await expect(page.getByTestId('ai-edit-scope')).toContainText('b')
 const response=page.waitForResponse('**/api/ai/edit');release();await (await response).finished()
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
 await expect(page.getByTestId('proposal')).toHaveCount(0);await expect(page.locator('[data-block-id="a"]')).toContainText('Alpha')
 await expect(page.locator('.ai-suggestion-input textarea')).toHaveValue('Edit selected heading')
})

test('multi-selection AI sends only selected blocks and local image command preserves that scope',async({page})=>{
 await setup(page);await pick(page,'a');await pick(page,'b',['Control']);await page.getByTestId('tab-ai').click()
 let body:any
 await page.route('**/api/ai/edit',route=>{body=route.request().postDataJSON();return route.fulfill({json:{summary:'Selected changes',ops:[{op:'update',id:'a',props:{title:'AI Alpha'}},{op:'update',id:'b',props:{title:'AI Beta'}}]}})})
 await page.locator('.ai-suggestion-input textarea').fill('Edit selected headings');await page.getByRole('button',{name:'生成修改建议',exact:true}).click()
 await expect(page.getByTestId('proposal')).toBeVisible();expect(body.context.blocks.map((b:any)=>b.id).sort()).toEqual(['a','b'])
 await page.locator('.ai-suggestion-input textarea').fill('把图片保存到素材库');await page.getByTestId('ai-image-library-command').click()
 const modal=page.getByRole('dialog',{name:'收集文中图片'});await expect(modal).toBeVisible();await expect(modal).toContainText('选中')
 await page.keyboard.press('Escape');await expect(page.getByTestId('proposal')).toBeVisible()
})

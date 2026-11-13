import {test,expect,type Page} from '@playwright/test'
async function setup(page:Page){
 const id=`accessible-${Date.now()}-${Math.random().toString(36).slice(2)}`;const now=Date.now()
 const doc={id,title:'Accessible controls',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[{id:'original',type:'html',props:{label:'Original',html:'<p style="color:#ff0000">Preserved text</p><img src="/media/original.png">'}}]}
 expect((await page.request.put(`/api/projects/${id}`,{data:doc})).ok()).toBeTruthy()
 await page.route('**/api/projects',r=>r.fulfill({json:[{id,title:doc.title}]}))
 await page.route('**/api/assets',r=>r.fulfill({json:[{id:'photo',name:'Synthetic photo',file:'synthetic.png',width:100,height:100,size:10,createdAt:now}]}))
 await page.route('**/api/settings/ai',r=>r.fulfill({json:{activeId:'one',profiles:[{id:'one',name:'One',provider:'openai',baseUrl:'https://example.invalid/v1',model:'model-one',apiKey:'',jsonMode:true},{id:'two',name:'Two',provider:'anthropic',baseUrl:'https://example.invalid/v1',model:'model-two',apiKey:'',jsonMode:true}]}}))
 await page.goto('/');await expect(page.locator('.workspace')).toBeVisible()
}
test('keyboard selects the model editor independently of active model and resizes a named separator',async({page})=>{
 await setup(page)
 const separator=page.getByTestId('resizer-left');await separator.focus();const before=Number(await separator.getAttribute('aria-valuenow'));await page.keyboard.press('ArrowRight');await expect(separator).toHaveAttribute('aria-valuenow',String(before+16));await page.keyboard.press('Home');await expect(separator).toHaveAttribute('aria-valuenow',String(before))
 if(!await page.getByTestId('open-ai-settings').isVisible())await page.getByTestId('toolbar-more').click()
 await page.getByTestId('open-ai-settings').click();await page.getByRole('button',{name:'编辑模型：Two',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByTestId('ai-model')).toHaveValue('model-two')
 await expect(page.getByRole('radio',{name:'设为当前模型：One',exact:true})).toBeChecked();await expect(page.getByRole('group',{name:'接口类型',exact:true}).getByRole('button',{name:'Anthropic Claude'})).toHaveAttribute('aria-pressed','true')
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0)
})
for(const touch of [false,true])test(`native image replacement works with ${touch?'touch':'keyboard'} without deleting text`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:touch?390:1440,height:touch?844:900},hasTouch:touch});const page=await context.newPage()
 try{await setup(page);await page.locator('.block[data-block-id="original"]').click({position:{x:3,y:3}})
 if(touch)await page.getByTestId('workspace-right').tap()
 const choose=page.getByRole('button',{name:'替换第 1 张图片',exact:true});if(touch)await choose.tap();else{await choose.focus();await page.keyboard.press('Space')}
 const asset=page.getByRole('button',{name:'使用素材：Synthetic photo',exact:true});if(touch)await asset.tap();else{await asset.focus();await page.keyboard.press('Enter')}
 if(touch)await page.getByTestId('workspace-canvas').tap()
 await expect(page.locator('[data-block-id="original"] .block-html')).toContainText('Preserved text');await expect(page.locator('[data-block-id="original"] .block-html img')).toHaveAttribute('src',/synthetic.png/)
 }finally{await context.close()}
})

test('component insertion has a keyboard action separate from pointer dragging',async({page})=>{
 await setup(page)
 await page.route('**/api/components',r=>r.fulfill({json:[{id:'accessible-component',schema:1,rev:1,name:'Keyboard component',kind:'heading',role:'',tags:[],block:{id:'component-heading',type:'heading',props:{index:'01',title:'Inserted by keyboard',subtitle:'',variant:'auto'}},fingerprint:'synthetic',palette:[],fixedDecor:0,stats:{texts:1,photos:0,bgPhotos:0,chars:20},text:'Keyboard component',origin:{kind:'original',title:'Synthetic',url:'',account:'',via:'block',attested:true,attestedAt:1,redistributable:true},createdAt:1,updatedAt:1}]}))
 await page.getByTestId('tab-components').click();const insert=page.getByRole('button',{name:'插入组件：Keyboard component',exact:true});await insert.focus();await page.keyboard.press('Space')
 await expect(page.getByTestId('canvas')).toContainText('Inserted by keyboard');await expect(page.locator('.block[data-block-id="original"]')).toContainText('Preserved text')
 await expect(page.getByTestId('component-insert')).toHaveAttribute('role','group')
})

test('Tab reaches the named rich-text import input and remains inside its dialog',async({page})=>{
 await setup(page);await page.getByTestId('open-article-import').click();const pasteTab=page.getByRole('button',{name:'粘贴富文本（公众号 / 秀米）',exact:true});await pasteTab.click();await pasteTab.focus();await page.keyboard.press('Tab');await expect(page.getByRole('textbox',{name:'粘贴文章富文本',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'关闭',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('dark editable source and model JSON use readable UI text rather than metadata sizing',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','dark'));await setup(page);await page.locator('.block[data-block-id="original"]').click({position:{x:3,y:3}});await page.getByRole('button',{name:'编辑 HTML 源码',exact:true}).click();await expect(page.locator('textarea.code')).toHaveCSS('font-size','14px')
 if(!await page.getByTestId('open-ai-settings').isVisible())await page.getByTestId('toolbar-more').click();await page.getByTestId('open-ai-settings').click();await page.getByRole('button',{name:'编辑模型：One',exact:true}).click();await page.locator('.ai-advanced summary').click();await expect(page.getByTestId('ai-extra-body')).toHaveCSS('font-size','14px');await expect(page.getByTestId('ai-extra-body')).toHaveCSS('line-height','22px')
})

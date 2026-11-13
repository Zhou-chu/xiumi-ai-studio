import {test,expect} from '@playwright/test'
test('dark hover and live drop targets use chrome colors without recoloring authored content',async({page})=>{
 const id=`chrome-${Date.now()}`,now=Date.now();const heading=(id:string,title:string)=>({id,type:'heading',props:{index:'01',title,subtitle:'',variant:'auto'}})
 const doc={id,title:'Chrome states',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[heading('top','Top heading'),{id:'box',type:'box',props:{title:'Box',label:'Group',variant:'paper',children:[heading('nested','Nested heading')]}},{id:'original',type:'html',props:{html:'<p style="color:#d6b8dd">Authored violet</p>',label:'Authored'}}]}
 expect((await page.request.put(`/api/projects/${id}`,{data:doc})).ok()).toBeTruthy();await page.route('**/api/projects',r=>r.fulfill({json:[{id,title:doc.title}]}));await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','dark'));await page.goto('/');await expect(page.locator('.workspace')).toBeVisible()
 const top=page.locator('[data-block-id="top"]'),nested=page.locator('[data-block-id="nested"]'),authored=page.locator('[data-block-id="original"] .block-html p')
 await top.hover();await expect(top).toHaveCSS('outline-color','rgb(115, 115, 109)');await nested.hover();await expect(nested).toHaveCSS('outline-color','rgb(115, 115, 109)');await expect(authored).toHaveCSS('color','rgb(214, 184, 221)')
 for(const target of [page.locator('.drop-end'),page.getByTestId('box-drop')]){
  await target.scrollIntoViewIfNeeded();const source=await page.getByTestId('lib-heading').boundingBox();expect(source).not.toBeNull();await page.mouse.move(source!.x+source!.width/2,source!.y+source!.height/2);await page.mouse.down();await page.mouse.move(source!.x+source!.width/2+20,source!.y+source!.height/2,{steps:5});await expect(page.locator('.app')).toHaveClass(/dragging/)
  await target.scrollIntoViewIfNeeded();const destination=await target.boundingBox();expect(destination).not.toBeNull();await page.mouse.move(destination!.x+destination!.width/2,destination!.y+destination!.height/2,{steps:15});await expect(target).toHaveClass(/over/)
  await expect(target).toHaveCSS('border-top-color','rgb(115, 115, 109)');await expect(target).toHaveCSS('color','rgb(236, 236, 230)');await expect(target).toHaveCSS('background-color','rgb(37, 37, 36)');await page.mouse.up();await expect(page.locator('.app')).not.toHaveClass(/dragging/)
 }
 await expect(authored).toHaveCSS('color','rgb(214, 184, 221)');await expect(page.locator('[data-block-id="box"] [data-block-type="heading"]')).toHaveCount(2)
})

import { test, expect } from '@playwright/test'
const dataImage='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="400"%3E%3Crect width="800" height="400" fill="%2388aabb"/%3E%3C/svg%3E'
async function seed(page:import('@playwright/test').Page, html=false) {
  const id='resize-'+Date.now()
  const image={src:'/media/test-resize.png',width:800,height:400}
  await page.route('**/media/test-resize.png*',r=>r.fulfill({contentType:'image/svg+xml',body:decodeURIComponent(dataImage.split(',')[1])}))
  const block=html?{id:'picture',type:'html',props:{label:'HTML图片',html:'<section><img src="/media/test-resize.png" style="width:100%;height:auto"><p>原始文字</p></section>'}}:{id:'picture',type:'image',props:{image,caption:'原始图片',variant:'full'}}
  await page.request.put('/api/projects/'+id,{data:{id,title:'Resize test',author:'',digest:'',themeId:'minimal-magazine',blocks:[block],createdAt:Date.now(),updatedAt:Date.now()}})
  await page.goto('/')
  await expect(page.locator('.title-input')).toHaveValue('Resize test')
  const img=page.locator('[data-block-id="picture"] .block-html img')
  await img.click()
  await expect(page.getByTestId('image-resize-handle')).toBeVisible()
  return {id,img}
}
for(const html of [false,true])test(`drag resize ${html?'imported HTML':'image block'} persists and undoes`,async({page})=>{
  const {id,img}=await seed(page,html)
  const original=(await img.boundingBox())!
  const h=page.getByTestId('image-resize-handle');const box=(await h.boundingBox())!
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-original.width*.4,box.y+box.height/2,{steps:8});await page.mouse.up()
  await expect.poll(async()=> (await img.boundingBox())!.width).toBeLessThan(original.width*.7)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const after=await(await page.request.get('/api/projects/'+id)).json()
  expect(JSON.stringify(after)).not.toContain('image-resize-handle')
  if(html)expect(after.blocks[0].props.html).toContain('60%');else expect(after.blocks[0].props.image.displayWidth).toBeCloseTo(60,0)
  await page.locator('.phone-head').click();await page.keyboard.press('Control+z')
  await expect.poll(async()=> (await img.boundingBox())!.width).toBeGreaterThan(original.width*.95)
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async()=> (await img.boundingBox())!.width).toBeLessThan(original.width*.7)
  await expect(page.getByTestId('save-status')).toHaveText('已保存');await page.reload()
  await expect(page.locator('.title-input')).toHaveValue('Resize test')
  await expect.poll(async()=> (await img.boundingBox())!.width).toBeLessThan(original.width*.7)
})
test('keyboard boundaries, Escape cancellation, and Delete never edit article',async({page})=>{
  const {img}=await seed(page)
  const original=(await img.boundingBox())!.width
  const h=page.getByTestId('image-resize-handle');await h.focus();await page.keyboard.press('Home')
  await expect.poll(async()=> (await img.boundingBox())!.width).toBeLessThan(original*.12)
  await page.keyboard.press('Delete');await expect(img).toHaveCount(1)
  await page.keyboard.press('End');await expect.poll(async()=> (await img.boundingBox())!.width).toBeGreaterThan(original*.95)
  const b=(await h.boundingBox())!;await page.mouse.move(b.x+12,b.y+12);await page.mouse.down();await page.mouse.move(b.x-100,b.y);await page.keyboard.press('Escape');await page.mouse.up()
  await expect.poll(async()=> (await img.boundingBox())!.width).toBeGreaterThan(original*.95)
  await expect(h).not.toBeVisible()
})
test('mobile handle remains accessible and stays outside exported article',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  const {img}=await seed(page)
  const h=page.getByTestId('image-resize-handle');await h.focus();await page.keyboard.press('Shift+ArrowLeft')
  await expect(page.getByTestId('image-resize-overlay')).toBeVisible()
  await expect(page.locator('.article .image-resize-overlay')).toHaveCount(0)
  expect(await img.evaluate(el=>el.clientWidth)).toBeGreaterThan(0)
  await page.screenshot({path:'test-results/image-resize-mobile.png',fullPage:true})
})

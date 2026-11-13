import sharp from 'sharp'
import { expect, test } from '@playwright/test'
const rich = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '图片说明' }] }] }
test('screenshot command collects selected images locally, confirms, and leaves the article unchanged', async ({ page }, testInfo) => {
  const now=Date.now(), id=`image-command-${now}`
  const doc={ id, title: '图片导入测试', author:'', digest:'', themeId:'minimal-magazine', createdAt:now, updatedAt:now, blocks:[
    {id:'chosen',type:'imageText',props:{image:{src:'https://mmbiz.qpic.cn/chosen'},title:'选中图',content:rich,imagePosition:'left'}},
    {id:'other',type:'image',props:{image:{src:'https://mmbiz.qpic.cn/other'},caption:'其他图',variant:'full'}}] }
  await page.request.put(`/api/projects/${id}`,{data:doc})
  let modelCalls=0; const imported:string[]=[]
  await page.route('**/api/ai/**',r=>{if(r.request().method() === 'POST') modelCalls++;return r.fulfill({json:{enabled:false}})})
  await page.route('**/api/assets/import-article',r=>{const urls=r.request().postDataJSON().urls;imported.push(...urls);return r.fulfill({json:urls.map((url:string)=>({url,status:'imported',asset:{id:'new',file:'new.png',name:'原文图片'}}))})})
  await page.goto('/'); await expect(page.locator('.title-input')).toHaveValue(doc.title)
  await page.locator('[data-block-id="chosen"]').first().click()
  await page.getByRole('button',{name:'AI 设计',exact:true}).click()
  await page.getByLabel('AI 修改指令').fill('帮我把原文中的图片加入我们自己的素材库')
  await page.getByTestId('ai-image-library-command').click()
  const dialog=page.getByRole('dialog',{name:'收集文中图片'})
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText('仅选中模块')
  await page.screenshot({path:testInfo.outputPath('image-library-confirmation.png')})
  expect(imported).toEqual([])
  await dialog.getByRole('button',{name:'确认加入素材库'}).click()
  await expect(dialog.getByRole('status')).toContainText('新增 1 张')
  await page.screenshot({path:testInfo.outputPath('image-library-result.png')})
  expect(imported).toEqual(['https://mmbiz.qpic.cn/chosen'])
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).blocks).toEqual(doc.blocks)
  // Status lookup is allowed; no edit/suggestion request is made for the local command.
  expect(modelCalls).toBe(0)
})

test('real import endpoint recognizes existing local assets and reports blocked sources', async ({ request }) => {
  const png=await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer()
  const upload=await request.post('/api/assets',{multipart:{files:{name:'existing.png',mimeType:'image/png',buffer:png}}})
  expect(upload.ok()).toBe(true)
  const [asset]=await upload.json()
  const before=await (await request.get('/api/assets')).json()
  const response=await request.post('/api/assets/import-article',{data:{urls:[`/media/${asset.file}?w=100`,'http://127.0.0.1/private']}})
  expect(response.ok()).toBe(true)
  expect(await response.json()).toMatchObject([{status:'existing',asset:{id:asset.id}},{status:'failed'}])
  expect(await (await request.get('/api/assets')).json()).toEqual(before)
})

test('partial failures are reported and retry imports only the failed image', async ({ page }) => {
  const now=Date.now(),id=`image-partial-${now}`
  await page.request.put(`/api/projects/${id}`,{data:{id,title:'部分失败',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[{id:'gallery',type:'gallery',props:{images:[{src:'https://mmbiz.qpic.cn/one'},{src:'https://mmbiz.qpic.cn/two'}],columns:2,caption:''}}]}})
  const requests:string[]=[]
  await page.route('**/api/assets/import-article',route=>{
    const [url]=route.request().postDataJSON().urls;requests.push(url)
    return route.fulfill({json:[{url,status:url.endsWith('/two') && requests.length===2?'failed':'imported',error:'图片下载失败（HTTP 403）'}]})
  })
  await page.goto('/');await expect(page.locator('.title-input')).toHaveValue('部分失败')
  await page.getByRole('button',{name:'AI 设计',exact:true}).click()
  await page.getByTestId('collect-article-images').click()
  const dialog=page.getByRole('dialog',{name:'收集文中图片'})
  await dialog.getByRole('button',{name:'确认加入素材库'}).click()
  await expect(dialog.getByRole('status')).toContainText('新增 1 张，已存在 0 张，失败或未确认 1 张')
  await dialog.getByRole('button',{name:'重试失败图片'}).click()
  await expect(dialog.getByRole('status')).toContainText('新增 2 张')
  expect(requests).toEqual(['https://mmbiz.qpic.cn/one','https://mmbiz.qpic.cn/two','https://mmbiz.qpic.cn/two'])
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0)
})

test('closing before confirmation performs no imports', async ({ page }) => {
  let imports=0
  await page.route('**/api/assets/import-article',route=>{imports++;return route.fulfill({json:[]})})
  await page.goto('/');await expect(page.locator('.workspace')).toBeVisible()
  await page.getByRole('button',{name:'AI 设计',exact:true}).click()
  await page.getByTestId('collect-article-images').click()
  await expect(page.getByRole('dialog',{name:'收集文中图片'})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog',{name:'收集文中图片'})).toHaveCount(0)
  expect(imports).toBe(0)
})

test('closing while first image is pending stops remaining imports', async ({ page }) => {
  const now=Date.now(), id=`image-cancel-${now}`
  await page.request.put(`/api/projects/${id}`,{data:{id,title:'取消处理中',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[{id:'gallery',type:'gallery',props:{images:[{src:'https://mmbiz.qpic.cn/first'},{src:'https://mmbiz.qpic.cn/second'}],columns:2,caption:''}}]}})
  let release!: () => void
  const pending=new Promise<void>(resolve=>{release=resolve})
  const requests:string[]=[]
  await page.route('**/api/assets/import-article',async route=>{
    const [url]=route.request().postDataJSON().urls; requests.push(url)
    await pending; await route.fulfill({json:[{url,status:'imported'}]})
  })
  await page.goto('/'); await expect(page.locator('.title-input')).toHaveValue('取消处理中')
  await page.getByRole('button',{name:'AI 设计',exact:true}).click()
  await page.getByTestId('collect-article-images').click()
  const dialog=page.getByRole('dialog',{name:'收集文中图片'})
  await dialog.getByRole('button',{name:'确认加入素材库'}).click()
  await expect.poll(()=>requests.length).toBe(1)
  await dialog.getByRole('button',{name:'停止剩余并关闭'}).click()
  await expect(dialog).toHaveCount(0)
  const response=page.waitForResponse('**/api/assets/import-article'); release(); await response
  await page.waitForTimeout(200)
  expect(requests).toEqual(['https://mmbiz.qpic.cn/first'])
})

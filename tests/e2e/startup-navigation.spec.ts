import { expect, test } from '@playwright/test'

test('StrictMode startup creates only one initial document',async({page})=>{
 let writes=0
 await page.route('**/api/projects',route=>route.fulfill({json:[]}))
 await page.route('**/api/projects/*',route=>{
  if(route.request().method()==='PUT'){writes++;return route.fulfill({json:{ok:true,revision:'startup',updatedAt:Date.now()}})}
  return route.continue()
 })
 await page.goto('/')
 await expect(page.locator('.phone')).toBeVisible()
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
 expect(writes).toBe(1)
})

for (const stage of ['list','document']) test(`reload during pending ${stage} response bodies does not persist phantom documents`,async({page})=>{
 const id='navigation-'+Date.now()
 const seed={id,title:'Navigation seed',author:'',digest:'',themeId:'minimal-magazine',blocks:[],createdAt:Date.now(),updatedAt:Date.now()}
 expect((await page.request.put('/api/projects/'+id,{data:seed})).ok()).toBe(true)
 const before=await(await page.request.get('/api/projects')).json()
 await page.addInitScript((stage)=>{
  if(sessionStorage.getItem('navigation-reloaded'))return
  const original=window.fetch
  window.fetch=async(...args)=>{
   const response=await original(...args)
   const url=String(args[0])
   if(stage==='list' ? url==='/api/projects' : url.startsWith('/api/projects/')){
    const json=response.json.bind(response)
    response.json=()=>new Promise((resolve,reject)=>{
     window.addEventListener('pagehide',()=>reject(new DOMException('Body interrupted by navigation','AbortError')),{once:true})
     window.setTimeout(()=>void json().then(resolve,reject),60000)
     document.documentElement.dataset.pendingProjectBody='true'
    })
   }
   return response
  }
 },stage)
 await page.goto('/')
 await expect(page.locator('html')).toHaveAttribute('data-pending-project-body','true')
 await page.evaluate(()=>sessionStorage.setItem('navigation-reloaded','true'))
 await page.reload()
 await expect(page.locator('.title-input')).toHaveValue('Navigation seed')
 await expect(page.locator('.phone')).toBeVisible()
 const after=await(await page.request.get('/api/projects')).json()
 expect(after.map((p:{id:string})=>p.id).sort()).toEqual(before.map((p:{id:string})=>p.id).sort())
})

for (const scenario of ['list-object','list-null','document-object']) test(`invalid startup ${scenario} never creates a project`,async({page})=>{
 let writes=0
 await page.route('**/api/projects',route=>route.fulfill({json:scenario==='list-object'?{}:scenario==='list-null'?null:[{id:'invalid'}]}))
 await page.route('**/api/projects/*',route=>{
  if(route.request().method()==='PUT')writes++
  return route.fulfill({json:{}})
 })
 await page.goto('/')
 await expect(page.locator('.toast')).toContainText('响应格式无效')
 await expect(page.locator('.phone')).toBeVisible()
 expect(writes).toBe(0)
})

test('persisted pageshow resumes pending startup and ignores its stale generation',async({page})=>{
 await page.route('**/api/projects',route=>route.fulfill({json:[{id:'resumed'}]}))
 let writes=0
 await page.route('**/api/projects/*',route=>{
  if(route.request().method()==='PUT')writes++
  return route.fulfill({json:{id:'resumed',title:'Resumed seed',blocks:[]}})
 })
 await page.addInitScript(()=>{
  const original=window.fetch
  let held=false
  window.fetch=async(...args)=>{
   const response=await original(...args)
   if(String(args[0])==='/api/projects'&&!held){
    held=true
    response.json=()=>new Promise(resolve=>{
     window.addEventListener('release-stale-startup',()=>resolve({}),{once:true})
     document.documentElement.dataset.startupHeld='true'
    })
   }
   return response
  }
 })
 await page.goto('/')
 await expect(page.locator('html')).toHaveAttribute('data-startup-held','true')
 await page.evaluate(()=>{
  window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))
  window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))
 })
 await expect(page.locator('.title-input')).toHaveValue('Resumed seed')
 await page.evaluate(()=>window.dispatchEvent(new Event('release-stale-startup')))
 await expect(page.locator('.phone')).toBeVisible()
 await expect(page.locator('.title-input')).toHaveValue('Resumed seed')
 expect(writes).toBe(0)
})

for (const fail of [false,true]) test(`persisted restore reuses an initial write even when it ${fail?'fails':'succeeds'}`,async({page})=>{
 let writes=0
 let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 await page.route('**/api/projects',route=>route.fulfill({json:[]}))
 await page.route('**/api/projects/*',async route=>{
  if(route.request().method()==='PUT'){
   writes++
   await gate
   return route.fulfill({status:fail?503:200,json:fail?{error:'Initial write unavailable'}:{ok:true,revision:'initial-one',updatedAt:Date.now()}})
  }
  return route.continue()
 })
 await page.goto('/')
 await expect.poll(()=>writes).toBe(1)
 await page.evaluate(()=>{
  window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))
  window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))
 })
 release()
 await expect(page.locator('.phone')).toBeVisible()
 await expect(page.getByTestId('save-status')).toHaveText(fail?'保存失败':'已保存')
 expect(writes).toBe(1)
 if(fail) await expect(page.getByTestId('save-status')).toHaveAttribute('title',/Initial write unavailable/)
})

test('pending startup exposes no editable draft and ignores save shortcuts',async({page})=>{
 let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 let started=false
 let writes=0
 await page.route('**/api/projects',async route=>{started=true;await gate;return route.fulfill({json:[{id:'delayed'}]})})
 await page.route('**/api/projects/*',route=>{
  if(route.request().method()==='PUT')writes++
  return route.fulfill({json:{id:'delayed',title:'Loaded safely',blocks:[]}})
 })
 await page.goto('/')
 await expect.poll(()=>started).toBe(true)
 await expect(page.locator('.title-input')).toHaveCount(0)
 await expect(page.getByTestId('lib-paragraph')).toHaveCount(0)
 await expect(page.getByTestId('app-loading')).toHaveAttribute('role','status')
 await page.keyboard.press('Control+s')
 release()
 await expect(page.locator('.title-input')).toHaveValue('Loaded safely')
 await expect(page.getByTestId('app-loading')).toHaveCount(0)
 expect(writes).toBe(0)
})

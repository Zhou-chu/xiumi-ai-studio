import { expect, test } from '@playwright/test'

test('partial variant save can retry without overwriting successful projects', async ({page}) => {
  const id = 'variant-retry-' + Date.now()
  await page.request.put('/api/projects/'+id,{data:{id,title:'Original retained',author:'',digest:'',themeId:'minimal-magazine',blocks:[],createdAt:Date.now(),updatedAt:Date.now()}})
  await page.goto('/')
  await page.getByTestId('open-import').click()
  await page.getByTestId('load-sample').click()
  await page.getByTestId('generate').click()
  await expect(page.getByTestId('save-all-variants')).toBeVisible()
  const counts = new Map<string,number>()
  let failed = false
  await page.route('**/api/projects/*',async route => {
    const req=route.request()
    if(req.method()!=='PUT' || req.url().endsWith('/'+id)) return route.continue()
    const target=req.url().split('/').at(-1)!
    counts.set(target,(counts.get(target)??0)+1)
    if(counts.size===2 && !failed) {
      failed=true
      return route.fulfill({status:503,json:{error:'Temporary variant write failure'}})
    }
    return route.continue()
  })
  await page.getByTestId('save-all-variants').click()
  await expect(page.getByTestId('variant-save-error')).toContainText('Temporary variant write failure')
  await expect(page.locator('.title-input')).toHaveValue('Original retained')
  const first=counts.keys().next().value!
  await page.getByTestId('save-all-variants').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(counts.get(first)).toBe(1)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await page.reload()
  await expect(page.locator('.title-input')).not.toHaveValue('Original retained')
})

test('closing a saving wizard prevents late variant application', async ({page}) => {
  const id='variant-close-'+Date.now()
  await page.request.put('/api/projects/'+id,{data:{id,title:'Keep current editor',author:'',digest:'',themeId:'minimal-magazine',blocks:[],createdAt:Date.now(),updatedAt:Date.now()}})
  await page.goto('/')
  await page.getByTestId('open-import').click()
  await page.getByTestId('load-sample').click()
  await page.getByTestId('generate').click()
  let release!:()=>void
  const gate=new Promise<void>(resolve => {release=resolve})
  let started=false
  let writes=0
  await page.route('**/api/projects/*',async route => {
    const req=route.request()
    if(req.method()!=='PUT'||req.url().endsWith('/'+id)) return route.continue()
    writes++
    started=true
    await gate
    return route.continue()
  })
  await page.getByTestId('save-all-variants').click()
  await expect.poll(()=>started).toBe(true)
  await expect(page.getByTestId('save-all-variants')).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.locator('.title-input').fill('Edited after closing wizard')
  const response=page.waitForResponse(r=>r.request().method()==='PUT'&&!r.url().endsWith('/'+id)&&r.url().includes('/api/projects/'))
  release()
  await response
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await expect(page.locator('.title-input')).toHaveValue('Edited after closing wizard')
  expect(writes).toBe(1)
})

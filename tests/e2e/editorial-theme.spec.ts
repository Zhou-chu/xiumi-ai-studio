import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
const phase = process.env.VISUAL_PHASE || 'after'
const root = 'visual-evidence/' + phase
test('editorial theme baseline and tokens', async ({ page }) => {
  const now = Date.now()
  await page.request.put('/api/projects/editorial-visual-fixture', { data: {
    id: 'editorial-visual-fixture', title: '秋日读书会｜在清华园里，与一本书相遇', author: '读书会筹备组', digest: '关于阅读、分享与共鸣的午后相聚。', themeId: 'minimal-magazine', createdAt: now, updatedAt: now,
    blocks: Array.from({length:12}, (_, i) => ({id:'p'+i,type:'paragraph',props:{content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:i===0?'阅读是私人的，分享让它变得辽阔。':'十月的清华园，银杏初黄。我们在一间安静的教室里，分享各自最近读到的一本书。从一次阅读开始，建立持续的讨论，让每一次相遇都留下真实的记录。'}]}]},align:'left'}}))
  }})
  await page.addInitScript(() => { if(window.top===window) localStorage.setItem('xiumi-color-mode','light') })
  await page.goto('/')
  await page.getByTestId('color-mode-select').selectOption('dark')
  await expect(page.locator('.title-input')).toHaveValue(/秋日读书会/)
  await page.evaluate(() => document.fonts.ready)
  mkdirSync(root,{recursive:true})
  for(const [name,width,height] of [['desktop',1440,900],['tablet',1024,768],['mobile',390,844]] as const) {
    await page.setViewportSize({width,height})
    await page.screenshot({animations:'disabled',path:root+'/'+name+'.png'})
  }
  await page.setViewportSize({width:1440,height:900})
  if(phase==='after') await page.getByTestId('toolbar-more').click()
  await page.getByTestId('open-ai-settings').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  if(phase==='after') {
    await page.evaluate(() => document.fonts.ready)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root: dom } = await cdp.send('DOM.getDocument')
    const evidence: Record<string, unknown> = {}
    for(const [role, selector] of [['sans','[data-testid="open-export"]'],['serif','.modal > header h3']]) {
      const {nodeId} = await cdp.send('DOM.querySelector',{nodeId:dom.nodeId,selector})
      const {fonts} = await cdp.send('CSS.getPlatformFontsForNode',{nodeId})
      evidence[role] = fonts
      expect(fonts.some(f => f.isCustomFont && f.glyphCount > 0 && f.familyName.includes(role==='sans'?'Noto Sans SC':'Noto Serif SC'))).toBe(true)
    }
    writeFileSync(root+'/rendered-fonts.json',JSON.stringify(evidence,null,2))
    await cdp.detach()
  }
  await page.screenshot({animations:'disabled',path:root+'/settings.png'})
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  // Actual failed save response exercises existing failure feedback without changing production data.
  await page.route('**/api/projects/editorial-visual-fixture', route => route.request().method()==='PUT'
    ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'保存服务暂时不可用，请重试。'})}) : route.continue())
  await page.locator('.title-input').fill('长文稿｜保存失败时保留未保存内容与清晰反馈')
  await expect(page.getByTestId('save-status')).toHaveText('保存失败')
  await page.screenshot({animations:'disabled',path:root+'/save-error.png'})
  if(phase==='after') {
    await expect(page.locator('.toolbar')).toHaveCSS('background-color','rgb(27, 27, 26)')
    await expect(page.getByTestId('open-export')).toHaveCSS('background-color','rgb(236, 236, 230)')
    await expect(page.getByTestId('open-export')).toHaveCSS('color','rgb(20, 20, 20)')
    await expect(page.locator('.phone')).toHaveCSS('background-color','rgb(255, 255, 255)')
  }
})

test('editorial chrome never changes authored HTML typography or export', async ({page}) => {
  const id = 'editorial-isolation'
  const now = Date.now()
  await page.request.put('/api/projects/'+id, {data:{id,title:'作品隔离验证',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[{id:'html1',type:'html',props:{label:'作者内容',html:'<section><div class="modal"><header><h3>作者标题</h3></header><div class="modal-body"><p class="hint">作者自己的字体与间距</p><button class="primary">内容按钮</button></div></div><div class="toolbar"><span class="brand">内容品牌</span></div><div class="workspace"><div class="panel">作者面板</div></div></section>'}}]}})
  await page.addInitScript(() => { if(window.top===window) localStorage.setItem('xiumi-color-mode','light') })
  await page.goto('/')
  await page.setViewportSize({width:390,height:844})
  const article = page.locator('.block-html').first()
  const signature = () => article.evaluate(el => Array.from(el.querySelectorAll('*')).map(node => {
    const s=getComputedStyle(node)
    return [node.tagName,s.fontFamily,s.fontSize,s.lineHeight,s.color,s.backgroundColor,s.padding,s.display,s.borderRadius,s.transform]
  }))
  const light = await signature()
  const html = await article.innerHTML()
  await page.getByTestId('color-mode-select').selectOption('dark')
  expect(await signature()).toEqual(light)
  expect(await article.innerHTML()).toBe(html)
  await page.getByTestId('open-preview').click()
  const preview = await page.getByTestId('preview-frame').getAttribute('srcdoc')
  await page.keyboard.press('Escape')
  await page.getByTestId('toolbar-more').click()
  await page.getByTestId('color-mode-select').selectOption('light')
  await page.getByTestId('open-preview').click()
  expect(await page.getByTestId('preview-frame').getAttribute('srcdoc')).toBe(preview)
})

test('model discovery retains actual backend failure feedback', async ({page}) => {
  await page.addInitScript(() => { if(window.top===window) localStorage.setItem('xiumi-color-mode','dark') })
  await page.goto('/')
  await page.getByTestId('toolbar-more').click()
  await page.getByTestId('open-ai-settings').click()
  await page.getByTestId('ai-add-preset').selectOption('custom')
  await page.getByLabel('接口地址 Base URL').fill('http://127.0.0.1:9/v1')
  const response = page.waitForResponse(r => r.url().endsWith('/api/settings/ai/models'))
  await page.getByTestId('ai-load-models').click()
  expect((await response).ok()).toBe(false)
  await expect(page.getByTestId('ai-model-note')).toContainText('可继续手动填写')
  await expect(page.getByTestId('ai-load-models')).toBeEnabled()
  await page.getByTestId('ai-model').fill('manual-local-model')
  await expect(page.getByTestId('ai-model')).toHaveValue('manual-local-model')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({animations:'disabled',path:'visual-evidence/after/model-discovery-real-failure.png'})
  await page.keyboard.press('Escape')
})

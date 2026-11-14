import { expect, test, type Page, type Locator } from '@playwright/test'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { THEMES } from '../../src/core/themes'

async function setup(page: Page, html: boolean | string = false, width = 1440) {
  await page.setViewportSize({width,height:900})
  const id = `fonts-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const block = html ? createBlock('html', { html: typeof html === 'string' ? html : '<p>alpha <strong>bold</strong></p><p><img src="/media/missing.png">omega</p>', label: 'Font fixture' }) : createBlock('paragraph', { content: { type:'doc', content:[{type:'paragraph',content:[{type:'text',text:'alpha beta gamma'}]}] } })
  block.id = 'font-block'
  const doc = { id, title:'Typography fixture', author:'',digest:'',themeId:'minimal-magazine',createdAt:Date.now(),updatedAt:Date.now(),blocks:[block] }
  expect((await page.request.put('/api/projects/'+id,{data:doc})).ok()).toBe(true)
  await page.route('**/api/projects',r=>r.fulfill({json:[{id,title:doc.title}]}))
  await page.goto('/')
  await expect(page.locator('.title-input')).toHaveValue(doc.title)
  await page.locator('[data-block-id="font-block"]').dblclick()
  const editor = page.locator(html ? '.html-editor' : '.tiptap')
  await expect(editor).toBeVisible()
  return {id,editor}
}
async function selectText(editor: Locator, start: number, end: number) {
  await editor.evaluate((root,{start,end})=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); const nodes:Text[]=[]
    while(walker.nextNode()) nodes.push(walker.currentNode as Text)
    const point=(offset:number):[Text,number]=>{for(const n of nodes){if(offset<=n.length)return[n,offset];offset-=n.length}return[nodes.at(-1)!,nodes.at(-1)!.length]}
    const a=point(start),b=point(end),range=document.createRange();range.setStart(...a);range.setEnd(...b)
    ;(root as HTMLElement).focus();const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'))
  },{start,end})
}
async function alphaColor(editor: Locator) {
  return editor.evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) if (walker.currentNode.textContent?.includes('alpha')) return getComputedStyle(walker.currentNode.parentElement!).color
    throw new Error('Expected alpha text node')
  })
}
test('imported HTML selection typography preserves structure, images, native undo and saved export',async({page})=>{
  const {id,editor}=await setup(page,true)
  await expect(page.getByLabel('原文字号',{exact:true})).toBeDisabled()
  await selectText(editor,2,13)
  await page.getByLabel('原文字号',{exact:true}).selectOption('24px')
  await expect(editor.locator('span[style*="24px"]').first()).toBeVisible()
  await page.getByLabel('原文字体',{exact:true}).selectOption('Arial, sans-serif')
  await expect(editor.locator('span[style*="Arial"]').first()).toBeVisible()
  await editor.press('Control+z')
  await expect(editor.locator('span[style*="Arial"]')).toHaveCount(0)
  await expect(editor.locator('img')).toHaveCount(1)
  await expect(editor.locator('strong')).toHaveText('bold')
  await expect(editor.locator('p')).toHaveCount(2)
  await editor.press('Control+z')
  await expect(editor.locator('span[style*="24px"]')).toHaveCount(0)
  await editor.press('Control+Shift+z')
  await expect(editor.locator('span[style*="24px"]').first()).toBeVisible()
  await page.locator('.rich-toolbar .done').click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const saved=await (await page.request.get('/api/projects/'+id)).json()
  expect(saved.blocks[0].props.html).toContain('24px')
  expect(compileDoc(saved).html).toContain('24px')
})
test('imported HTML marks and colors preserve other content and native undo', async ({page}) => {
  const {id,editor}=await setup(page,true)
  await selectText(editor,0,5)
  await page.getByRole('button',{name:'原文加粗',exact:true}).click()
  await page.getByRole('button',{name:'原文斜体',exact:true}).click()
  await page.getByRole('button',{name:'原文下划线',exact:true}).click()
  const beforeColor = await alphaColor(editor)
  expect(beforeColor).not.toBe('rgb(18, 52, 86)')
  await page.getByTestId('html-text-color').click()
  await page.getByTestId('html-text-color-custom').fill('#123456')
  expect(await alphaColor(editor)).toBe('rgb(18, 52, 86)')
  await editor.press('Control+z')
  expect(await alphaColor(editor)).toBe(beforeColor)
  await editor.press('Control+Shift+z')
  expect(await alphaColor(editor)).toBe('rgb(18, 52, 86)')
  await expect(editor.locator('img')).toHaveCount(1)
  await page.locator('.rich-toolbar .done').click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const saved=await (await page.request.get('/api/projects/'+id)).json()
  expect(compileDoc(saved).html).toContain('#123456')
})
test('HTML table selection refuses crossing cells and stale selection instead of damaging content', async ({page}) => {
  const {editor}=await setup(page,'<table><tbody><tr><td>one</td><td>two</td></tr></tbody></table>')
  const before=await editor.innerHTML()
  await selectText(editor,1,5)
  await page.getByLabel('原文字号',{exact:true}).selectOption('24px')
  await expect(page.getByRole('status').filter({hasText:'同一个文本区域'})).toBeVisible()
  expect(await editor.innerHTML()).toBe(before)
  await selectText(editor,0,3)
  await page.getByLabel('原文字号',{exact:true}).selectOption('24px')
  await expect(editor.locator('td').first().locator('span')).toHaveCSS('font-size','24px')
  await expect(editor.locator('td')).toHaveCount(2)
  await selectText(editor,0,3)
  await editor.evaluate(root=>root.setAttribute('data-change','x'))
  await editor.evaluate(root=>root.querySelector('td')!.append('!'))
  await page.getByLabel('原文字号',{exact:true}).selectOption('32px')
  expect(await editor.innerHTML()).not.toContain('32px')
})

test('HTML toolbar refuses replaced nodes and SVG, and explicitly sets template color on phone', async ({ page }) => {
  const { editor } = await setup(page, '<p style="color:#123456">alpha beta</p><svg><text>ART</text><foreignObject><p>caption</p></foreignObject></svg>', 390)
  await selectText(editor, 0, 5)
  await editor.evaluate(root => { const snapshot = root.innerHTML; root.innerHTML = snapshot })
  await page.getByRole('button', { name: '原文加粗', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '选区已变化' })).toBeVisible()
  await selectText(editor, 0, 20)
  const before = await editor.innerHTML()
  await page.getByRole('button', { name: '原文斜体', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '同一个文本区域' })).toBeVisible()
  expect(await editor.innerHTML()).toBe(before)
  await selectText(editor, 0, 5)
  await page.getByTestId('html-text-color').click()
  await page.getByRole('button', { name: '使用当前模板正文色', exact: true }).click()
  const templateColor = THEMES.find(theme => theme.id === 'minimal-magazine')!.colors.text
  const normalizedTemplateColor = await page.evaluate(color => { const probe = document.createElement('span'); probe.style.color = color; document.body.append(probe); const computed = getComputedStyle(probe).color; probe.remove(); return computed }, templateColor)
  expect(await alphaColor(editor)).toBe(normalizedTemplateColor)
  await expect(editor.locator('svg')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

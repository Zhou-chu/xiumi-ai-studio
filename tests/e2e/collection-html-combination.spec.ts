import { expect,test } from '@playwright/test'
import { createBlock,normalizeBlocks } from '../../src/core/blocks'

test('selected article images collect locally before HTML proposal acceptance and persistence',async({page},testInfo)=>{
 const id=`combined-${Date.now()}-${Math.random().toString(36).slice(2)}`,title='收图与原文重排连续验收'
 const html='<div><h2>保留章节标题</h2><p>保留原文文字与图片</p><img src="https://img.xiumi.us/combined-html" alt="原文图片"><h2>第二章节</h2><p>保留结尾</p></div>'
 const blocks=[{...createBlock('html',{html,label:'原文'}),id:'source'},{...createBlock('image',{image:{src:'https://img.xiumi.us/combined-image'}}),id:'photo'}]
 expect(JSON.stringify(normalizeBlocks(blocks))).toBe(JSON.stringify(blocks))
 expect((await page.request.put(`/api/projects/${id}`,{data:{id,title,themeId:'minimal-magazine',blocks,createdAt:1,updatedAt:1}})).ok()).toBe(true)
 await page.route('**/api/projects',r=>r.fulfill({json:[{id,title}]}))
 await page.route('**/api/ai/status',r=>r.fulfill({json:{enabled:true,name:'Synthetic',model:'synthetic'}}))
 await page.route('https://img.xiumi.us/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#777"/></svg>'}))
 let edits=0;const imports:string[]=[]
 await page.route('**/api/assets/import-article',r=>{const urls:string[]=r.request().postDataJSON().urls;imports.push(...urls);return r.fulfill({json:urls.map(url=>({url,status:'imported'}))})})
 await page.route('**/api/ai/edit',r=>{edits++;const body=r.request().postDataJSON();expect([...body.selectedIds].sort()).toEqual(['photo','source']);return r.fulfill({json:{summary:'所选原文按章重排',ops:[{op:'update',id:'source',themeId:'tsinghua-purple',layout:'chapters'}]}})})
 await page.goto('/');await expect(page.locator('.title-input')).toHaveValue(title)
 await page.locator('[data-block-id="source"] .block-html').click()
 await page.locator('[data-block-id="photo"] .block-html').click({modifiers:['Control']})
 await expect(page.getByRole('group',{name:'模块选择'})).toContainText('已选 2 个模块')
 await page.getByTestId('tab-ai').click()
 await page.getByLabel('AI 修改指令').fill('把所选模块图片加入素材库，不要修改正文')
 await page.getByRole('button',{name:'收集图片到素材库',exact:true}).click()
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('发现 2 张');expect(imports).toHaveLength(0);expect(edits).toBe(0)
 await dialog.getByRole('button',{name:'确认加入素材库',exact:true}).click();await expect(dialog).toContainText('新增 2 张');expect([...imports].sort()).toEqual(['https://img.xiumi.us/combined-html','https://img.xiumi.us/combined-image'])
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();expect(edits).toBe(0)
 expect((await(await page.request.get(`/api/projects/${id}`)).json()).blocks).toEqual(blocks)
 await page.getByLabel('AI 修改指令').fill('所选原文按清华紫重新分章，保留文字和图片')
 await page.getByRole('button',{name:'生成修改建议',exact:true}).click()
 const suggestion=page.locator('.review-suggestion');await expect(suggestion.frameLocator('iframe').locator('[data-layout-chapter]')).toHaveCount(2)
 await suggestion.getByRole('button',{name:'接受',exact:true}).click()
 await expect(page.locator('[data-block-id="source"] [data-article-layout="chapters"]')).toHaveCount(1)
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
 const saved=await(await page.request.get(`/api/projects/${id}`)).json();expect(saved.blocks[0].props.html).toContain('保留原文文字与图片');expect(saved.blocks[0].props.html).toContain('https://img.xiumi.us/combined-html');expect(saved.blocks[1]).toEqual(blocks[1]);expect(edits).toBe(1)
 await page.reload();await expect(page.locator('.title-input')).toHaveValue(title);await expect(page.locator('[data-block-id="source"] [data-layout-chapter]')).toHaveCount(2)
 await expect(page.locator('[data-block-id="photo"] img')).toHaveAttribute('src',/combined-image/)
 const path=testInfo.outputPath('collection-then-html-reloaded.png');await page.screenshot({path});await testInfo.attach('collection-then-html-reloaded',{path,contentType:'image/png'})
})

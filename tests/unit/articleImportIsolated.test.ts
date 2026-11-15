// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Block, Doc } from '../../src/core/types'
import type { ImportedArticle } from '../../src/core/wxImport'
import type { Asset } from '../../src/editor/api'

const h=vi.hoisted(()=>({
  fetchArticle:vi.fn(), assets:vi.fn(), template:vi.fn(), saveTheme:vi.fn(), component:vi.fn(),
  beforeLeave:vi.fn(), save:vi.fn(), navigate:vi.fn(), toast:vi.fn(), refreshThemes:vi.fn(), fluidize:vi.fn(),
  analyze:vi.fn(),createTheme:vi.fn(),registerTheme:vi.fn(),pieces:vi.fn(),draft:vi.fn(),
  extract:vi.fn(), toBlocks:vi.fn(), markdown:vi.fn(), wizard:vi.fn(), doc:null as unknown as Doc,
  unexpected:()=>{ throw Error('Unexpected ArticleImport boundary invocation') },
}))
vi.mock('../../src/editor/api',()=>({
  api:{ fetchArticle:h.fetchArticle, fetchAssets:h.assets, saveTemplate:h.template, saveTheme:h.saveTheme, saveComponent:h.component },
  assetRef:(a:Asset)=>({ src:'/media/'+a.file, assetId:a.id }),
}))
vi.mock('../../src/editor/store',()=>({
  useStore:{getState:()=>({doc:h.doc,notify:h.toast,refreshThemes:h.refreshThemes})},
  saveBeforeLeave:h.beforeLeave,saveNow:h.save,
}))
vi.mock('../../src/editor/documentNavigation',()=>({loadIfUnchanged:h.navigate}))
vi.mock('../../src/core/wxImport',()=>({
  extractArticle:h.extract, articleToHtmlBlocks:h.toBlocks, articleToMarkdown:h.markdown, cardContent:new WeakMap(),
}))
vi.mock('../../src/editor/fluidize',()=>({fluidizeArticle:h.fluidize}))
vi.mock('../../src/editor/ImportWizard',()=>({
  ImportWizard:(props: {initialText:string;initialImages:Asset[]})=>{
    h.wizard(props)
    return createElement('output',{'data-testid':'wizard-boundary'},props.initialText)
  },
}))
vi.mock('../../src/editor/Modal',()=>({
  Modal:({children,onClose}:{children:ReactNode;onClose:()=>void})=>createElement('section',{},createElement('button',{'aria-label':'关闭导入',onClick:onClose}),children),
}))
vi.mock('../../src/core/compiler',()=>({compileDoc:()=>({html:'<p>合成预览</p>'})}))
vi.mock('../../src/core/styleExtract',()=>({analyzeStyle:h.analyze,themeFromReport:h.createTheme}))
vi.mock('../../src/core/themes',async importOriginal=>({...await importOriginal<typeof import('../../src/core/themes')>(),registerTheme:h.registerTheme}))
vi.mock('../../src/core/components',async importOriginal=>({...await importOriginal<typeof import('../../src/core/components')>(),makeDraft:h.draft}))
vi.mock('../../src/core/fragments',()=>({componentPieces:h.pieces}))

import { ArticleImportModal } from '../../src/editor/ArticleImport'

let host: HTMLDivElement
let root: Root
const close=vi.fn()
const html='<section id="js_content"><p>合成正文</p></section>'
const url='https://fictional-article.invalid/story'
const article=(patch:Partial<ImportedArticle>={}):ImportedArticle=>{
  const body=new DOMParser().parseFromString(html,'text/html').querySelector('section')!
  return {root:body,title:'合成标题',author:'作者',account:'合成账号',digest:'合成摘要',cover:'',
    source:{kind:'wechat',title:'合成标题',url,account:'合成账号'},...patch}
}
const doc=(id:string):Doc=>({id,title:'当前草稿',author:'',digest:'',themeId:'fixture',blocks:[],createdAt:1,updatedAt:1})
const block:Block<'html'>={type:'html',id:'fragment',props:{html:'<p>合成正文</p>',label:'合成文本'}}
const asset=(id:string):Asset=>({id,file:id+'.jpg',name:id,width:10,height:10,size:12,createdAt:1})
const by=<T extends HTMLElement=HTMLButtonElement>(id:string)=>host.querySelector<T>(`[data-testid="${id}"]`)!
const named=(label:string)=>[...host.querySelectorAll('button')].find(button=>button.textContent?.trim()===label)!
const press=async(element:HTMLElement)=>{expect(element).toBeTruthy();await act(async()=>element.click())}
const mount=async()=>{await act(async()=>root.render(createElement(ArticleImportModal,{onClose:close})))}
const input=(element:HTMLInputElement,value:string)=>act(()=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value)
  element.dispatchEvent(new Event('input',{bubbles:true}))
})
const fetchPreview=async()=>{
  h.fetchArticle.mockResolvedValueOnce({html})
  h.extract.mockReturnValueOnce(article())
  input(by<HTMLInputElement>('article-url'),url)
  await press(named('抓取'))
}
const authorize=()=>press(by('article-authorized'))
const templateToggle=()=>[...host.querySelectorAll('label.check')].find(label=>label.textContent?.trim()==='同时保存为模板')!.querySelector('input')!

beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('fetch',vi.fn(h.unexpected))
  for(const f of [h.fetchArticle,h.assets,h.template,h.saveTheme,h.component,h.beforeLeave,h.save,h.navigate,h.extract,h.markdown,h.analyze,h.createTheme,h.registerTheme,h.pieces,h.draft]) f.mockReset().mockImplementation(h.unexpected)
  for(const f of [h.toast,h.refreshThemes,h.fluidize,h.wizard,close])f.mockReset()
  h.toBlocks.mockReset().mockReturnValue([block])
  h.doc=doc('expected')
  host=document.createElement('div'); document.body.append(host); root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})

it('normalizes the source URL and previews the synthetically returned article without saving it',async()=>{
  await mount()
  expect(named('抓取').disabled).toBe(true)
  h.fetchArticle.mockResolvedValueOnce({html}); h.extract.mockReturnValueOnce(article())
  input(by<HTMLInputElement>('article-url'),' '+url+' ')
  await press(named('抓取'))
  expect(h.fetchArticle).toHaveBeenCalledExactlyOnceWith(url)
  expect(h.extract.mock.calls[0][0].querySelector('#js_content')?.textContent).toBe('合成正文')
  expect(h.extract.mock.calls[0][1]).toBe(url)
  expect(host.textContent).toContain('合成预览')
  expect(host.textContent).toContain('合成账号')
  expect(by('source-wechat').classList.contains('on')).toBe(true)
  expect(by('article-import').disabled).toBe(true)
  expect(h.template).not.toHaveBeenCalled()
  expect(h.beforeLeave).not.toHaveBeenCalled()
})

it('offers paste instead of treating a returned verification page as an article',async()=>{
  await mount()
  h.fetchArticle.mockResolvedValueOnce({html:'<p>请在微信客户端打开文章</p>'})
  input(by<HTMLInputElement>('article-url'),url)
  await press(named('抓取'))
  expect(h.extract).not.toHaveBeenCalled()
  expect(h.toast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('粘贴富文本'),'error')
  expect(by('article-import')).toBeNull()
})

it('leaves plain-text paste alone and uses the controlled rich-text article and geometry boundaries',async()=>{
  await mount(); await press(named('粘贴富文本（公众号 / 秀米）'))
  const paste=by('article-paste')
  const dispatch=(value:string)=>{
    const event=new Event('paste',{bubbles:true,cancelable:true})
    Object.defineProperty(event,'clipboardData',{value:{getData:()=>value}})
    act(()=>paste.dispatchEvent(event))
    return event
  }
  expect(dispatch('').defaultPrevented).toBe(false)
  expect(h.extract).not.toHaveBeenCalled()
  const recognized=article({title:'剪贴板标题'})
  h.extract.mockReturnValueOnce(recognized)
  expect(dispatch(html).defaultPrevented).toBe(true)
  expect(h.fluidize).toHaveBeenCalledExactlyOnceWith(recognized.root)
  expect(host.querySelector<HTMLInputElement>('input[placeholder="模板名称"]')?.value).toBe('剪贴板标题')
  expect(by('article-import').disabled).toBe(true)
})

it('blocks import until usage confirmation and passes overridden source kind to the synthetic template and project',async()=>{
  await mount(); await fetchPreview()
  await press(by('article-import'))
  expect(h.template).not.toHaveBeenCalled()
  await authorize(); await press(by('source-original'))
  h.template.mockResolvedValueOnce({}); h.beforeLeave.mockResolvedValueOnce(true)
  h.navigate.mockReturnValueOnce(true); h.save.mockResolvedValueOnce(true)
  const changed=vi.fn(); window.addEventListener('templates-changed',changed)
  try { await press(by('article-import')) } finally { window.removeEventListener('templates-changed',changed) }
  const imported=expect.objectContaining({title:'合成标题',digest:'合成摘要',blocks:[expect.objectContaining({props:expect.objectContaining({source:{kind:'original',title:'合成标题',url,account:'合成账号'}})})]})
  expect(h.template).toHaveBeenCalledExactlyOnceWith('合成标题',expect.any(Array),imported)
  expect(h.navigate).toHaveBeenCalledExactlyOnceWith(imported,h.doc)
  expect(h.save).toHaveBeenCalledOnce();expect(changed).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('skips template save when disabled and never navigates if the current draft cannot be saved',async()=>{
  await mount(); await fetchPreview(); await authorize(); await press(templateToggle())
  h.beforeLeave.mockResolvedValueOnce(false)
  await press(by('article-import'))
  expect(h.template).not.toHaveBeenCalled()
  expect(h.beforeLeave).toHaveBeenCalledOnce()
  expect(h.navigate).not.toHaveBeenCalled()
  expect(h.save).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it('keeps already completed template storage but never replaces a draft changed during save-before-leaving',async()=>{
  await mount(); await fetchPreview(); await authorize()
  h.template.mockResolvedValueOnce({})
  let release!:(ok:boolean)=>void
  h.beforeLeave.mockImplementationOnce(()=>new Promise<boolean>(resolve=>{release=resolve}))
  await press(by('article-import'))
  expect(h.template).toHaveBeenCalledOnce()
  expect(h.beforeLeave).toHaveBeenCalledOnce()
  h.doc=doc('later-edited')
  await act(async()=>release(true))
  expect(h.navigate).not.toHaveBeenCalled()
  expect(h.save).not.toHaveBeenCalled()
  expect(h.toast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('当前文稿未替换'))
  expect(close).not.toHaveBeenCalled()
})

it('passes recognized Markdown and mapped synthetic assets to relayout rather than replacing the project',async()=>{
  await mount(); await fetchPreview(); await authorize(); await press(by('mode-relayout'))
  const one='https://fixture.invalid/one.jpg', two='https://fixture.invalid/two.jpg'
  h.markdown.mockReturnValueOnce({markdown:`![](${one})\n![](${two})`,images:[one,two]})
  h.assets.mockResolvedValueOnce({[one]:asset('local-one')})
  await press(by('article-import'))
  expect(h.assets).toHaveBeenCalledExactlyOnceWith([one,two])
  expect(by('wizard-boundary').textContent).toBe(`![](/media/local-one.jpg)\n![](${two})`)
  expect(h.wizard).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({initialImages:[asset('local-one')]}))
  expect(h.template).not.toHaveBeenCalled()
  expect(h.beforeLeave).not.toHaveBeenCalled()
  expect(h.navigate).not.toHaveBeenCalled()
})

function pendingArticle() {
  let resolve!:(value:{html:string})=>void
  let reject!:(error:Error)=>void
  const promise=new Promise<{html:string}>((done,fail)=>{resolve=done;reject=fail})
  return {promise,resolve,reject}
}
const enterUrl=()=>act(()=>by('article-url').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})))

it('does not start another article request when Enter is repeated during a pending fetch',async()=>{
  const pending=pendingArticle()
  h.fetchArticle.mockReturnValue(pending.promise)
  await mount(); input(by<HTMLInputElement>('article-url'),url)
  enterUrl(); enterUrl()
  const sent=h.fetchArticle.mock.calls.length
  h.extract.mockReturnValue(article())
  await act(async()=>pending.resolve({html}))
  expect(sent).toBe(1)
})

it('does not replace the new URL field with a reply for an older edit',async()=>{
  const pending=pendingArticle()
  h.fetchArticle.mockReturnValueOnce(pending.promise)
  h.extract.mockReturnValueOnce(article({title:'旧等待响应'}))
  await mount();input(by<HTMLInputElement>('article-url'),url);await press(named('抓取'))
  const different='https://fictional-article.invalid/newer'
  input(by<HTMLInputElement>('article-url'),different)
  await act(async()=>pending.resolve({html}))
  expect(h.extract).not.toHaveBeenCalled()
  expect(by<HTMLInputElement>('article-url')?.value).toBe(different)
  expect(by('article-import')).toBeNull()
})

it('does not notify from a failed stale fetch after closing the article modal',async()=>{
  const pending=pendingArticle()
  h.fetchArticle.mockReturnValueOnce(pending.promise)
  await mount(); input(by<HTMLInputElement>('article-url'),url); await press(named('抓取'))
  await press(host.querySelector<HTMLButtonElement>('button[aria-label="关闭导入"]')!)
  await act(async()=>root.render(null))
  await act(async()=>pending.reject(new Error('作废请求')))
  expect(close).toHaveBeenCalledOnce()
  expect(h.toast).not.toHaveBeenCalled()
})

it('requires new usage confirmation after choosing a different article',async()=>{
  await mount(); await fetchPreview(); await authorize()
  expect(by('article-import').disabled).toBe(false)
  await press(named('重新选择'))
  const another='https://fictional-article.invalid/next'
  h.fetchArticle.mockResolvedValueOnce({html})
  h.extract.mockReturnValueOnce(article({title:'另一篇文章'}))
  input(by<HTMLInputElement>('article-url'),another)
  await press(named('抓取'))
  expect(host.querySelector<HTMLInputElement>('input[placeholder="模板名称"]')?.value).toBe('另一篇文章')
  expect(by<HTMLInputElement>('article-authorized').checked).toBe(false)
  expect(by('article-import').disabled).toBe(true)
})

it('discards an old response even after URL editing returns to its original value',async()=>{
  const pending=pendingArticle()
  h.fetchArticle.mockReturnValueOnce(pending.promise)
  h.extract.mockReturnValueOnce(article())
  await mount(); input(by<HTMLInputElement>('article-url'),url); await press(named('抓取'))
  input(by<HTMLInputElement>('article-url'),'https://fictional-article.invalid/intermediate')
  input(by<HTMLInputElement>('article-url'),url)
  await act(async()=>pending.resolve({html}))
  expect(h.extract).not.toHaveBeenCalled()
  expect(by<HTMLInputElement>('article-url').value).toBe(url)
  expect(named('抓取').disabled).toBe(false)
})

it('preserves newer pasted content when an older link request settles after switching tabs',async()=>{
  const pending=pendingArticle()
  h.fetchArticle.mockReturnValueOnce(pending.promise)
  h.extract.mockReturnValueOnce(article({title:'新粘贴文章'})).mockReturnValueOnce(article({title:'旧链接文章'}))
  await mount(); input(by<HTMLInputElement>('article-url'),url); await press(named('抓取'))
  await press(named('粘贴富文本（公众号 / 秀米）'))
  const paste=new Event('paste',{bubbles:true,cancelable:true})
  Object.defineProperty(paste,'clipboardData',{value:{getData:()=>html}})
  act(()=>by('article-paste').dispatchEvent(paste))
  expect(paste.defaultPrevented).toBe(true)
  await act(async()=>pending.resolve({html}))
  expect(h.extract).toHaveBeenCalledOnce()
  expect(host.querySelector<HTMLInputElement>('input[placeholder="模板名称"]')?.value).toBe('新粘贴文章')
  expect(by('article-import').disabled).toBe(true)
})


const manyImages=()=>Array.from({length:61},(_,i)=>`https://img.xiumi.us/qa-synthetic/${i}.jpg`)
const imagesBlock=(urls:string[]):Block<'html'>=>({...block,props:{...block.props,html:urls.map(u=>'<img src="'+u+'">').join('')}})
const checkOption=(label:string)=>[...host.querySelectorAll('label.check')].find(x=>x.textContent?.includes(label))!.querySelector('input')!
const successfulNavigation=()=>{
  h.beforeLeave.mockResolvedValueOnce(true)
  h.navigate.mockReturnValueOnce(true)
  h.save.mockResolvedValueOnce(true)
}

it('imports image batches and a separate cover with partial failures and preserves missing URLs',async()=>{
  const urls=manyImages(), cover='https://fixture.invalid/cover.jpg'
  h.toBlocks.mockReturnValue([imagesBlock(urls)])
  await mount()
  h.fetchArticle.mockResolvedValueOnce({html});h.extract.mockReturnValueOnce(article({cover}))
  input(by<HTMLInputElement>('article-url'),url);await press(named('抓取'));await authorize();await press(templateToggle())
  h.assets.mockResolvedValueOnce({[urls[0]]:asset('local-body')})
    .mockRejectedValueOnce(Error('synthetic image unavailable')).mockResolvedValueOnce({[cover]:asset('local-cover')})
  successfulNavigation()
  const changed=vi.fn();window.addEventListener('assets-changed',changed)
  try { await press(by('article-import')) } finally { window.removeEventListener('assets-changed',changed) }
  expect(h.assets.mock.calls).toEqual([[urls.slice(0,60)],[urls.slice(60)],[ [cover] ]])
  const result=h.navigate.mock.calls[0][0] as Doc
  expect(result.cover).toEqual({src:'/media/local-cover.jpg',assetId:'local-cover'})
  const body=(result.blocks[0] as Block<'html'>).props.html
  expect(body).toContain('/media/local-body.jpg')
  expect(body).not.toContain(urls[0])
  expect(body).toContain(urls[60])
  expect(changed).toHaveBeenCalledTimes(2)
  expect(h.toast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('60 张图片转存失败'),'error')
})

it('saves and registers the chosen extracted theme before persisting the new project',async()=>{
  await mount();await fetchPreview();await authorize();await press(templateToggle());await press(checkOption('提取配色与字号'))
  const stats={sampleCount:8},theme={id:'fixture-theme',name:'fixture'}
  h.analyze.mockReturnValueOnce(stats);h.createTheme.mockReturnValueOnce(theme)
  h.saveTheme.mockResolvedValueOnce({});h.registerTheme.mockReturnValueOnce(undefined)
  successfulNavigation()
  await press(by('article-import'))
  expect(h.analyze.mock.calls[0][0].textContent).toBe('合成正文')
  expect(h.createTheme).toHaveBeenCalledExactlyOnceWith(stats,'合成标题 · 风格')
  expect(h.saveTheme).toHaveBeenCalledExactlyOnceWith(theme)
  expect(h.registerTheme).toHaveBeenCalledExactlyOnceWith(theme)
  expect(h.refreshThemes).toHaveBeenCalledOnce()
  expect(h.navigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({themeId:'fixture-theme'}),h.doc)
  expect(h.refreshThemes.mock.invocationCallOrder[0]).toBeLessThan(h.navigate.mock.invocationCallOrder[0])
})

it('distinguishes a newly saved component from a duplicate and passes the selected source and explicit attestation',async()=>{
  await mount();await fetchPreview();await authorize();await press(templateToggle());await press(by('article-components'));await press(by('source-xiumi'))
  h.pieces.mockReturnValueOnce([{label:'第一段',html:'<p>甲</p>'},{label:'第二段',html:'<p>乙</p>'}])
  h.draft.mockReturnValueOnce({id:'first'}).mockReturnValueOnce({id:'second'})
  h.component.mockResolvedValueOnce({duplicate:false}).mockResolvedValueOnce({duplicate:true})
  successfulNavigation()
  const changed=vi.fn();window.addEventListener('components-changed',changed)
  try { await press(by('article-import')) } finally { window.removeEventListener('components-changed',changed) }
  expect(h.draft).toHaveBeenNthCalledWith(1,expect.objectContaining({name:'第一段',via:'import',attested:true,source:expect.objectContaining({kind:'xiumi'}),block:expect.objectContaining({props:expect.objectContaining({html:'<p>甲</p>'})})}),expect.any(Function))
  expect(h.component.mock.calls).toEqual([[{id:'first'}],[{id:'second'}]])
  expect(changed).toHaveBeenCalledOnce()
  expect(h.toast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('新增 1 个组件（1 个结构重复未收录）'),'ok')
})

it.each(['close','change the draft'])('does not dispatch a second image batch after the user chooses to %s',async stale=>{
  const urls=manyImages()
  h.toBlocks.mockReturnValue([imagesBlock(urls)])
  await mount();await fetchPreview();await authorize();await press(templateToggle())
  let finish!:(receipt:Record<string,Asset>)=>void
  h.assets.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValueOnce({})
  const changed=vi.fn();window.addEventListener('assets-changed',changed)
  try {
    await press(by('article-import'))
    expect(h.assets).toHaveBeenCalledExactlyOnceWith(urls.slice(0,60))
    if(stale==='close') await press(host.querySelector<HTMLButtonElement>('button[aria-label="关闭导入"]')!)
    else h.doc=doc('newer')
    await act(async()=>finish({[urls[0]]:asset('already-saved')}))
    expect(h.assets).toHaveBeenCalledExactlyOnceWith(urls.slice(0,60))
    expect(changed).toHaveBeenCalledOnce()
    expect(h.navigate).not.toHaveBeenCalled();expect(h.beforeLeave).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledExactlyOnceWith('当前文稿未替换；已经完成的素材或模板保存仍保留。')
  } finally { window.removeEventListener('assets-changed',changed) }
})

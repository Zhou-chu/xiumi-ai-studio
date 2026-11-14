// @vitest-environment jsdom
import {act} from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {Toolbar} from '../../src/editor/Toolbar'
import {api} from '../../src/editor/api'
import {createBlock} from '../../src/core/blocks'
import {emptyDoc} from '../../src/editor/store'
import {setup,cleanup,mount,host,click,button,byTest,input,dispatch,state} from './libraryToolbarHarness'
const close=()=>click([...host.querySelectorAll('[role="dialog"] button.close')].at(-1))
beforeEach(()=>{setup();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillRect:vi.fn(),fillText:vi.fn()} as any);vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,YQ==');vi.spyOn(api,'versions').mockResolvedValue([]);vi.spyOn(api,'wechatStatus').mockResolvedValue({configured:false,appid:''});vi.spyOn(api,'aiSettings').mockResolvedValue({activeId:'',profiles:[]});vi.spyOn(api,'aiStatus').mockResolvedValue({enabled:false} as any)
 Object.defineProperty(document,'execCommand',{configurable:true,value:vi.fn(()=>true)});Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:fixture')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
})
afterEach(cleanup)
it('title, undo/redo, more menu Escape/outside, preview and AI modal work through actual controls',async()=>{
 await mount(<Toolbar/>);await input(host.querySelector('.title-input'),'New title');expect(state().doc.title).toBe('New title');await click(host.querySelector('.toolbar-undo'));expect(state().doc.title).toBe('Document');await click(host.querySelector('.toolbar-redo'));expect(state().doc.title).toBe('New title')
 await click(byTest('toolbar-more'));expect(byTest('toolbar-more')?.getAttribute('aria-expanded')).toBe('true');await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(document.activeElement).toBe(byTest('toolbar-more'));await click(byTest('toolbar-more'));await act(async()=>document.body.dispatchEvent(new Event('pointerdown',{bubbles:true})));expect(byTest('toolbar-more')?.getAttribute('aria-expanded')).toBe('false')
 await click(byTest('open-preview'));expect(byTest('preview-frame')?.getAttribute('srcdoc')).toContain('New title');await close();await click(byTest('open-ai-settings'));expect(host.querySelector('[role="dialog"]')).not.toBeNull();await close();await dispatch('open-ai-settings');await close()
})
it('versions save, cancel, restore, errors and stale-response guards protect the current document',async()=>{
 const version={id:'v',label:'Earlier',createdAt:1,blockCount:1};vi.mocked(api.versions).mockResolvedValue([version]);const save=vi.spyOn(api,'saveVersion').mockResolvedValue(version);const get=vi.spyOn(api,'version').mockResolvedValue({doc:{...state().doc,title:'Restored'}})
 await mount(<Toolbar/>);await click(button('历史版本'));vi.mocked(window.prompt).mockReturnValueOnce(null);await click(button('保存当前为新版本'));expect(save).not.toHaveBeenCalled();vi.mocked(window.prompt).mockReturnValueOnce('');await click(button('保存当前为新版本'));expect(save).toHaveBeenCalledWith(expect.anything(),'手动保存')
 await click(button('恢复'));expect(state().doc.title).toBe('Restored');expect(host.querySelector('[role="dialog"]')).toBeNull()
 await click(button('历史版本'));get.mockRejectedValueOnce(new Error('Missing version'));await click(button('恢复'));expect(state().toast?.text).toBe('Missing version')
 let resolve!:(v:any)=>void;get.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await click(button('恢复'));await act(async()=>state().setDocFields({title:'Latest'}));await act(async()=>resolve({doc:{...state().doc,title:'Late'}}));expect(state().doc.title).toBe('Latest')
 get.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await click(button('恢复'));await close();await act(async()=>resolve({doc:{...state().doc,title:'Closed'}}));expect(state().doc.title).toBe('Latest')
})
it('version listing errors show empty history; conflict export never discards the local draft',async()=>{
 vi.mocked(api.versions).mockRejectedValue(new Error('offline'));await mount(<Toolbar/>);await click(button('历史版本'));expect(host.textContent).toContain('还没有保存过版本');await close()
 await act(async()=>state().setDocFields({title:'Unsaved local'}));await act(async()=>markConflict());await click(button('导出当前内容'));expect(host.querySelector('[role="dialog"]')).not.toBeNull();expect(state().doc.title).toBe('Unsaved local');await close();await click(button('另存冲突副本'));expect(state().saveConflict).toBe(false)
})
function markConflict(){state();importStore.setState({saveConflict:true,saveStatus:'error',saveError:'Conflict'})}
import {useStore as importStore} from '../../src/editor/store'
it('export copies via browser fallback, downloads actual formats and reports clipboard failure',async()=>{
 await mount(<Toolbar/>);await click(byTest('open-export'));await click(byTest('copy-wechat'));expect(document.execCommand).toHaveBeenCalledWith('copy');expect(host.querySelector('.report')).not.toBeNull()
 await click(button('原图链接'));await click(byTest('copy-wechat'));await click(button('内嵌图片'))
 await click(button('Markdown'));await click(button('编辑器 JSON'));await click(button('微信 HTML（图片内嵌）'));await click(byTest('xiumi-package'));expect(URL.createObjectURL).toHaveBeenCalledTimes(4)
 vi.mocked(document.execCommand).mockReturnValueOnce(false);await click(byTest('copy-wechat'));expect(state().toast?.kind).toBe('error');await close()
})
it('configured upload/draft workflow requires confirmation and exposes API failure or success',async()=>{
 vi.mocked(api.wechatStatus).mockResolvedValue({configured:true,appid:'fixture'});vi.spyOn(api,'wechatUploadImages').mockImplementation(async urls=>Object.fromEntries(urls.map(u=>[u,'https://mmbiz.qpic.cn/image.jpg'])));const draft=vi.spyOn(api,'wechatDraft').mockRejectedValueOnce(new Error('Draft failed')).mockResolvedValue({media_id:'draft-id'})
 await act(async()=>state().setDocFields({cover:{src:'/media/cover.png'}}));await mount(<Toolbar/>);await click(byTest('open-export'));await click(button('上传到微信图床'));await click(byTest('copy-wechat'));await click(button('推送到草稿箱…'))
 expect(button('确认推送').disabled).toBe(true);await click(host.querySelector('[role="dialog"]:last-child input[type="checkbox"]') ?? [...host.querySelectorAll('input[type="checkbox"]')].at(-1));await click(button('确认推送'));expect(host.textContent).toContain('Draft failed');await click(button('确认推送'));expect(host.textContent).toContain('draft-id');expect(draft).toHaveBeenCalledWith(expect.objectContaining({confirm:true}));await click(button('取消'));await close()
})
it('draft validates missing metadata and rejects over-limit HTML without publishing',async()=>{
 vi.mocked(api.wechatStatus).mockResolvedValue({configured:true,appid:'fixture'});const draft=vi.spyOn(api,'wechatDraft');vi.spyOn(api,'wechatUploadImages').mockResolvedValue({})
 await act(async()=>state().setDocFields({title:'',digest:'x'.repeat(121)}));await mount(<Toolbar/>);await click(byTest('open-export'));await click(button('推送到草稿箱…'));await click([...host.querySelectorAll('input[type="checkbox"]')].at(-1));expect(button('确认推送').disabled).toBe(true);await close();await close()
 await act(async()=>state().load({...emptyDoc(),title:'Long',cover:{src:'https://example.test/cover.jpg'},blocks:[createBlock('html',{label:'Long',html:'<p>'+'x'.repeat(22000)+'</p>'})]}));await click(byTest('open-export'));await click(button('推送到草稿箱…'));await click([...host.querySelectorAll('input[type="checkbox"]')].at(-1));await click(button('确认推送'));expect(host.textContent).toContain('20,000');expect(draft).not.toHaveBeenCalled()
})
it('Xiumi packages and uploads real local image references, with safe failure reporting',async()=>{
 vi.mocked(api.wechatStatus).mockResolvedValue({configured:true,appid:'fixture'});vi.spyOn(api,'wechatUploadImages').mockImplementation(async urls=>Object.fromEntries(urls.map(u=>[u,'https://mmbiz.qpic.cn/image.jpg'])));vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,arrayBuffer:async()=>new ArrayBuffer(3)}))
 await act(async()=>state().load({...emptyDoc(),blocks:[createBlock('image',{image:{src:'/media/image.png'}})]}));await mount(<Toolbar/>);await click(byTest('open-export'));await click(byTest('xiumi-upload'));expect(api.wechatUploadImages).toHaveBeenCalled();await click(byTest('xiumi-package'));expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
 vi.mocked(fetch).mockResolvedValueOnce({ok:false} as Response);await click(byTest('xiumi-package'));expect(state().toast?.kind).toBe('error')
})
it('oversized Xiumi export asks before downloading split files',async()=>{
 await act(async()=>state().load({...emptyDoc(),blocks:[createBlock('html',{label:'Long',html:Array.from({length:180},()=>'<p>'+'x'.repeat(1000)+'</p>').join('')})]}));await mount(<Toolbar/>);await click(byTest('open-export'));expect(byTest('xiumi-parts')).not.toBeNull();vi.mocked(window.confirm).mockReturnValueOnce(false);await click(byTest('xiumi-package'));expect(URL.createObjectURL).not.toHaveBeenCalled();await click(byTest('xiumi-package'));expect(URL.createObjectURL).toHaveBeenCalled();expect(state().toast?.text).toContain('依次导入')
})
it('lazy article and AI import entrypoints and template event can be opened and dismissed',async()=>{
 await import('../../src/editor/ArticleImport');await import('../../src/editor/ImportWizard');await mount(<Toolbar/>);await click(byTest('open-article-import'));await act(async()=>{await vi.dynamicImportSettled()});expect(host.querySelector('[role="dialog"]')).not.toBeNull();await close();await click(byTest('open-import'));await act(async()=>{await vi.dynamicImportSettled()});expect(host.querySelector('[role="dialog"]')).not.toBeNull();await close();await act(async()=>window.dispatchEvent(new CustomEvent('open-import',{detail:{templateIds:['tpl']}})));await close()
})

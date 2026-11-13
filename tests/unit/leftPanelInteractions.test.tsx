// @vitest-environment jsdom
import {act} from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {LeftPanel} from '../../src/editor/LeftPanel'
import {api} from '../../src/editor/api'
import {createBlock} from '../../src/core/blocks'
import {emptyDoc} from '../../src/editor/store'
import {setup,cleanup,mount,host,click,button,byTest,dispatch,state,asset,template} from './libraryToolbarHarness'
beforeEach(setup);afterEach(cleanup)
it('block/kit tools insert actual modules and change theme; components tab stays available',async()=>{
 await mount(<LeftPanel/>);let n=state().doc.blocks.length;await click(byTest('lib-paragraph'));expect(state().doc.blocks).toHaveLength(++n)
 await click(host.querySelector('.kit-section .lib-item'));expect(state().doc.blocks).toHaveLength(n+1);await click(byTest('kit-theme'));expect(state().doc.themeId).toBe('thu-eea-de')
 await click(byTest('tab-components'));expect(byTest('components-saved')).not.toBeNull()
})
it('assets insert, replace and append according to the selected real block type',async()=>{
 await mount(<LeftPanel/>);await click(byTest('tab-assets'))
 for(const type of ['heading','gallery','image','carousel','photos','frame'] as const){const block=createBlock(type);state().load({...emptyDoc(),blocks:[block]});await act(async()=>state().select(block.id));await click(host.querySelector('.asset img'));if(type==='heading')expect(state().doc.blocks).toHaveLength(2);else expect(JSON.stringify(state().doc.blocks[0])).toContain('/media/asset.png')}
 const full=createBlock('photos',{count:2,pics:[{image:{src:'a'},caption:''},{image:{src:'b'},caption:''}]});await act(async()=>{state().load({...emptyDoc(),blocks:[full]});state().select(full.id)});await click(host.querySelector('.asset img'));expect(state().toast?.kind).toBe('error')
})
it('uploads files with progress and failures, refreshes events, and confirms deletion',async()=>{
 const upload=vi.spyOn(api,'uploadAssets').mockResolvedValue([asset]);const del=vi.spyOn(api,'deleteAsset').mockResolvedValue({} as any)
 await mount(<LeftPanel/>);await click(byTest('tab-assets'));const file=byTest('asset-upload')!
 await act(async()=>file.dispatchEvent(new Event('change',{bubbles:true})));expect(upload).not.toHaveBeenCalled()
 Object.defineProperty(file,'files',{configurable:true,value:[new File(['x'],'photo.png',{type:'image/png'})]});await act(async()=>file.dispatchEvent(new Event('change',{bubbles:true})));expect(upload).toHaveBeenCalled();expect(state().toast?.kind).toBe('ok')
 upload.mockRejectedValueOnce(new Error('Upload failed'));await act(async()=>file.dispatchEvent(new Event('change',{bubbles:true})));expect(state().toast?.text).toBe('Upload failed')
 vi.mocked(window.confirm).mockReturnValueOnce(false);await click(host.querySelector('.asset .danger'));expect(del).not.toHaveBeenCalled();await click(host.querySelector('.asset .danger'));expect(del).toHaveBeenCalledWith('asset')
 await dispatch('assets-changed');await dispatch('templates-changed');expect(api.assets).toHaveBeenCalledTimes(4)
 await click(button('裁剪'));expect(host.querySelector('[role="dialog"]')).not.toBeNull();await click(host.querySelector('[role="dialog"] button.close'));expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('templates insert, apply, inspect, save, create and delete without mutating template source',async()=>{
 const save=vi.spyOn(api,'saveTemplate').mockResolvedValue(template);const del=vi.spyOn(api,'deleteTemplate').mockResolvedValue({} as any);await mount(<LeftPanel/>);await click(byTest('tab-templates'))
 const before=state().doc.blocks.length;await click(byTest('template-item'));expect(state().doc.blocks).toHaveLength(before+1);expect(state().doc.blocks.at(-1)?.id).not.toBe(template.blocks[0].id)
 const event=vi.fn();window.addEventListener('open-import',event);await click(byTest('apply-template'));expect(event).toHaveBeenCalled();window.removeEventListener('open-import',event)
 await click(byTest('template-modules'));expect(host.querySelector('[role="dialog"]')).not.toBeNull();await click(host.querySelector('[role="dialog"] button.close'))
 vi.mocked(window.prompt).mockReturnValueOnce(null);await click(host.querySelector('button.wide'));expect(save).not.toHaveBeenCalled();await click(host.querySelector('button.wide'));expect(save).toHaveBeenCalled()
 await click(button('新建'));expect(state().doc.title).toBe('Template');vi.mocked(window.confirm).mockReturnValueOnce(false);await click(host.querySelector('.tpl-actions .danger'));expect(del).not.toHaveBeenCalled();await click(host.querySelector('.tpl-actions .danger'));expect(del).toHaveBeenCalled()
})
it('project navigation saves current edits, blocks failed saves and ignores delayed stale loads',async()=>{
 const other={...emptyDoc(),id:'other',title:'Other'};vi.mocked(api.projects).mockResolvedValue([{id:'other',title:'Other',updatedAt:1,blockCount:4,themeId:'minimal-magazine'}]);const get=vi.spyOn(api,'project').mockResolvedValue(other);const del=vi.spyOn(api,'deleteProject').mockResolvedValue({} as any)
 await mount(<LeftPanel/>);await click(byTest('tab-projects'));await click(host.querySelector('.list-row .grow'));expect(state().doc.id).toBe('other');expect((host.querySelector('.list-row .danger') as HTMLButtonElement).disabled).toBe(true)
 await click(host.querySelector('button.wide'));expect(state().doc.id).not.toBe('other');vi.mocked(window.confirm).mockReturnValueOnce(false);await click(host.querySelector('.list-row .danger'));expect(del).not.toHaveBeenCalled();await click(host.querySelector('.list-row .danger'));expect(del).toHaveBeenCalled()
 await act(async()=>state().setDocFields({title:'Unsaved'}));vi.mocked(api.saveProject).mockRejectedValueOnce(new Error('Cannot save'));await click(host.querySelector('.list-row .grow'));expect(state().doc.title).toBe('Unsaved')
 vi.mocked(api.saveProject).mockResolvedValue({updatedAt:2,revision:'r2'});let resolve!:(d:any)=>void;get.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await click(host.querySelector('.list-row .grow'));await act(async()=>state().setDocFields({title:'Newer'}));await act(async()=>resolve(other));expect(state().doc.title).toBe('Newer')
})
it('failed refreshes leave honest empty lists',async()=>{
 vi.mocked(api.assets).mockRejectedValue(new Error('offline'));vi.mocked(api.templates).mockRejectedValue(new Error('offline'));vi.mocked(api.projects).mockRejectedValue(new Error('offline'));await mount(<LeftPanel/>);await click(byTest('tab-assets'));expect(host.textContent).toContain('暂无素材');await click(byTest('tab-templates'));expect(host.textContent).toContain('还没有收藏的模板');await click(byTest('tab-projects'));expect(host.querySelectorAll('.list-row')).toHaveLength(0)
})

it('template and blank project creation stop when either required save fails',async()=>{
 vi.mocked(api.templates).mockResolvedValue([{...template,themeId:undefined,blocks:[createBlock('html',{html:'<p>Text</p>',label:'Raw block'})]}]);vi.mocked(api.projects).mockResolvedValue([{id:'other',title:'',themeId:'minimal-magazine',updatedAt:1,blockCount:0}]);await mount(<LeftPanel/>);await click(byTest('tab-templates'));expect(host.textContent).toContain('Raw block')
 const original=state().doc;vi.mocked(api.saveProject).mockRejectedValueOnce(new Error('First save failed'));await click(button('新建'));expect(state().doc).toBe(original)
 vi.mocked(api.saveProject).mockResolvedValueOnce({updatedAt:1,revision:'r'}).mockRejectedValueOnce(new Error('New template save failed'));await click(button('新建'));expect(state().doc.title).toBe('Template');expect(state().saveStatus).toBe('error')
 await click(byTest('tab-projects'));expect(host.textContent).toContain('未命名');const before=state().doc;vi.mocked(api.saveProject).mockRejectedValueOnce(new Error('Cannot leave'));await click(host.querySelector('button.wide'));expect(state().doc).toBe(before)
 vi.mocked(api.saveProject).mockResolvedValueOnce({updatedAt:1,revision:'r'}).mockRejectedValueOnce(new Error('New blank save failed'));await click(host.querySelector('button.wide'));expect(state().doc.id).not.toBe(before.id);expect(state().saveStatus).toBe('error')
})

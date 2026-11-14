// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {ImportWizard} from '../../src/editor/ImportWizard'
import {useStore,emptyDoc,saveBeforeLeave} from '../../src/editor/store'
import {api} from '../../src/editor/api'
import {createBlock} from '../../src/core/blocks'
vi.mock('../../src/editor/store',async original=>({...await original<typeof import('../../src/editor/store')>(),saveBeforeLeave:vi.fn().mockResolvedValue(true)}))
vi.mock('../../src/editor/api',async original=>({...await original<typeof import('../../src/editor/api')>(),api:{aiStatus:vi.fn(),templates:vi.fn(),aiOutline:vi.fn(),aiDesign:vi.fn(),aiEnrichCopy:vi.fn(),aiCopywrite:vi.fn(),aiPlacePhotos:vi.fn(),importFile:vi.fn(),uploadAssets:vi.fn(),loadSample:vi.fn(),saveProject:vi.fn(),project:vi.fn()}}))
vi.mock('../../src/editor/KitPicker',async original=>({...await original<typeof import('../../src/editor/KitPicker')>(),useComponents:()=>[],KitPicker:({templates,picked,setPicked}:any)=><button data-testid="toggle-kit" onClick={()=>setPicked(picked.length?[]:templates.map((t:any)=>t.id))}>kit</button>}))
vi.mock('../../src/editor/PhotoPlanner',()=>({PhotoPlanner:({images,setNotes,setGroups,setAnchors,setImages}:any)=><div><button data-testid="photo-note" onClick={()=>setNotes(Object.fromEntries(images.map((a:any)=>[a.id,'A real photo description'])))}>note</button><button data-testid="photo-group" onClick={()=>{setGroups([{id:'group',photos:images.map((a:any)=>a.id),layout:'singles'}]);setAnchors({group:'Body text'})}}>group</button><button data-testid="remove-photo" onClick={()=>setImages([])}>remove</button></div>}))
vi.mock('../../src/editor/Copywriter',()=>({Copywriter:({onImport,onClose}:any)=><div data-testid="copywriter"><button onClick={()=>onImport('# Written copy\nBody text')}>import-copy</button><button onClick={onClose}>close-copy</button></div>}))
vi.mock('../../src/editor/PlanIssues',()=>({PlanIssues:({onFlatten,onAiFlatten,onClearAnchor,onContinue,onCancel,setCrowd,setSinglesFor}:any)=><div data-testid="plan-issues"><button data-testid="flatten" onClick={onFlatten}>flatten</button><button data-testid="ai-flatten" onClick={onAiFlatten}>ai flatten</button><button data-testid="clear-anchor" onClick={()=>onClearAnchor('one')}>clear</button><button data-testid="crowd-singles" onClick={()=>setCrowd({one:{mode:'singles'}})}>singles</button><button data-testid="crowd-group" onClick={()=>setCrowd({one:{mode:'group',layout:'img2lr'}})}>group</button><button data-testid="crowd-ai" onClick={()=>setCrowd({one:{mode:'ai',request:'pair'}})}>ai</button><button data-testid="singles" onClick={()=>setSinglesFor(new Set(['group']))}>singles</button><button data-testid="plan-continue" onClick={()=>onContinue({skipEnrich:true})}>continue</button><button data-testid="plan-cancel" onClick={onCancel}>cancel</button></div>}))
const initial=useStore.getState(),close=vi.fn();let host:HTMLDivElement,root:Root
const text='# Fixture title\n## First section\nBody text. A complete paragraph.'
const asset={id:'one',file:'one.jpg',name:'One',width:800,height:600}
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,0))})}
async function render(props:any={}){await act(async()=>root.render(<ImportWizard onClose={close} {...props}/>));await flush()}
async function click(selector:string){const el=host.querySelector<HTMLElement>(selector)!;expect(el).toBeTruthy();await act(async()=>el.click());await flush()}
async function input(selector:string,value:string){const el=host.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector)!;await act(async()=>{Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.resetAllMocks();useStore.setState({...initial,doc:emptyDoc()},true);vi.mocked(saveBeforeLeave).mockResolvedValue(true);vi.mocked(api.aiStatus).mockResolvedValue({enabled:false} as any);vi.mocked(api.templates).mockResolvedValue([]);vi.mocked(api.saveProject).mockResolvedValue({revision:'saved',updatedAt:1});vi.mocked(api.aiOutline).mockResolvedValue({} as any);vi.mocked(api.aiDesign).mockResolvedValue({designs:[{name:'AI concept',concept:'Real design'}]} as any)
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('requires content, imports sample, generates real builtins and saves selected draft',async()=>{
 const original=useStore.getState().doc;await render();expect(host.querySelector('[data-testid="generate"]')?.hasAttribute('disabled')).toBe(true);vi.mocked(api.loadSample).mockResolvedValue({text,assets:[]} as any);await click('[data-testid="load-sample"]');await click('[data-testid="generate"]');expect(host.querySelectorAll('.variant')).toHaveLength(3);expect(useStore.getState().doc).toBe(original)
 const select=host.querySelector('select')!;await act(async()=>{select.value=useStore.getState().themes[1].id;select.dispatchEvent(new Event('change',{bubbles:true}))});await click('[data-testid^="choose-"]');expect(api.saveProject).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(useStore.getState().doc.title).toBe('Fixture title')
})
it('failed save leaves original intact and retry can save all variants',async()=>{
 const original=useStore.getState().doc;await render({initialText:text});await click('[data-testid="generate"]');vi.mocked(api.saveProject).mockRejectedValueOnce(new Error('disk failed'));await click('[data-testid^="choose-"]');expect(host.querySelector('[role="alert"]')?.textContent).toContain('disk failed');expect(useStore.getState().doc).toBe(original);await click('[data-testid="save-all-variants"]');expect(close).toHaveBeenCalled();expect(vi.mocked(api.saveProject).mock.calls.length).toBeGreaterThan(3)
})
it('cancelled selection save and edited-current-draft reject late response',async()=>{
 await render({initialText:text});await click('[data-testid="generate"]');let finish!:(value:any)=>void;vi.mocked(api.saveProject).mockReturnValue(new Promise(r=>{finish=r}));await click('[data-testid^="choose-"]');const later=emptyDoc();await act(async()=>useStore.setState({doc:later}));await act(async()=>finish({revision:'later'}));await flush();expect(useStore.getState().doc).toBe(later);expect(host.querySelector('[role="alert"]')?.textContent).toContain('已变化');expect(close).not.toHaveBeenCalled()
})
it('unmounted wizard cannot load late saved variant and pre-save refusal starts no variant write',async()=>{
 const original=useStore.getState().doc;await render({initialText:text});await click('[data-testid="generate"]');vi.mocked(saveBeforeLeave).mockResolvedValueOnce(false);await click('[data-testid^="choose-"]');expect(api.saveProject).not.toHaveBeenCalled()
 let finish!:(value:any)=>void;vi.mocked(api.saveProject).mockReturnValue(new Promise(r=>{finish=r}));await click('[data-testid^="choose-"]');await act(async()=>root.render(null));await act(async()=>finish({revision:'late'}));expect(useStore.getState().doc).toBe(original);expect(close).not.toHaveBeenCalled()
})
it('file and image uploads report errors, append assets and can clear them',async()=>{
 await render();vi.mocked(api.importFile).mockResolvedValue({text,assets:[asset]} as any);const file=host.querySelector('[data-testid="import-file"]')!;Object.defineProperty(file,'files',{configurable:true,value:[new File(['source'],'source.md')]});await act(async()=>file.dispatchEvent(new Event('change',{bubbles:true})));expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(text)
 vi.mocked(api.uploadAssets).mockResolvedValue([asset] as any);const images=host.querySelector('[data-testid="import-images"]')!;Object.defineProperty(images,'files',{configurable:true,value:[new File(['image'],'photo.png')]});await act(async()=>images.dispatchEvent(new Event('change',{bubbles:true})));expect(host.textContent).toContain('图片 2 张')
 await click('[data-testid="remove-photo"]');vi.mocked(api.loadSample).mockRejectedValue(new Error('sample failed'));await click('[data-testid="load-sample"]');expect(useStore.getState().toast?.text).toContain('sample failed')
})
it('AI outline/design failures fall back to builtins without changing draft',async()=>{
 vi.mocked(api.aiStatus).mockResolvedValue({enabled:true,name:'Fixture AI',model:'test'} as any);vi.mocked(api.aiOutline).mockRejectedValue(new Error('outline unavailable'));vi.mocked(api.aiDesign).mockRejectedValue(new Error('design unavailable'));await render({initialText:text});await input('[data-testid="design-hint"]','monochrome');await click('.chip');await click('[data-testid="generate"]');expect(host.querySelectorAll('.variant')).toHaveLength(3);expect(useStore.getState().toast?.text).toContain('design unavailable')
 vi.mocked(api.aiDesign).mockResolvedValue({designs:[{name:'Recovered design'}]} as any);await click('[data-testid="redesign"]');expect(host.querySelectorAll('.variant')).toHaveLength(4)
})
it('AI success, copywriter transfer, redesign and edit-back work with live state',async()=>{
 vi.mocked(api.aiStatus).mockResolvedValue({enabled:true,name:'Fixture AI',model:'test'} as any);await render({initialText:text});await click('[data-testid="open-copywriter"]');await click('[data-testid="copywriter"] button');expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toContain('Written copy');await click('[data-testid="copywriter"] button:last-child');await click('[data-testid="generate"]');expect(host.querySelectorAll('.variant')).toHaveLength(4);await click('.variants > .hint button');expect(host.querySelector('[data-testid="import-text"]')).toBeTruthy()
 await click('[data-testid="use-ai"]');await click('[data-testid="generate"]');expect(api.aiDesign).toHaveBeenCalledTimes(1)
})
it('photo descriptions prompt explicit enrich choice and undo preserves original copy',async()=>{
 vi.mocked(api.aiStatus).mockResolvedValue({enabled:true,name:'Fixture AI',model:'test'} as any);await render({initialText:text,initialImages:[asset]});await click('[data-testid="photo-note"]');await click('[data-testid="generate"]');expect(host.querySelector('[data-testid="enrich-ask"]')).toBeTruthy()
 vi.mocked(api.aiEnrichCopy).mockResolvedValue({markdown:'# Changed title\nExpanded body with details.',changes:['Added photo detail']} as any);await click('[data-testid="enrich-yes"]');expect(host.querySelector('[data-testid="enrich-result"]')?.textContent).toContain('Added photo detail');await click('[data-testid="enrich-undo"]');expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(text)
 await click('[data-testid="generate"]');expect(host.querySelectorAll('.variant')).toHaveLength(4)
})
it('enrich empty response is an error and skipping enrich still generates safely',async()=>{
 vi.mocked(api.aiStatus).mockResolvedValue({enabled:true,name:'Fixture AI'} as any);await render({initialText:text,initialImages:[asset]});await click('[data-testid="photo-note"]');await click('[data-testid="generate"]');vi.mocked(api.aiEnrichCopy).mockResolvedValue({} as any);await click('[data-testid="enrich-yes"]');expect(useStore.getState().toast?.text).toContain('没有返回文案');await click('[data-testid="enrich-no"]');expect(host.querySelectorAll('.variant')).toHaveLength(4)
})
it('initial template selections use actual kit assembly and refill',async()=>{
 vi.mocked(api.templates).mockResolvedValue([{id:'tpl',name:'Template',blocks:[createBlock('heading'),createBlock('paragraph')],themeId:'minimal-magazine'}] as any);await render({initialText:text,initialTemplates:['tpl']});await click('[data-testid="generate"]');expect(host.querySelector('[data-testid="refill"]')).toBeTruthy();expect(host.querySelector('[data-testid^="variant-kit-"]')).toBeTruthy();await click('[data-testid="refill"]')
})

it('template hierarchy issues support flatten, AI rewrite, anchor reset, cancel and continue',async()=>{
 vi.mocked(api.aiStatus).mockResolvedValue({enabled:true,name:'Fixture AI'} as any);const heading=createBlock('heading'),body=createBlock('paragraph');vi.mocked(api.templates).mockResolvedValue([{id:'tpl',name:'One level',blocks:[heading,body],roles:{[heading.id]:'h1',[body.id]:'body'}}] as any)
 await render({initialText:'# Title\n## Level one\n### Level two\n#### Level three\nBody text',initialTemplates:['tpl']});await click('[data-testid="generate"]');expect(host.querySelector('[data-testid="plan-issues"]')).toBeTruthy()
 vi.mocked(api.aiCopywrite).mockResolvedValueOnce({} as any);await click('[data-testid="ai-flatten"]');expect(useStore.getState().toast?.text).toContain('没有返回文案')
 vi.mocked(api.aiCopywrite).mockResolvedValueOnce({markdown:'# Title\n## Level one\n### Level two\n#### Level three\nBody text'} as any);await click('[data-testid="ai-flatten"]');expect(useStore.getState().toast?.text).toContain('级标题')
 await click('[data-testid="clear-anchor"]');await click('[data-testid="crowd-singles"]');await click('[data-testid="crowd-group"]');await click('[data-testid="crowd-ai"]');await click('[data-testid="singles"]');await click('[data-testid="plan-cancel"]');await click('[data-testid="generate"]');await click('[data-testid="flatten"]');await click('[data-testid="plan-continue"]');expect(host.querySelector('[data-testid="refill"]')).toBeTruthy()
})
it('template image measurement and AI placement use described photos and fall back on placement errors',async()=>{
 vi.mocked(api.aiStatus).mockResolvedValue({enabled:true,name:'Fixture AI'} as any)
 const image=createBlock('html',{html:'<img src="https://example.com/wide.jpg"><img src="https://example.com/icon.jpg"><img src="https://example.com/error.jpg">'}),body=createBlock('paragraph');vi.mocked(api.templates).mockResolvedValue([{id:'tpl',name:'Image template',blocks:[image,body],roles:{[image.id]:'img1',[body.id]:'body'}}] as any)
 vi.stubGlobal('Image',class{referrerPolicy='';naturalWidth=800;naturalHeight=600;onload:(()=>void)|null=null;onerror:(()=>void)|null=null;set src(value:string){if(value.includes('icon'))this.naturalWidth=100;queueMicrotask(()=>value.includes('error')?this.onerror?.():this.onload?.())}})
 vi.mocked(api.aiPlacePhotos).mockRejectedValueOnce(new Error('placement unavailable'));await render({initialText:'# Title\nBody text',initialImages:[asset],initialTemplates:['tpl']});await click('[data-testid="photo-note"]');await click('[data-testid="generate"]');await click('[data-testid="enrich-no"]');expect(api.aiPlacePhotos).toHaveBeenCalled();expect(host.querySelector('[data-testid="refill"]')).toBeTruthy();expect(useStore.getState().toast?.text).toContain('placement unavailable')
 vi.mocked(api.aiPlacePhotos).mockResolvedValue({placements:[]} as any);await click('[data-testid="refill"]');expect(api.aiPlacePhotos).toHaveBeenCalledTimes(2);vi.unstubAllGlobals()
})
it('photo group metadata, clear-image action, model settings and failed AI status remain usable',async()=>{
 vi.mocked(api.aiStatus).mockRejectedValue(new Error('status unavailable'));vi.mocked(api.templates).mockRejectedValue(new Error('templates unavailable'));await render({initialText:text,initialImages:[asset,{...asset,id:'two'}]});await click('[data-testid="photo-group"]');const settings=vi.fn();window.addEventListener('open-ai-settings',settings);await click('.ai-box button');expect(settings).toHaveBeenCalled();window.removeEventListener('open-ai-settings',settings)
 const clear=[...host.querySelectorAll('button')].find(b=>b.textContent==='清空图片')!;await act(async()=>clear.click());expect(host.textContent).toContain('图片 0 张');await input('[data-testid="import-text"]','Changed input');expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Changed input');await click('[data-testid="toggle-kit"]')
})
it('enrichment continuation and design empty response report real fallback state',async()=>{
 vi.mocked(api.aiStatus).mockResolvedValue({enabled:true} as any);await render({initialText:text,initialImages:[asset]});await click('[data-testid="photo-note"]');await click('[data-testid="photo-group"]');await click('[data-testid="generate"]');vi.mocked(api.aiEnrichCopy).mockResolvedValue({markdown:'# New heading\nA much longer paragraph about the photo and the event details.',changes:['Improved']} as any);await click('[data-testid="enrich-yes"]');vi.mocked(api.aiDesign).mockResolvedValue({designs:[]} as any);await click('[data-testid="enrich-continue"]');expect(useStore.getState().toast?.text).toContain('没有返回设计方案');expect(host.querySelectorAll('.variant')).toHaveLength(3)
 const hint=host.querySelector('.hint-input')!;await input('.hint-input','new direction');expect((hint as HTMLInputElement).value).toBe('new direction')
})

it('malformed design object falls back safely and empty file input is a no-op',async()=>{
 vi.mocked(api.aiStatus).mockResolvedValue({enabled:true} as any);vi.mocked(api.aiDesign).mockResolvedValue({} as any);await render({initialText:text});await act(async()=>host.querySelector('[data-testid="import-file"]')!.dispatchEvent(new Event('change',{bubbles:true})));expect(api.importFile).not.toHaveBeenCalled();await click('[data-testid="generate"]');expect(useStore.getState().toast?.text).toContain('没有返回设计方案')
})
it('late prerequisite save after unmount starts no variant write, and string rejection stays visible',async()=>{
 await render({initialText:text});await click('[data-testid="generate"]');vi.mocked(api.saveProject).mockRejectedValueOnce('storage unavailable');await click('[data-testid^="choose-"]');expect(host.querySelector('[role="alert"]')?.textContent).toContain('storage unavailable');vi.mocked(api.saveProject).mockClear()
 let finish!:(value:boolean)=>void;vi.mocked(saveBeforeLeave).mockReturnValue(new Promise(r=>{finish=r}));await click('[data-testid^="choose-"]');await act(async()=>root.render(null));await act(async()=>finish(true));expect(api.saveProject).not.toHaveBeenCalled()
})

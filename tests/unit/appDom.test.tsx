// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { KIT_ITEMS } from '../../src/editor/kitItems'
const h=vi.hoisted(()=>({state:{} as any,dnd:{} as any,hits:[] as any[],fallback:[{id:'fallback'}],projects:vi.fn(),project:vi.fn(),themes:vi.fn(),save:vi.fn(),listen:vi.fn(()=>vi.fn()),insert:vi.fn(),photo:vi.fn(),slot:vi.fn(),replace:vi.fn(),add:vi.fn()}))
vi.mock('@dnd-kit/core',()=>({DndContext:(p:any)=>{h.dnd=p;return <div data-dnd>{p.children}</div>},DragOverlay:({children}:{children:ReactNode})=><div>{children}</div>,MeasuringStrategy:{Always:'always'},PointerSensor:()=>null,useSensor:vi.fn(),useSensors:vi.fn(),pointerWithin:()=>h.hits,closestCenter:()=>h.fallback}))
vi.mock('../../src/editor/store',()=>({useStore:Object.assign((selector:any)=>selector(h.state),{getState:()=>h.state}),loadCustomThemes:h.themes,saveNow:h.save,emptyDoc:()=>({id:'empty',title:'Empty',blocks:[]})}))
vi.mock('../../src/editor/api',()=>({api:{projects:h.projects,project:h.project},assetRef:(asset:any)=>({src:'/media/'+asset.file})}))
vi.mock('../../src/editor/Canvas',()=>({Canvas:()=> <div data-canvas/>,photoTarget:h.photo,slotTarget:h.slot,shownRatio:()=>1.5}))
vi.mock('../../src/editor/Toolbar',()=>({Toolbar:()=> <div data-toolbar/>}))
vi.mock('../../src/editor/LeftPanel',()=>({LeftPanel:()=>null}))
vi.mock('../../src/editor/RightPanel',()=>({RightPanel:()=>null}))
vi.mock('../../src/editor/Workspace',()=>({Workspace:({children}:{children:ReactNode})=><div>{children}</div>}))
vi.mock('../../src/editor/CollectModal',()=>({CollectHost:()=>null}))
vi.mock('../../src/editor/componentActions',()=>({insertComponent:h.insert}))
vi.mock('../../src/editor/suggestionQueue',()=>({listenForAiSettings:h.listen}))
vi.mock('../../src/core/photos',()=>({replacePhoto:h.replace,addPicTo:h.add}))
import App from '../../src/App'
let host:HTMLDivElement,root:Root
const doc=(blocks:any[]=[])=>({id:'existing',title:'Existing',blocks})
async function mount(){await act(async()=>{root.render(<App/>)});await flush()}
async function flush(){await act(async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()})}
const deferred=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve}}
const key=(key:string,extras:any={},target:EventTarget=window)=>{const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extras});act(()=>{target.dispatchEvent(event)});return event}
const drag=(active:string,over:string|null='canvas-end',extra:any={})=>({active:{id:active,data:{current:{}},rect:{current:{translated:null}}},over:over?{id:over,rect:{top:0,height:100}}:null,delta:{x:0,y:0},activatorEvent:null,...extra})
beforeEach(()=>{vi.clearAllMocks();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);h.hits=[];h.projects.mockResolvedValue([{id:'existing'}]);h.project.mockResolvedValue(doc());h.themes.mockResolvedValue(undefined);h.save.mockResolvedValue(true);h.photo.mockReturnValue(null);h.slot.mockReturnValue(null);h.replace.mockImplementation(d=>d);h.add.mockReturnValue(null);h.state={doc:doc(),toast:null,saveStatus:'saved',selectedId:null,editingId:null,load:vi.fn(d=>{h.state.doc=d}),notify:vi.fn(),insertBlock:vi.fn(),updateProps:vi.fn(),commit:vi.fn(),select:vi.fn(),moveBlock:vi.fn(),moveBlockTo:vi.fn(),undo:vi.fn(),redo:vi.fn(),removeSelected:vi.fn()}})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks()})
it('initializes existing projects and owns keyboard shortcuts without changing inputs or dialogs',async()=>{
 await mount();expect(h.state.load).toHaveBeenCalledWith(doc());expect(host.querySelector('[data-canvas]')).toBeTruthy()
 key('s',{ctrlKey:true});expect(h.save).toHaveBeenCalledTimes(1);key('z',{ctrlKey:true});key('z',{metaKey:true,shiftKey:true});key('y',{ctrlKey:true});expect(h.state.undo).toHaveBeenCalledTimes(1);expect(h.state.redo).toHaveBeenCalledTimes(2)
 h.state.selectedId='a';key('Delete');key('Backspace');expect(h.state.removeSelected).toHaveBeenCalledTimes(2);h.state.editingId='a';key('Delete');expect(h.state.removeSelected).toHaveBeenCalledTimes(2);key('Escape');expect(h.state.select).toHaveBeenCalledWith(null)
 const input=document.createElement('input');host.append(input);key('z',{ctrlKey:true},input);expect(h.state.undo).toHaveBeenCalledTimes(1);key('s',{ctrlKey:true},input);expect(h.save).toHaveBeenCalledTimes(2)
 const dialog=document.createElement('div');dialog.setAttribute('role','dialog');host.append(dialog);key('s',{ctrlKey:true});expect(h.save).toHaveBeenCalledTimes(2)
})
it('blocks saving before startup and creates exactly one initial project across persisted-page resume',async()=>{
 h.projects.mockResolvedValue([]);const pending=deferred();h.save.mockReturnValue(pending.promise);await mount();expect(host.querySelector('[data-testid="app-loading"]')).toBeTruthy();expect(key('s',{ctrlKey:true}).defaultPrevented).toBe(true);key('z',{ctrlKey:true});expect(h.state.undo).not.toHaveBeenCalled()
 window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));pending.resolve(true);await flush();expect(h.save).toHaveBeenCalledTimes(1);expect(h.state.load).toHaveBeenCalledTimes(1);expect(host.querySelector('[data-canvas]')).toBeTruthy()
})
it.each([null,[{}],[{id:''}]])('reports malformed project lists without fabricating a replacement %j',async value=>{h.projects.mockResolvedValue(value);await mount();expect(h.state.notify).toHaveBeenCalledWith(expect.stringContaining('无法连接本地服务'),'error');expect(h.save).not.toHaveBeenCalled();expect(h.state.load).not.toHaveBeenCalled()})
it('rejects malformed documents and reports transport errors',async()=>{h.project.mockResolvedValue({id:'wrong',blocks:[]});await mount();expect(h.state.notify).toHaveBeenCalled();expect(h.state.load).not.toHaveBeenCalled()})
it('ignores project results after page hide and resumes the pending startup safely',async()=>{const pending=deferred();h.projects.mockReturnValueOnce(pending.promise);await mount();window.dispatchEvent(new Event('pagehide'));pending.resolve([{id:'old'}]);await flush();expect(h.project).not.toHaveBeenCalled();window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false}));await flush();expect(h.projects).toHaveBeenCalledTimes(1);window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));await flush();expect(h.state.load).toHaveBeenCalledWith(doc())})
it('cancels startup when unmounted while themes are loading',async()=>{const pending=deferred();h.themes.mockReturnValue(pending.promise);await mount();await act(async()=>root.unmount());root=createRoot(host);pending.resolve(undefined);await flush();expect(h.projects).not.toHaveBeenCalled()})
it('protects unsaved unload and renders real toast status',async()=>{h.state.toast={kind:'error',text:'Preserve draft'};await mount();expect(host.textContent).toContain('Preserve draft');const saved=new Event('beforeunload',{cancelable:true});window.dispatchEvent(saved);expect(saved.defaultPrevented).toBe(false);h.state.saveStatus='error';const dirty=new Event('beforeunload',{cancelable:true});window.dispatchEvent(dirty);expect(dirty.defaultPrevented).toBe(true)})
it('collision prefers nested targets, excludes own children and falls back honestly',async()=>{await mount();h.hits=[{id:'outer'},{id:'child',data:{droppableContainer:{data:{current:{parentId:'other'}}}}},{id:'self',data:{droppableContainer:{data:{current:{parentId:'drag'}}}}}];expect(h.dnd.collisionDetection({active:{id:'drag'}}).map((x:any)=>x.id)).toEqual(['child','outer']);h.hits=[];expect(h.dnd.collisionDetection({active:{id:'drag'}})).toBe(h.fallback)})
it('inserts library, kit and component blocks at actual boundaries and keeps boxes unnested',async()=>{
 const child=createBlock('heading'),box=createBlock('box',{children:[child]}),after=createBlock('heading');h.state.doc=doc([box,after]);h.project.mockResolvedValue(h.state.doc);await mount()
 act(()=>h.dnd.onDragStart({active:{id:'lib:heading'}}));expect(host.querySelector('.drag-overlay')).toBeTruthy();act(()=>h.dnd.onDragEnd(drag('lib:heading','box:'+box.id)));expect(h.state.insertBlock).toHaveBeenLastCalledWith(expect.objectContaining({type:'heading'}),1,box.id)
 act(()=>h.dnd.onDragEnd(drag('lib:box','box:'+box.id)));expect(h.state.insertBlock).toHaveBeenLastCalledWith(expect.objectContaining({type:'box'}),1,null)
 act(()=>h.dnd.onDragStart({active:{id:'kit:'+KIT_ITEMS[0].key}}));act(()=>h.dnd.onDragEnd(drag('kit:'+KIT_ITEMS[0].key)));expect(h.state.insertBlock).toHaveBeenCalledTimes(3)
 act(()=>h.dnd.onDragStart({active:{id:'kit:missing'}}));act(()=>h.dnd.onDragEnd(drag('kit:missing')));expect(h.state.insertBlock).toHaveBeenCalledTimes(3)
 const e=drag('comp:x','box:'+box.id);e.active.data.current={block:box,missing:['photo'],label:'Saved'};act(()=>h.dnd.onDragStart(e));act(()=>h.dnd.onDragEnd(e));expect(h.insert).toHaveBeenCalledWith(box,{index:1,parentId:null,missing:['photo']})
 act(()=>h.dnd.onDragEnd(drag('comp:empty')));act(()=>h.dnd.onDragCancel());expect(host.querySelector('.drag-overlay')).toBeNull()
})
it('moves existing blocks within and across containers and ignores invalid drops',async()=>{
 const a=createBlock('heading'),child=createBlock('heading'),box=createBlock('box',{children:[child]});h.state.doc=doc([a,box]);h.project.mockResolvedValue(h.state.doc);await mount()
 act(()=>h.dnd.onDragStart({active:{id:a.id}}));act(()=>h.dnd.onDragEnd(drag(a.id,box.id)));expect(h.state.moveBlock).toHaveBeenCalledWith(a.id,1)
 act(()=>h.dnd.onDragEnd(drag(child.id,'canvas-end')));expect(h.state.moveBlockTo).toHaveBeenCalledWith(child.id,null,2)
 act(()=>h.dnd.onDragEnd(drag(box.id,child.id)));expect(h.state.moveBlockTo).toHaveBeenLastCalledWith(box.id,null,0)
 act(()=>h.dnd.onDragEnd(drag(a.id,null)));act(()=>h.dnd.onDragEnd(drag(a.id,'box:missing')));act(()=>h.dnd.onDragEnd(drag('missing',a.id)));act(()=>h.dnd.onDragEnd(drag(a.id,a.id)))
})
it('drops assets into image, gallery and kit targets or inserts a new image',async()=>{
 const image=createBlock('image'),gallery=createBlock('gallery'),photos=createBlock('photos');h.state.doc=doc([image,gallery,photos]);h.project.mockResolvedValue(h.state.doc);await mount()
 const asset={id:'asset',file:'test.png'};const event=(over:string)=>{const e=drag('asset:asset',over);e.active.data.current={asset};return e}
 act(()=>h.dnd.onDragStart(event(image.id)));act(()=>h.dnd.onDragEnd(event(image.id)));expect(h.state.updateProps).toHaveBeenLastCalledWith(image.id,{image:{src:'/media/test.png'}})
 act(()=>h.dnd.onDragEnd(event(gallery.id)));expect(h.state.updateProps).toHaveBeenLastCalledWith(gallery.id,{images:expect.arrayContaining([{src:'/media/test.png'}])})
 h.add.mockReturnValue({...photos,props:{pics:['new']}});act(()=>h.dnd.onDragEnd(event(photos.id)));expect(h.state.updateProps).toHaveBeenLastCalledWith(photos.id,{pics:['new']});h.add.mockReturnValue(null);act(()=>h.dnd.onDragEnd(event(photos.id)));expect(h.state.notify).toHaveBeenCalled()
 act(()=>h.dnd.onDragEnd(event('canvas-end')));expect(h.state.insertBlock).toHaveBeenCalledWith(expect.objectContaining({type:'image'}),3,null)
 const e=event(image.id);e.activatorEvent={clientX:10,clientY:20} as any;e.delta={x:1,y:2};vi.stubGlobal('document',document);Object.defineProperty(document,'elementsFromPoint',{configurable:true,value:vi.fn(()=>[document.createElement('img')])});h.photo.mockReturnValue({pos:{blockId:image.id,index:0},img:document.createElement('img')});const changed=doc([gallery]);h.replace.mockReturnValue(changed);act(()=>h.dnd.onDragEnd(e));expect(h.state.commit).toHaveBeenCalledWith(changed)
})
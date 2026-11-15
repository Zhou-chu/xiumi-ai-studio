// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Block, Doc } from '../../src/core/types'
import type { Asset } from '../../src/editor/api'

type Drag = { active:{id:string;data:{current:unknown};rect:{current:{translated:null|{top:number;height:number}}}}; over:null|{id:string;rect:{top:number;height:number}}; activatorEvent:Event|null; delta:{x:number;y:number} }
type Adapter = { children:ReactNode; onDragStart:(event:Drag)=>void;onDragEnd:(event:Drag)=>void;onDragCancel:()=>void;collisionDetection:(event:unknown)=>unknown }
type State = { doc:Doc; saved:boolean; selectedId:string|null; editingId:string|null; toast:null|{kind:string;text:string} }
const h=vi.hoisted(()=>({
  dnd:null as unknown as Adapter, state:null as unknown as State,
  projects:vi.fn(), project:vi.fn(), load:vi.fn(), save:vi.fn(), themes:vi.fn(), events:vi.fn(),
  insert:vi.fn(), move:vi.fn(), moveTo:vi.fn(), props:vi.fn(), commit:vi.fn(), select:vi.fn(), notify:vi.fn(), undo:vi.fn(),redo:vi.fn(),removeSelected:vi.fn(),
  component:vi.fn(), photoTarget:vi.fn(), slotTarget:vi.fn(), shownRatio:vi.fn(), replacePhoto:vi.fn(), addPicTo:vi.fn(),
  pointer:vi.fn(), closest:vi.fn(),
  unexpected:()=>{throw Error('Unexpected App adapter invocation')},
}))
vi.mock('@dnd-kit/core',()=>({
  DndContext:(props:Adapter)=>{h.dnd=props;return props.children},
  DragOverlay:({children}:{children:ReactNode})=>children, MeasuringStrategy:{Always:0}, PointerSensor:Symbol('pointer'),
  pointerWithin:h.pointer, closestCenter:h.closest, useSensor:()=>null, useSensors:()=>[],
}))
vi.mock('../../src/editor/api',()=>({
  api:{projects:h.projects,project:h.project},
  assetRef:(asset:Asset)=>({src:'/media/'+asset.file,assetId:asset.id}),
}))
vi.mock('../../src/editor/store',()=>{
  const getState=()=>({ ...h.state, saveStatus:h.state.saved?'saved':'dirty',
    insertBlock:h.insert, moveBlock:h.move, moveBlockTo:h.moveTo, updateProps:h.props, commit:h.commit,
    select:h.select, notify:h.notify, undo:h.undo, redo:h.redo, removeSelected:h.removeSelected })
  return {
    useStore:Object.assign((select:(value:ReturnType<typeof getState>)=>unknown)=>select(getState()),{ getState }),
    emptyDoc:()=>({...h.state.doc,id:'synthetic-empty'}), loadCustomThemes:h.themes, saveNow:h.save,
  }
})
vi.mock('../../src/editor/documentNavigation',()=>({loadIfUnchanged:h.load}))
vi.mock('../../src/editor/componentActions',()=>({insertComponent:h.component}))
vi.mock('../../src/editor/Canvas',()=>({
  Canvas:()=>createElement('p',{id:'canvas-substitute'},'Canvas boundary'),
  photoTarget:h.photoTarget,slotTarget:h.slotTarget,shownRatio:h.shownRatio,
}))
vi.mock('../../src/editor/CollectModal',()=>({CollectHost:()=>null}))
vi.mock('../../src/editor/LeftPanel',()=>({LeftPanel:()=>null}))
vi.mock('../../src/editor/RightPanel',()=>({RightPanel:()=>null}))
vi.mock('../../src/editor/ReplayPreview',()=>({ReplayHost:()=>null}))
vi.mock('../../src/editor/Toolbar',()=>({Toolbar:()=>null}))
vi.mock('../../src/editor/Workspace',()=>({Workspace:({children}:{children:ReactNode})=>children}))
vi.mock('../../src/editor/suggestionQueue',()=>({listenForAiSettings:h.events}))
vi.mock('../../src/core/photos',()=>({addPicTo:h.addPicTo,replacePhoto:h.replacePhoto}))
import App from '../../src/App'

let host:HTMLDivElement
let root:Root
const paragraph=(id:string):Block<'paragraph'>=>({...createBlock('paragraph'),id})
const box=(id:string,children:Block[]):Block<'box'>=>({...createBlock('box',{children}),id})
const newDoc=(blocks:Block[]=[paragraph('first'),paragraph('second')]):Doc=>({
  id:'current-memory',title:'Fixture title',author:'',digest:'',themeId:'fixture',blocks,createdAt:1,updatedAt:1,
})
const mount=()=>act(async()=>root.render(createElement(App)))
const dragEvent=(id:string,over:string|null,options:{data?:unknown;offset?:number;activator?:Event}={}):Drag=>({
  active:{id,data:{current:options.data},rect:{current:{translated:options.offset===undefined?null:{top:options.offset,height:10}}}},
  over:over===null?null:{id:over,rect:{top:5,height:10}},
  activatorEvent:options.activator??null,delta:{x:0,y:0},
})
const sendDrag=(id:string,over:string|null,options?:Parameters<typeof dragEvent>[2])=>act(()=>h.dnd.onDragEnd(dragEvent(id,over,options)))
const key=(target:EventTarget,init:KeyboardEventInit)=>{
  const event=new KeyboardEvent('keydown',{...init,bubbles:true,cancelable:true})
  act(()=>target.dispatchEvent(event))
  return event
}
const asset:Asset={id:'fixture-image',file:'fixture.jpg',name:'Fixture',width:10,height:20,size:42,createdAt:1}

beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('fetch',vi.fn(h.unexpected))
  for(const mock of [h.projects,h.project,h.save,h.insert,h.move,h.moveTo,h.props,h.commit,h.select,h.notify,h.undo,h.redo,h.removeSelected,h.component])mock.mockReset().mockImplementation(h.unexpected)
  h.state={doc:newDoc(),saved:true,selectedId:null,editingId:null,toast:null}
  h.projects.mockResolvedValue([{id:'first-stored'}]);h.project.mockResolvedValue(h.state.doc)
  h.load.mockReset().mockReturnValue(false);h.themes.mockReset().mockResolvedValue(undefined);h.events.mockReset().mockReturnValue(()=>{})
  h.photoTarget.mockReset().mockReturnValue(null);h.slotTarget.mockReset().mockReturnValue(null);h.shownRatio.mockReset().mockReturnValue(undefined)
  h.replacePhoto.mockReset().mockImplementation(h.unexpected);h.addPicTo.mockReset().mockImplementation(h.unexpected)
  h.pointer.mockReset().mockReturnValue([]);h.closest.mockReset().mockReturnValue([])
  for(const mock of [h.insert,h.move,h.moveTo,h.props,h.commit,h.select,h.notify,h.undo,h.redo,h.removeSelected,h.component])mock.mockImplementation(()=>{})
  host=document.createElement('div'); document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})

it('uses the captured initial document when delegating first saved project load',async()=>{
  const before=h.state.doc
  const stored={...before,id:'first-stored'}
  h.project.mockResolvedValueOnce(stored)
  await mount()
  expect(h.themes).toHaveBeenCalledOnce()
  expect(h.project).toHaveBeenCalledExactlyOnceWith('first-stored')
  expect(h.load).toHaveBeenCalledExactlyOnceWith(stored,before)
  expect(host.querySelector('#canvas-substitute')).not.toBeNull()
  expect(h.save).not.toHaveBeenCalled()
})

it('creates a document only when initialize confirms that an empty response may replace the initial draft',async()=>{
  h.projects.mockResolvedValueOnce([]);h.load.mockReturnValueOnce(true);h.save.mockResolvedValueOnce(true)
  const before=h.state.doc
  await mount()
  expect(h.project).not.toHaveBeenCalled()
  expect(h.load).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:'synthetic-empty'}),before)
  expect(h.save).toHaveBeenCalledOnce()
})

it('does not load or notify after App unmounts while the initial project response is pending',async()=>{
  let resolve!:(doc:Doc)=>void
  h.project.mockImplementationOnce(()=>new Promise<Doc>(done=>{resolve=done}))
  await mount()
  expect(h.project).toHaveBeenCalledOnce()
  await act(async()=>root.render(null))
  await act(async()=>resolve(newDoc()))
  expect(h.load).not.toHaveBeenCalled()
  expect(h.save).not.toHaveBeenCalled()
  expect(h.notify).not.toHaveBeenCalled()
})

it('cancels page unloading only for an unsaved store receipt and releases the listener after unmount',async()=>{
  const fire=()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}
  await mount()
  expect(fire()).toBe(false)
  h.state.saved=false
  expect(fire()).toBe(true)
  await act(async()=>root.render(null))
  expect(fire()).toBe(false)
})

it('owns Ctrl/Meta shortcuts outside editable controls and releases them on unmount',async()=>{
  h.save.mockResolvedValueOnce(true)
  await mount()
  expect(key(host,{key:'s',ctrlKey:true}).defaultPrevented).toBe(true)
  expect(key(host,{key:'z',metaKey:true}).defaultPrevented).toBe(true)
  expect(key(host,{key:'z',ctrlKey:true,shiftKey:true}).defaultPrevented).toBe(true)
  expect(key(host,{key:'y',metaKey:true}).defaultPrevented).toBe(true)
  expect(h.save).toHaveBeenCalledOnce();expect(h.undo).toHaveBeenCalledOnce();expect(h.redo).toHaveBeenCalledTimes(2)
  key(host,{key:'Escape'});expect(h.select).toHaveBeenCalledExactlyOnceWith(null)
  await act(async()=>root.render(null))
  expect(key(host,{key:'z',ctrlKey:true}).defaultPrevented).toBe(false)
  expect(h.undo).toHaveBeenCalledOnce()
})

it('does not intercept edits while a dialog, native input or content-editable owns the keyboard',async()=>{
  await mount();h.state.selectedId='first'
  const dialog=document.createElement('div');dialog.setAttribute('role','dialog');host.append(dialog)
  try {expect(key(host,{key:'Delete'}).defaultPrevented).toBe(false)} finally {dialog.remove()}
  const input=document.createElement('textarea');host.append(input)
  const editable=document.createElement('div');Object.defineProperty(editable,'isContentEditable',{value:true});host.append(editable)
  try {
    expect(key(input,{key:'z',ctrlKey:true}).defaultPrevented).toBe(false)
    expect(key(editable,{key:'Backspace',isComposing:true}).defaultPrevented).toBe(false)
  } finally {input.remove();editable.remove()}
  expect(h.undo).not.toHaveBeenCalled();expect(h.removeSelected).not.toHaveBeenCalled()
  h.state.editingId='first'
  expect(key(host,{key:'Delete'}).defaultPrevented).toBe(false)
  h.state.editingId=null
  expect(key(host,{key:'Delete'}).defaultPrevented).toBe(true)
  expect(h.removeSelected).toHaveBeenCalledOnce()
})

it('delegates article block moves within a layer and keeps a text box outside another box',async()=>{
  h.state.doc=newDoc([paragraph('first'),box('outer',[paragraph('inside')]),box('other',[]),paragraph('last')])
  await mount()
  sendDrag('missing','first');sendDrag('first','first');sendDrag('first','missing');sendDrag('first',null)
  expect(h.move).not.toHaveBeenCalled();expect(h.moveTo).not.toHaveBeenCalled()
  sendDrag('first','last')
  expect(h.move).toHaveBeenCalledExactlyOnceWith('first',3)
  sendDrag('first','inside',{offset:10})
  expect(h.moveTo).toHaveBeenNthCalledWith(1,'first','outer',1)
  sendDrag('other','inside')
  expect(h.moveTo).toHaveBeenNthCalledWith(2,'other',null,2)
})

it('inserts new library modules at their destination and clears the drag overlay on cancellation',async()=>{
  h.state.doc=newDoc([paragraph('first'),box('outer',[paragraph('inside')])])
  await mount()
  act(()=>h.dnd.onDragStart(dragEvent('asset:fixture',null)))
  expect(host.querySelector('.drag-overlay')?.textContent).toBe('图片')
  act(()=>h.dnd.onDragCancel());expect(host.querySelector('.drag-overlay')).toBeNull()
  sendDrag('lib:paragraph','box:outer')
  expect(h.insert).toHaveBeenNthCalledWith(1,expect.objectContaining({type:'paragraph'}),1,'outer')
  sendDrag('lib:box','inside')
  expect(h.insert).toHaveBeenNthCalledWith(2,expect.objectContaining({type:'box'}),2,null)
})

it('preserves component-library metadata when routing a component drop to the lower half',async()=>{
  await mount()
  const item=paragraph('component-fixture')
  sendDrag('comp:fixture','first',{offset:10,data:{block:item,missing:['fixture-source']}})
  expect(h.component).toHaveBeenCalledExactlyOnceWith(item,{index:1,parentId:null,missing:['fixture-source']})
  expect(h.insert).not.toHaveBeenCalled()
})

it('appends an asset to a gallery or inserts a new image when the destination is not an image module',async()=>{
  const gallery={...createBlock('gallery',{images:[{src:'/media/original.jpg'}]}),id:'gallery'}
  h.state.doc=newDoc([paragraph('first'),gallery])
  await mount()
  sendDrag('asset:fixture','gallery',{data:{asset}})
  expect(h.props).toHaveBeenCalledExactlyOnceWith('gallery',{images:[{src:'/media/original.jpg'},{src:'/media/fixture.jpg',assetId:asset.id}]})
  expect(h.select).toHaveBeenCalledExactlyOnceWith('gallery')
  sendDrag('asset:fixture','canvas-end',{data:{asset}})
  expect(h.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({type:'image',props:expect.objectContaining({image:{src:'/media/fixture.jpg',assetId:asset.id}})}),2,null)
})

it('does not insert a full image group and instead explains how to replace a picture',async()=>{
  h.state.doc=newDoc([{...createBlock('carousel'),id:'group'}])
  h.addPicTo.mockReturnValueOnce(null)
  await mount()
  sendDrag('asset:fixture','group',{data:{asset}})
  expect(h.select).toHaveBeenCalledExactlyOnceWith('group')
  expect(h.notify).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('已放满'),'error')
  expect(h.props).not.toHaveBeenCalled();expect(h.insert).not.toHaveBeenCalled()
})

it('prefers nested pointer hits and never targets a moving box inside itself',async()=>{
  await mount()
  const hit=(id:string,parentId:string|null)=>({id,data:{droppableContainer:{data:{current:{parentId}}}}})
  const parent=hit('parent',null),child=hit('child','different'),inside=hit('self-child','self')
  h.pointer.mockReturnValueOnce([parent,inside,child]).mockReturnValueOnce([inside])
  h.closest.mockReturnValueOnce([parent])
  expect(h.dnd.collisionDetection({active:{id:'self'}})).toEqual([child,parent])
  expect(h.closest).not.toHaveBeenCalled()
  expect(h.dnd.collisionDetection({active:{id:'self'}})).toEqual([parent])
})

it('uses pointer-target replacement before fallback insertion, preserving the shown crop ratio',async()=>{
  await mount()
  const target=document.createElement('img')
  const coords=vi.fn(()=>[target])
  const previous=Object.getOwnPropertyDescriptor(document,'elementsFromPoint')
  Object.defineProperty(document,'elementsFromPoint',{value:coords,configurable:true})
  const next={...h.state.doc,title:'Photo replaced'}
  const pos={blockId:'first',index:0}
  h.photoTarget.mockReturnValueOnce({img:target,pos})
  h.replacePhoto.mockReturnValueOnce(next)
  h.shownRatio.mockReturnValueOnce(1.5)
  try {
    sendDrag('asset:fixture','second',{data:{asset},activator:new MouseEvent('pointerdown',{clientX:11,clientY:12})})
  } finally {
    if(previous)Object.defineProperty(document,'elementsFromPoint',previous)
    else Reflect.deleteProperty(document,'elementsFromPoint')
  }
  expect(coords).toHaveBeenCalledExactlyOnceWith(11,12)
  expect(h.slotTarget).not.toHaveBeenCalled()
  expect(h.replacePhoto).toHaveBeenCalledExactlyOnceWith(h.state.doc,pos,{src:'/media/fixture.jpg',assetId:asset.id},{ratio:1.5,allowEmpty:true})
  expect(h.commit).toHaveBeenCalledExactlyOnceWith(next)
  expect(h.select).toHaveBeenCalledExactlyOnceWith('first')
  expect(h.insert).not.toHaveBeenCalled()
})

it('does not route composing keyboard events to document edits or save when their target is outside an editable element',async()=>{
  h.save.mockResolvedValue(true)
  await mount();h.state.selectedId='first'
  const defaults=[
    key(host,{key:'Delete',isComposing:true}).defaultPrevented,
    key(host,{key:'Escape',isComposing:true}).defaultPrevented,
    key(host,{key:'z',ctrlKey:true,isComposing:true}).defaultPrevented,
    key(host,{key:'s',metaKey:true,isComposing:true}).defaultPrevented,
  ]
  expect.soft(defaults).toEqual([false,false,false,false])
  expect.soft(h.removeSelected).not.toHaveBeenCalled()
  expect.soft(h.select).not.toHaveBeenCalled()
  expect.soft(h.undo).not.toHaveBeenCalled()
  expect(h.save).not.toHaveBeenCalled()
})

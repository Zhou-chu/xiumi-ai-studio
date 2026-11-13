// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { Canvas, styleObj, photoTarget, slotTarget, shownRatio } from '../../src/editor/Canvas'
import { emptyDoc, useStore } from '../../src/editor/store'
import { createBlock } from '../../src/core/blocks'
vi.mock('../../src/core/compiler',async importOriginal=>{const actual=await importOriginal<typeof import('../../src/core/compiler')>();return {...actual,compileBlock:(block:any,...args:any[])=>{if(block.id==='broken')throw new Error('synthetic renderer failure');return (actual.compileBlock as any)(block,...args)}}})
vi.mock('../../src/editor/HtmlTypographyControls',()=>({HtmlTypographyControls:()=>null}))
vi.mock('../../src/editor/ImageResize',()=>({ImageResize:()=>null}))
vi.mock('../../src/editor/RichEditor',()=>({RichEditor:({onChange,onDone}:any)=><div><button data-testid="rich-change" onClick={()=>onChange({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'changed'}]}]})}>change</button><button data-testid="rich-done" onClick={onDone}>done</button></div>}))
vi.mock('../../src/editor/Toolbar',()=>({PhonePreview:()=>null}))
vi.mock('../../src/editor/api',()=>({api:{saveTemplate:vi.fn().mockResolvedValue({})}}))
const dndState=vi.hoisted(()=>({active:false}))
vi.mock('@dnd-kit/core',async importOriginal=>{const actual=await importOriginal<typeof import('@dnd-kit/core')>();return {...actual,useDroppable:(...args:Parameters<typeof actual.useDroppable>)=>({...actual.useDroppable(...args),isOver:dndState.active})}})
vi.mock('@dnd-kit/sortable',async importOriginal=>{const actual=await importOriginal<typeof import('@dnd-kit/sortable')>();return {...actual,useSortable:(...args:Parameters<typeof actual.useSortable>)=>({...actual.useSortable(...args),isOver:dndState.active,isDragging:dndState.active})}})
const state=useStore.getState()
let host:HTMLDivElement,root:Root
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
 useStore.setState(state,true);localStorage.clear();dndState.active=false
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 Element.prototype.scrollIntoView=vi.fn()
 vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
async function render(blocks:any[]=[]){useStore.setState({doc:{...emptyDoc(),blocks}});await act(async()=>root.render(<Canvas/>))}
async function event(el:Element,event:Event){await act(async()=>{el.dispatchEvent(event)})}
async function click(el:Element,mods:any={}){await event(el,new MouseEvent('click',{bubbles:true,...mods}))}
it('parses real inline style declarations and preserves colon values',()=>{expect(styleObj('font-size:16px;color:red;background-image:url(https://example.com/x);invalid')).toEqual({fontSize:'16px',color:'red',backgroundImage:'url(https://example.com/x)'})})
it('renders empty canvas, zoom buttons, shortcuts and wheel without changing document',async()=>{
 await render();const doc=useStore.getState().doc
 await click(host.querySelector('[data-testid="zoom-in"]')!);expect(host.querySelector('.phone')?.getAttribute('data-zoom')).toBe('1.1')
 await click(host.querySelector('[data-testid="zoom-out"]')!);expect(host.querySelector('.phone')?.getAttribute('data-zoom')).toBe('1')
 await event(window as any,new KeyboardEvent('keydown',{key:'+',ctrlKey:true,cancelable:true}));expect(localStorage.getItem('xiumi-canvas-zoom')).toBe('1.1')
 await event(window as any,new KeyboardEvent('keydown',{key:'-',metaKey:true}));await event(window as any,new WheelEvent('wheel',{deltaY:-100,ctrlKey:true,cancelable:true}))
 expect(Number(host.querySelector('.phone')?.getAttribute('data-zoom'))).toBeGreaterThan(1)
 await event(window as any,new KeyboardEvent('keydown',{key:'0',ctrlKey:true}));expect(host.querySelector('.phone')?.getAttribute('data-zoom')).toBe('1')
 await event(window as any,new KeyboardEvent('keydown',{key:'x',ctrlKey:true}));await event(window as any,new WheelEvent('wheel',{deltaY:100}))
 await click(host.querySelector('[data-testid="zoom-reset"]')!);expect(useStore.getState().doc).toBe(doc)
})
it('Ctrl/Cmd toggles blocks, ordinary click resets and blank space clears',async()=>{
 const a=createBlock('html',{html:'<p>A</p>'}),b=createBlock('html',{html:'<p>B</p>'});await render([a,b])
 const block=(id:string)=>host.querySelector(`[data-block-id="${id}"]`)!
 await click(block(a.id));await click(block(b.id),{ctrlKey:true});expect(useStore.getState().selectedIds).toEqual([a.id,b.id]);expect(host.querySelectorAll('.block.selected')).toHaveLength(2)
 await click(block(a.id),{metaKey:true});expect(useStore.getState().selectedIds).toEqual([b.id])
 await click(block(a.id));expect(useStore.getState().selectedIds).toEqual([a.id]);await click(host.querySelector('.canvas-scroll')!);expect(useStore.getState().selectedIds).toEqual([])
})
it('editable HTML commits clean content, media deletion and Escape do not toggle selection',async()=>{
 const a=createBlock('html',{html:'<p>Before</p><img src="https://example.com/a.png">'});await render([a]);const block=host.querySelector('[data-block-id]')!
 await click(block);await event(block,new MouseEvent('dblclick',{bubbles:true}));const editor=host.querySelector('.html-editor')!
 expect(useStore.getState().editingId).toBe(a.id)
 await click(editor.querySelector('p')!,{ctrlKey:true});expect(useStore.getState().selectedIds).toEqual([a.id])
 await click(editor.querySelector('img')!);expect(host.querySelector('[data-testid="delete-picked"]')).toBeTruthy()
 await event(editor,new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));expect((useStore.getState().doc.blocks[0].props as { html: string }).html).not.toContain('<img')
 editor.querySelector('p')!.textContent='After';await event(editor,new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(useStore.getState().editingId).toBeNull();expect((useStore.getState().doc.blocks[0].props as { html: string }).html).toContain('After')
})
it('nested child can move out and toolbar deletion/duplication operate only on selected block',async()=>{
 const child=createBlock('heading',{title:'Heading'}),box=createBlock('box',{children:[child]});await render([box]);await click(host.querySelector(`[data-block-id="${child.id}"]`)!)
 await click(host.querySelector('[data-testid="move-out"]')!);expect(useStore.getState().doc.blocks).toHaveLength(2)
 const toolbar=host.querySelector(`[data-block-id="${child.id}"] .block-toolbar`)!
 const buttons=[...toolbar.querySelectorAll('button')];const duplicate=buttons.find(b=>b.title==='复制模块')!;await click(duplicate)
 expect(useStore.getState().doc.blocks).toHaveLength(3)
 await click(host.querySelector('.block.selected .block-toolbar .danger')!);expect(useStore.getState().doc.blocks).toHaveLength(2)
})
it('non-editable blocks ignore doubleclick while HTML split and picker are real controls',async()=>{
 const d=createBlock('divider'),h=createBlock('html',{html:'<p>one</p><p>two</p>'});await render([d,h])
 await event(host.querySelector(`[data-block-id="${d.id}"]`)!,new MouseEvent('dblclick',{bubbles:true}));expect(useStore.getState().editingId).toBeNull()
 await click(host.querySelector(`[data-block-id="${h.id}"]`)!);await click(host.querySelector('[data-testid="pick-fragment"]')!);expect(useStore.getState().pickingId).toBe(h.id)
 await act(async()=>useStore.getState().setPicking(null));await click(host.querySelector('[data-testid="split-block"]')!);expect(useStore.getState().toast).toBeTruthy()
})

it('selects nested fragments, expands, shrinks, hovers and collects a real fragment',async()=>{
 const h=createBlock('html',{html:'<section><p>one <b>bold</b></p><p>two</p></section>'});await render([h]);await click(host.querySelector('[data-block-id]')!);await click(host.querySelector('[data-testid="pick-fragment"]')!)
 const picker=host.querySelector('[data-testid="fragment-picker"]')!;const text=picker.querySelector('b')!
 await event(text,new MouseEvent('mouseover',{bubbles:true}));await click(text)
 expect(host.querySelector('[data-testid="pick-collect"]')?.hasAttribute('disabled')).toBe(false)
 await click(host.querySelector('[data-testid="pick-expand"]')!);await click(host.querySelector('[data-testid="pick-shrink"]')!)
 await event(picker,new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}));await click(host.querySelector('[data-testid="pick-collect"]')!);expect(useStore.getState().pickingId).toBeNull()
 await act(async()=>useStore.getState().setPicking(h.id));await click(host.querySelector('[data-testid="pick-cancel"]')!);expect(useStore.getState().pickingId).toBeNull()
})
it('swaps actual images through drag lifecycle and ignores unrelated drags',async()=>{
 const a=createBlock('html',{html:'<img src="https://example.com/a.png">'}),b=createBlock('html',{html:'<img src="https://example.com/b.png">'});await render([a,b])
 let imgs=host.querySelectorAll('img');expect(imgs[0].dataset.photo).toBe('0')
 const values=new Map<string,string>();const transfer={types:[] as string[],setData(k:string,v:string){values.set(k,v);this.types.push(k)},getData:(k:string)=>values.get(k)||'',effectAllowed:'',dropEffect:''}
 const drag=async(el:Element,type:string,y=10)=>{const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientY:y});Object.defineProperty(e,'dataTransfer',{value:transfer});await event(el,e)}
 await drag(host.querySelector('.canvas-scroll')!,'dragstart');await drag(imgs[0],'dragover');await drag(imgs[1],'drop')
 await drag(imgs[0],'dragstart');expect(imgs[0].classList.contains('photo-dragging')).toBe(true)
 await drag(imgs[1],'dragover');expect(imgs[1].classList.contains('photo-drop')).toBe(true)
 await drag(imgs[1],'dragover',500);await drag(imgs[1],'drop');await drag(imgs[0],'dragend')
 expect((useStore.getState().doc.blocks[0].props as { html: string }).html).toContain('b.png');expect(useStore.getState().past).toHaveLength(1)
 imgs=host.querySelectorAll('img')
 expect(photoTarget(imgs[0])?.pos.blockId).toBe(a.id);expect(photoTarget(null)).toBeNull();expect(slotTarget(imgs[0])).toBeNull()
 imgs[0].dataset.slot='2';expect(slotTarget(imgs[0])?.pos.index).toBe(2)
 vi.spyOn(imgs[0],'getBoundingClientRect').mockReturnValue({width:100,height:50} as DOMRect);expect(shownRatio(imgs[0])).toBe(.5);expect(shownRatio(null)).toBeUndefined()
})
it('saves a template only after a name is supplied and emits refresh event',async()=>{
 const {api}=await import('../../src/editor/api');await render([createBlock('heading',{title:'Heading'})]);await click(host.querySelector('[data-block-id]')!)
 const button=[...host.querySelectorAll('button')].find(b=>b.title==='收藏为模板')!;vi.stubGlobal('prompt',vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('saved'))
 await click(button);expect(api.saveTemplate).not.toHaveBeenCalled();const refresh=vi.fn();window.addEventListener('templates-changed',refresh)
 await click(button);expect(api.saveTemplate).toHaveBeenCalled();expect(refresh).toHaveBeenCalled();window.removeEventListener('templates-changed',refresh)
})
it('HTML completion button commits and selected media can be deleted with its dedicated button',async()=>{
 const h=createBlock('html',{html:'<section><img src="https://example.com/a.png"></section><p>text</p>'});await render([h]);await event(host.querySelector('[data-block-id]')!,new MouseEvent('dblclick',{bubbles:true}))
 const editor=host.querySelector('.html-editor')!;await click(editor.querySelector('img')!);await event(host.querySelector('[data-testid="delete-picked"]')!,new MouseEvent('mousedown',{bubbles:true,cancelable:true}))
 expect(editor.querySelector('img')).toBeNull();await event(host.querySelector('.rich-toolbar .done')!,new MouseEvent('mousedown',{bubbles:true,cancelable:true}));await click(host.querySelector('.rich-toolbar .done')!);expect(useStore.getState().editingId).toBeNull()
})

it('inserts a component at the saved real HTML caret without creating a new block',async()=>{
 const {insertComponent}=await import('../../src/editor/componentActions')
 const h=createBlock('html',{html:'<p>anchor</p><p>next</p>'});await render([h]);await event(host.querySelector('[data-block-id]')!,new MouseEvent('dblclick',{bubbles:true}))
 const text=host.querySelector('.html-editor p')!.firstChild!;const range=document.createRange();range.setStart(text,2);range.collapse(true);document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range)
 await event(document as any,new Event('selectionchange'));await act(async()=>insertComponent(createBlock('html',{html:'<p>inserted</p>'})))
 expect(useStore.getState().doc.blocks).toHaveLength(1);expect((useStore.getState().doc.blocks[0].props as any).html).toContain('inserted')
})
it('rich editors emit updates and completion for paragraph and card',async()=>{
 for (const type of ['paragraph','card'] as const) {
  const b=createBlock(type);await render([b]);await event(host.querySelector('[data-block-id]')!,new MouseEvent('dblclick',{bubbles:true}));await act(async()=>{await new Promise(r=>setTimeout(r,5))})
  await click(host.querySelector('[data-testid="rich-change"]')!);expect(JSON.stringify(useStore.getState().doc.blocks[0])).toContain('changed');await click(host.querySelector('[data-testid="rich-done"]')!);expect(useStore.getState().editingId).toBeNull()
 }
})
it('plain text editor updates real fields and completes, toolbar moves and collect preserve scope',async()=>{
 const a=createBlock('heading',{title:'A'}),b=createBlock('heading',{title:'B'});await render([a,b]);await click(host.querySelector(`[data-block-id="${b.id}"]`)!)
 let toolbar=host.querySelector('.block.selected .block-toolbar')!;await click(toolbar.querySelectorAll('button')[1]);expect(useStore.getState().doc.blocks[0].id).toBe(b.id)
 toolbar=host.querySelector('.block.selected .block-toolbar')!;await click(toolbar.querySelectorAll('button')[2]);expect(useStore.getState().doc.blocks[1].id).toBe(b.id)
 const collect=vi.fn();window.addEventListener('open-collect',collect);await click(host.querySelector('[data-testid="collect-block"]')!);expect(collect).toHaveBeenCalled();window.removeEventListener('open-collect',collect)
 await event(host.querySelector(`[data-block-id="${b.id}"]`)!,new MouseEvent('dblclick',{bubbles:true}));const input=host.querySelectorAll('textarea')[1];const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!
 await act(async()=>{setter.call(input,'Changed heading');input.dispatchEvent(new Event('input',{bubbles:true}))});expect((useStore.getState().doc.blocks[1].props as any).title).toBe('Changed heading')
 await event(input,new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(useStore.getState().editingId).toBeNull()
})

it('restores persisted zoom and safely handles unavailable local storage',async()=>{
 localStorage.setItem('xiumi-canvas-zoom','1.4');await render();expect(host.querySelector('.phone')?.getAttribute('data-zoom')).toBe('1.4')
 const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('unavailable')});await click(host.querySelector('[data-testid="zoom-in"]')!);expect(host.querySelector('[data-testid="zoom-reset"]')?.textContent).toBe('150%');set.mockRestore()
})
it('shows empty nested boxes and edits rich children using box styling',async()=>{
 const empty=createBlock('box',{children:[]});const child=createBlock('imageText');const box=createBlock('box',{children:[child]});await render([empty,box]);expect(host.querySelector('.box-drop.empty')).toBeTruthy()
 await event(host.querySelector(`[data-block-id="${child.id}"]`)!,new MouseEvent('dblclick',{bubbles:true}));await act(async()=>{await new Promise(r=>setTimeout(r,5))});await click(host.querySelector('[data-testid="rich-done"]')!)
})
it('media selection handles wrappers, svg, backgrounds and clears on normal typing',async()=>{
 const h=createBlock('html',{html:'<section><svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg></section><section style="background-image:url(https://example.com/bg.png)"></section><p>text</p>'});await render([h]);await event(host.querySelector('[data-block-id]')!,new MouseEvent('dblclick',{bubbles:true}));const editor=host.querySelector('.html-editor')!
 await click(editor.querySelector('path')!);expect(host.querySelector('[data-testid="delete-picked"]')).toBeTruthy();await event(editor,new KeyboardEvent('keydown',{key:'a',bubbles:true}));expect(host.querySelector('[data-testid="delete-picked"]')).toBeNull()
 await click(editor.querySelector('[style]')!);expect(host.querySelector('[data-testid="delete-picked"]')).toBeTruthy();await event(editor,new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));await click(editor);expect(host.querySelector('[data-testid="delete-picked"]')).toBeNull()
 await event(editor,new FocusEvent('focusout',{bubbles:true}));expect(useStore.getState().doc.blocks).toHaveLength(1)
})
it('same-photo drag is a no-op and moving off target clears its indicator',async()=>{
 await render([createBlock('html',{html:'<img src="https://example.com/a.png">'})]);const img=host.querySelector('img')!,scroll=host.querySelector('.canvas-scroll')!;const doc=useStore.getState().doc
 const values=new Map<string,string>();const transfer={types:['application/x-xiumi-photo'],setData:(k:string,v:string)=>values.set(k,v),getData:(k:string)=>values.get(k)||''}
 const drag=async(el:Element,type:string,y=120)=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientY:y});Object.defineProperty(event,'dataTransfer',{value:transfer});await act(async()=>el.dispatchEvent(event))}
 vi.spyOn(scroll,'getBoundingClientRect').mockReturnValue({top:0,bottom:500} as DOMRect)
 await drag(img,'dragstart');await drag(img,'dragover');await drag(scroll,'dragover');expect(img.classList.contains('photo-drop')).toBe(false)
 await drag(img,'drop');expect(useStore.getState().doc).toBe(doc);await drag(img,'dragend')
})
it('a malformed block is contained and can be removed without losing healthy neighbors',async()=>{
 const consoleError=vi.spyOn(console,'error').mockImplementation(()=>{})
 const bad={...createBlock('paragraph'),id:'broken'},good=createBlock('heading',{title:'Healthy'});await render([bad,good]);expect(host.querySelector('.render-error')).toBeTruthy();expect(host.textContent).toContain('Healthy')
 await click(host.querySelector('.render-error .danger')!);expect(useStore.getState().doc.blocks.map(b=>b.id)).toEqual([good.id]);consoleError.mockRestore()
})

it('renders drag-over and dragging feedback supplied by the drag engine',async()=>{
 dndState.active=true;await render([createBlock('box',{children:[]})]);expect(host.querySelector('.block.over')?.getAttribute('style')).toContain('opacity: 0.4');expect(host.querySelector('.drop-end.over')).toBeTruthy();expect(host.querySelector('.box-drop.over')).toBeTruthy()
})
it('starts with safe default zoom when reading storage throws',async()=>{
 const get=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('denied')});await render();expect(host.querySelector('.phone')?.getAttribute('data-zoom')).toBe('1');get.mockRestore()
})

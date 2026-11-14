// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { Canvas } from '../../src/editor/Canvas'
import { emptyDoc, useStore } from '../../src/editor/store'
import { createBlock } from '../../src/core/blocks'
vi.mock('../../src/editor/HtmlTypographyControls',()=>({HtmlTypographyControls:()=>null}))
vi.mock('../../src/editor/ImageResize',()=>({ImageResize:()=>null}))
vi.mock('../../src/editor/Toolbar',()=>({PhonePreview:()=>null}))
const state=useStore.getState()
let host:HTMLDivElement, root:Root
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;useStore.setState(state,true);host=document.createElement('div');document.body.append(host);root=createRoot(host);Element.prototype.scrollIntoView=vi.fn();vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
async function render(blocks:any[]){useStore.setState({doc:{...emptyDoc(),blocks}});await act(async()=>root.render(<Canvas/>))}
async function click(el:Element,mods:any={}){expect(el).toBeTruthy();await act(async()=>{el.dispatchEvent(new MouseEvent('click',{bubbles:true,...mods}))})}
it('provides independent native selection buttons preserving multi-selection and article HTML',async()=>{
 const a=createBlock('html',{html:'<p>A</p>'}),b=createBlock('html',{html:'<p>B</p>'});await render([a,b]);const before=useStore.getState().doc
 const buttons=host.querySelectorAll<HTMLButtonElement>('.block-select');expect(buttons).toHaveLength(2);expect(buttons[0].tagName).toBe('BUTTON');expect(buttons[0].getAttribute('aria-label')).toBeTruthy()
 await click(buttons[0]);await click(buttons[1],{ctrlKey:true});expect(useStore.getState().selectedIds).toEqual([a.id,b.id]);expect(buttons[0].getAttribute('aria-pressed')).toBe('true');await click(buttons[0],{metaKey:true});expect(useStore.getState().selectedIds).toEqual([b.id]);expect(useStore.getState().doc).toBe(before)
})
it('deletes selected media with a native click and restores focus after HTML editing',async()=>{
 const a=createBlock('html',{html:'<p>A</p><img src="https://example.com/a.png">'});await render([a]);await act(async()=>useStore.getState().setEditing(a.id));const editor=host.querySelector('.html-editor')!;expect(editor.getAttribute('role')).toBe('textbox');expect(editor.getAttribute('aria-label')).toBeTruthy();await click(editor.querySelector('img')!);await click(host.querySelector('[data-testid="delete-picked"]')!);expect((useStore.getState().doc.blocks[0].props as any).html).not.toContain('<img');await act(async()=>editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));expect(document.activeElement).toBe(host.querySelector('.block-select'))
})
it('navigates initial fragments without pointer selection and leaves stored HTML untouched',async()=>{
 const a=createBlock('html',{html:'<section><p>First</p><p>Second</p></section>'});await render([a]);const before=useStore.getState().doc;await act(async()=>useStore.getState().setPicking(a.id));const next=host.querySelector('[data-testid="pick-next"]')!;expect(document.activeElement).toBe(next);await click(next);expect(host.querySelector('[data-testid="pick-collect"]')?.hasAttribute('disabled')).toBe(false);expect(host.querySelector('[data-testid="pick-status"]')?.textContent).toContain('First');await click(next);expect(host.querySelector('[data-testid="pick-status"]')?.textContent).toContain('Second');expect(useStore.getState().doc).toBe(before)
})
it('focuses the first text field only on entering editing and returns focus on completion',async()=>{
 const a=createBlock('heading',{title:'Heading'});await render([a]);await act(async()=>useStore.getState().setEditing(a.id));expect(document.activeElement?.tagName).toBe('TEXTAREA');const editor=host.querySelector('[data-testid="inline-block-text"]')!;await act(async()=>editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));expect(document.activeElement).toBe(host.querySelector('.block-select'))
})

it('supports fragment Home/End and arrows without changing article or trapping Escape',async()=>{
 const a=createBlock('html',{html:'<section><p>First</p><p>Second</p><p>Last</p></section>'});await render([a]);await act(async()=>useStore.getState().setPicking(a.id));const control=host.querySelector<HTMLButtonElement>('[data-testid="pick-next"]')!;control.focus()
 const key=async(key:string)=>{await act(async()=>{control.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))})}
 await key('End');expect(host.querySelector('[data-testid="pick-status"]')?.textContent).toBe('Last');await key('ArrowUp');expect(host.querySelector('[data-testid="pick-status"]')?.textContent).toBe('Second');await key('Home');expect(host.querySelector('[data-testid="pick-status"]')?.textContent).toBe('First');expect(document.activeElement).toBe(control)
 await click(host.querySelector('[data-testid="pick-cancel"]')!);expect(document.activeElement).toBe(host.querySelector('.block-select'));expect((useStore.getState().doc.blocks[0].props as any).html).toBe(a.props.html)
})

it('handles modified keyboard activation once and ignores repeated keydown',async()=>{
 const a=createBlock('heading',{title:'A'}),b=createBlock('heading',{title:'B'});await render([a,b]);const buttons=host.querySelectorAll<HTMLButtonElement>('.block-select');await click(buttons[0]);
 const key=async(el:Element,key:string,metaKey=false,repeat=false)=>{const event=new KeyboardEvent('keydown',{key,metaKey,repeat,bubbles:true,cancelable:true});await act(async()=>{el.dispatchEvent(event)});expect(event.defaultPrevented).toBe(true)}
 await key(buttons[1],' ',true);expect(useStore.getState().selectedIds).toEqual([a.id,b.id]);await key(buttons[0],'Enter',true);expect(useStore.getState().selectedIds).toEqual([b.id]);await key(buttons[0],'Enter',true,true);expect(useStore.getState().selectedIds).toEqual([b.id]);expect(buttons[0].getAttribute('aria-label')).not.toBe(buttons[1].getAttribute('aria-label'))
})
it('does not steal focus when an external selection ends editing',async()=>{
 const a=createBlock('heading',{title:'A'}),b=createBlock('heading',{title:'B'});await render([a,b]);await act(async()=>useStore.getState().setEditing(a.id));const second=host.querySelectorAll<HTMLButtonElement>('.block-select')[1];second.focus();await click(second);expect(document.activeElement).toBe(second)
})

it('names the text editing action rather than exposing only its icon',async()=>{
 const a=createBlock('heading',{title:'A'});await render([a]);await click(host.querySelector('.block-select')!);expect(host.querySelector('button[title="编辑文字（双击）"]')?.getAttribute('aria-label')).toBe('编辑文字（双击）')
})

it('exposes an explicit tab stop for source editing and a named fragment navigation group',async()=>{
 const a=createBlock('html',{html:'<p>First</p><p>Second</p>'});await render([a]);await act(async()=>useStore.getState().setEditing(a.id));
 expect(host.querySelector('.html-editor')?.getAttribute('tabindex')).toBe('0');
 await act(async()=>useStore.getState().setPicking(a.id));
 const group=host.querySelector('[role="group"][aria-label="原文片段选择"]');expect(group).not.toBeNull();expect(group?.contains(host.querySelector('[data-testid="pick-next"]'))).toBe(true)
})

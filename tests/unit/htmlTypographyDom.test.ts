// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import type { Mock } from 'vitest'
import { HtmlTypographyControls } from '../../src/editor/HtmlTypographyControls'
import { THEMES } from '../../src/core/themes'
import { TEXT_FONTS } from '../../src/core/textTypography'
let host:HTMLDivElement,editor:HTMLDivElement,root:Root,commit:Mock<(...args:any[])=>any>,exec:Mock<(...args:any[])=>any>,state:Mock<(...args:any[])=>any>,mixed:Mock<(...args:any[])=>any>
const capture=(start:Node,end=start,from=0,to=end.textContent?.length??0)=>{const range=document.createRange();range.setStart(start,from);range.setEnd(end,to);const selection=document.getSelection()!;selection.removeAllRanges();selection.addRange(range);act(()=>document.dispatchEvent(new Event('selectionchange')));return range}
const change=(selector:string,value:string)=>{const el=host.querySelector<HTMLInputElement|HTMLSelectElement>(selector)!;act(()=>{Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})}
const click=(label:string)=>act(()=>host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');editor=document.createElement('div');editor.contentEditable='true';editor.tabIndex=0;editor.innerHTML='<p>Alpha <b>Beta</b></p><p>Gamma</p>';document.body.append(editor,host);root=createRoot(host);commit=vi.fn();exec=vi.fn(()=>true);state=vi.fn(()=>false);mixed=vi.fn(()=>false);Object.defineProperties(document,{execCommand:{configurable:true,value:exec},queryCommandState:{configurable:true,value:state},queryCommandIndeterm:{configurable:true,value:mixed}});await act(async()=>root.render(createElement(HtmlTypographyControls, { rootRef: { current: editor }, onCommit: () => { commit() }, theme: THEMES[0] })))})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();editor.remove();document.getSelection()?.removeAllRanges();vi.restoreAllMocks()})
it('requires a noncollapsed in-editor selection and ignores absent/outside selections',()=>{
 expect(host.querySelector('select')!.disabled).toBe(true);act(()=>document.dispatchEvent(new Event('selectionchange')))
 capture(editor.querySelector('p')!.firstChild!,undefined,1,1);expect(host.querySelector('select')!.disabled).toBe(true)
 capture(editor.querySelector('p')!.firstChild!);expect(host.querySelector('select')!.disabled).toBe(false)
 const outside=document.createTextNode('Outside');host.append(outside);capture(outside);expect(host.querySelector('select')!.disabled).toBe(true)
})
it.each([['font','select[aria-label="原文字体"]',TEXT_FONTS[0].value],['size','select[aria-label="原文字号"]','20px']])('applies %s through native undo-aware insertHTML preserving range and toolbar focus',(_name,selector,value)=>{
 let committedSelection='';commit.mockImplementation(()=>{committedSelection=document.getSelection()!.toString()});const before=editor.innerHTML;capture(editor.querySelector('p')!.firstChild!,editor.querySelector('b')!.firstChild!,1,2);change(selector,value)
 expect(exec).toHaveBeenCalledWith('insertHTML',false,expect.stringContaining('span'));expect(commit).toHaveBeenCalledTimes(1);expect(editor.innerHTML).toBe(before);expect(committedSelection).toBe('lpha Be');expect(document.activeElement).toBe(host.querySelector(selector));expect(host.textContent).toContain('已应用')
})
it.each([['原文加粗','bold'],['原文斜体','italic'],['原文下划线','underline']])('uses the selected native %s command without adding exported UI', (label,command)=>{
 capture(editor.querySelector('b')!.firstChild!);const button=host.querySelector(`[aria-label="${label}"]`)!;const down=new MouseEvent('mousedown',{bubbles:true,cancelable:true});act(()=>button.dispatchEvent(down));expect(down.defaultPrevented).toBe(true)
 click(label);expect(exec).toHaveBeenCalledWith(command,false,'');expect(commit).toHaveBeenCalledTimes(1);expect(editor.querySelector('.html-typography-controls')).toBeNull()
})
it('tracks active and mixed format states and applies explicit text color',()=>{
 state.mockImplementation(c=>c==='bold');mixed.mockImplementation(c=>c==='italic');capture(editor.querySelector('b')!.firstChild!)
 expect(host.querySelector('[aria-label="原文加粗"]')!.getAttribute('aria-pressed')).toBe('true');expect(host.querySelector('[aria-label="原文斜体"]')!.getAttribute('aria-pressed')).toBe('mixed')
 click('文字颜色');change('[data-testid="html-text-color-custom"]','#123456');expect(exec).toHaveBeenCalledWith('foreColor',false,'#123456');expect(commit).toHaveBeenCalledTimes(1)
})
it('refuses stale content and reports unsupported native commands',()=>{
 capture(editor.querySelector('p')!.firstChild!);editor.innerHTML='<p>Manual replacement</p>';click('原文加粗');expect(exec).not.toHaveBeenCalled();expect(host.textContent).toContain('选区已变化')
 capture(editor.querySelector('p')!.firstChild!);exec.mockReturnValue(false);click('原文下划线');expect(commit).not.toHaveBeenCalled();expect(host.textContent).toContain('不支持')
})
it('preserves a saved range while focus moves within the toolbar and does not leak deletion shortcuts',()=>{
 capture(editor.querySelector('p')!.firstChild!);const select=host.querySelector('select')!;select.focus();const outside=document.createTextNode('outside');host.append(outside);capture(outside);expect(select.disabled).toBe(false)
 const listener=vi.fn();window.addEventListener('keydown',listener);act(()=>select.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})));expect(listener).not.toHaveBeenCalled();window.removeEventListener('keydown',listener)
 click('原文加粗');expect(exec).toHaveBeenCalledWith('bold',false,'')
})
it('rejects cross-cell ranges and native formatting over SVG without damaging structures',()=>{
 editor.innerHTML='<table><tbody><tr><td>First</td><td>Second</td></tr></tbody></table>';const cells=editor.querySelectorAll('td');capture(cells[0].firstChild!,cells[1].firstChild!);click('原文斜体');expect(exec).not.toHaveBeenCalled();expect(host.textContent).toContain('同一个文本区域')
 editor.innerHTML='<p>Before<svg><text>Art</text></svg>After</p>';const p=editor.querySelector('p')!;capture(p.firstChild!,p.lastChild!);click('原文加粗');expect(exec).not.toHaveBeenCalled();expect(editor.querySelector('svg')).toBeTruthy()
})
it('does not apply empty or unsupported font selection',()=>{capture(editor.querySelector('p')!.firstChild!);change('select[aria-label="原文字体"]','');expect(exec).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled()})
it('rejects a live Range adjusted by equal-HTML node replacement', () => {
 capture(editor.querySelector('p')!.firstChild!); const same = editor.innerHTML; editor.innerHTML = same
 click('原文加粗'); expect(exec).not.toHaveBeenCalled(); expect(host.textContent).toContain('选区已变化')
})
it('rejects an editor detached from the document', () => {
 capture(editor.querySelector('p')!.firstChild!); editor.remove(); click('原文加粗'); expect(exec).not.toHaveBeenCalled()
})
it('labels template color explicitly and never clears other marks with removeFormat', () => {
 capture(editor.querySelector('b')!.firstChild!); click('文字颜色')
 const reset=host.querySelector<HTMLButtonElement>('[data-testid="html-text-color-reset"]')!
 expect(reset.textContent).toBe('使用当前模板正文色')
 act(()=>reset.click())
 expect(exec).toHaveBeenCalledWith('foreColor',false,THEMES[0].colors.text)
 expect(exec).not.toHaveBeenCalledWith('removeFormat',expect.anything(),expect.anything())
})
it('color popup Escape closes it without executing or committing any format', () => {
 capture(editor.querySelector('p')!.firstChild!); click('文字颜色')
 act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))
 expect(host.querySelector('[data-testid="html-text-color-pop"]')).toBeNull()
 expect(exec).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled()
})

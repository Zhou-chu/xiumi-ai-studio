// @vitest-environment jsdom
import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import type { Mock } from 'vitest'
import { getTheme } from '../../src/core/themes'
import { TEXT_FONTS } from '../../src/core/textTypography'
const h=vi.hoisted(()=>({editor:null as any,options:{} as any,chain:{} as any,attrs:{} as any,active:new Set<string>(),align:'justify',stateAbsent:false}))
vi.mock('@tiptap/react',()=>({useEditor:(options:any)=>{h.options=options;return h.editor},useEditorState:({selector}:any)=>h.stateAbsent?null:selector({editor:h.editor}),EditorContent:({style}:any)=><div data-content style={style}/>}))
import { RichEditor } from '../../src/editor/RichEditor'
let host:HTMLDivElement,root:Root,change:Mock<(...args:any[])=>any>,done:Mock<(...args:any[])=>any>
const value={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Original'}]}]}
async function render(fontSize?:number){await act(async()=>root.render(<RichEditor value={value} theme={getTheme('minimal-magazine')} onChange={v=>{change(v)}} onDone={()=>{done()}} fontSize={fontSize}/>))}
function set(selector:string,value:string){const e=host.querySelector<HTMLInputElement|HTMLSelectElement>(selector)!;act(()=>{Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);change=vi.fn();done=vi.fn();h.attrs={};h.active=new Set();h.align='justify';h.stateAbsent=false;h.chain={};for(const name of ['focus','setFontFamily','unsetFontFamily','setFontSize','unsetFontSize','setColor','unsetColor','toggleBold','toggleItalic','toggleUnderline','toggleHighlight','unsetAllMarks','toggleBulletList','toggleOrderedList','setTextAlign','unsetLink','setLink','run'])h.chain[name]=vi.fn(()=>h.chain);h.editor={chain:()=>h.chain,getJSON:()=>value,getAttributes:()=>h.attrs,isActive:(q:any)=>typeof q==='string'?h.active.has(q):q.textAlign===h.align,state:{selection:{empty:true}},destroy:vi.fn()}})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks()})
it('handles unavailable editor and configured update/keyboard lifecycle',async()=>{h.editor=null;await render();expect(host.textContent).toBe('');expect(h.options.autofocus).toBe('end');expect(h.options.editorProps.handleKeyDown(null,new KeyboardEvent('keydown',{key:'Escape'}))).toBe(true);expect(done).toHaveBeenCalled();expect(h.options.editorProps.handleKeyDown(null,new KeyboardEvent('keydown',{key:'Enter'}))).toBe(false);h.options.onUpdate({editor:{getJSON:()=>value}});expect(change).toHaveBeenCalledWith(value)})
it('exposes existing custom typography and changes/reset font size and explicit color',async()=>{
 h.attrs={fontFamily:'Custom Face',fontSize:'17px',color:'invalid'};h.editor.state.selection.empty=false;await render(22)
 expect(host.textContent).toContain('原字体');expect(host.textContent).toContain('17px');expect(host.textContent).toContain('选中文字');expect((host.querySelector('[data-content]') as HTMLElement).style.fontSize).toBe('22px')
 set('[aria-label="正文字体"]',TEXT_FONTS[0].value);expect(h.chain.setFontFamily).toHaveBeenCalledWith(TEXT_FONTS[0].value);set('[aria-label="正文字体"]','');expect(h.chain.unsetFontFamily).toHaveBeenCalled()
 set('[aria-label="正文字号"]','20px');expect(h.chain.setFontSize).toHaveBeenCalledWith('20px');set('[aria-label="正文字号"]','');expect(h.chain.unsetFontSize).toHaveBeenCalled()
 set('[aria-label="正文文字颜色"]','#123456');expect(h.chain.setColor).toHaveBeenCalledWith('#123456')
 const listener=vi.fn();window.addEventListener('keydown',listener);act(()=>host.querySelector('.rich-toolbar')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})));expect(listener).not.toHaveBeenCalled();window.removeEventListener('keydown',listener)
})
it('runs every formatting action with explicit pressed states and keeps clicks inside editor',async()=>{
 h.active=new Set(['bold','italic','underline','highlight','bulletList','orderedList']);h.align='left';h.attrs={fontFamily:TEXT_FONTS[0].value,fontSize:'20px',color:'#abcdef'};await render()
 const listener=vi.fn();window.addEventListener('click',listener)
 for(const b of Array.from(host.querySelectorAll<HTMLButtonElement>('.rich-toolbar button'))){if(b.getAttribute('aria-label')==='链接')continue;const down=new MouseEvent('mousedown',{bubbles:true,cancelable:true});act(()=>b.dispatchEvent(down));expect(down.defaultPrevented).toBe(true);act(()=>b.click())}
 expect(listener).not.toHaveBeenCalled();window.removeEventListener('click',listener)
 for(const name of ['unsetColor','toggleBold','toggleItalic','toggleUnderline','toggleHighlight','setColor','unsetAllMarks','toggleBulletList','toggleOrderedList','setTextAlign'])expect(h.chain[name]).toHaveBeenCalled()
 expect(h.chain.setTextAlign.mock.calls.map((c:any)=>c[0])).toEqual(['left','center','right','justify']);expect(done).toHaveBeenCalledTimes(1)
 expect(host.querySelector('[aria-label="斜体"]')!.getAttribute('aria-pressed')).toBe('true')
})
it('handles link removal, a valid new link, cancellation and default empty selection',async()=>{
 h.align='none';await render();expect(host.textContent).toContain('随后输入');const prompt=vi.spyOn(window,'prompt').mockReturnValue('https://example.com')
 const link=()=>act(()=>host.querySelector<HTMLButtonElement>('[aria-label="链接"]')!.click());link();expect(h.chain.setLink).toHaveBeenCalledWith({href:'https://example.com'});prompt.mockReturnValue(null);link();expect(h.chain.setLink).toHaveBeenCalledTimes(1);h.active.add('link');await render();link();expect(h.chain.unsetLink).toHaveBeenCalled()
 const editor=h.editor;await act(async()=>root.unmount());expect(editor.destroy).toHaveBeenCalled();root=createRoot(host)
})
it('renders defensive toolbar defaults before editor selection state is available',async()=>{h.stateAbsent=true;await render();expect(host.querySelector<HTMLSelectElement>('[aria-label="正文字体"]')!.value).toBe('');expect(host.querySelector<HTMLInputElement>('[aria-label="正文文字颜色"]')!.value).toBe('#222222');expect(host.querySelector('[aria-label="斜体"]')!.getAttribute('aria-pressed')).toBe('false')})
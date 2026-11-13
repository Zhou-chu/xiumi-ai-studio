// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {Workspace,effectiveWidths,clampWidth} from '../../src/editor/Workspace'
let host:HTMLDivElement,root:Root,width:number,resize:()=>void
const workspace=()=>host.querySelector('main')!
const handle=(side:string)=>host.querySelector(`[data-testid="resizer-${side}"]`)!
const event=async(el:EventTarget,type:string,init:Record<string,unknown>={})=>{await act(async()=>{let e:Event;if(type.startsWith('key'))e=new KeyboardEvent(type,{bubbles:true,...init});else if(type.startsWith('pointer')){e=new MouseEvent(type,{bubbles:true,...init});Object.defineProperty(e,'pointerId',{value:1})}else e=new Event(type,{bubbles:true});el.dispatchEvent(e)})}
const mount=async()=>{await act(async()=>{root.render(<Workspace><aside className="panel left"><input aria-label="left input"/></aside><section className="canvas-wrap"><input aria-label="canvas input"/></section><aside className="panel right"><input aria-label="right input"/></aside></Workspace>)})}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();width=1440
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(()=>width)
 vi.stubGlobal('ResizeObserver',class{constructor(cb:()=>void){resize=cb}observe(){}disconnect(){}})
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})))
 Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});Object.defineProperty(HTMLElement.prototype,'releasePointerCapture',{configurable:true,value:vi.fn()})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear()})
it('switches panels by controls and valid external events, revealing focused panel on resize/theme only when switcher visible',async()=>{
 await mount();expect(workspace().dataset.workspaceView).toBe('canvas')
 for(const view of ['left','right','canvas']){await event(host.querySelector(`[data-testid="workspace-${view}"]`)!,'click');expect(workspace().dataset.workspaceView).toBe(view);expect(host.querySelector(`[data-testid="workspace-${view}"]`)?.getAttribute('aria-pressed')).toBe('true')}
 await act(async()=>{window.dispatchEvent(new CustomEvent('workspace-view',{detail:'right'}));window.dispatchEvent(new CustomEvent('workspace-view',{detail:'invalid'}))});expect(workspace().dataset.workspaceView).toBe('right')
 for(const view of ['left','right','canvas']){(host.querySelector(`[aria-label="${view} input"]`) as HTMLElement).focus();await event(window,'resize');expect(workspace().dataset.workspaceView).toBe(view)}
 const left=host.querySelector('[aria-label="left input"]') as HTMLElement;left.focus();await act(async()=>{document.documentElement.setAttribute('data-color-mode','dark')});expect(workspace().dataset.workspaceView).toBe('left')
 ;(host.querySelector('.workspace-switcher') as HTMLElement).style.display='none';(host.querySelector('[aria-label="right input"]') as HTMLElement).focus();await event(window,'resize');expect(workspace().dataset.workspaceView).toBe('left')
 left.blur();await event(window,'resize');expect(workspace().dataset.workspaceView).toBe('left')
})
it('restores bounded widths, keyboard resizes both directions, resets and persists; non-arrow keys leave widths alone',async()=>{
 localStorage.setItem('xiumi-panel-widths',JSON.stringify({left:999,right:20}));await mount()
 expect(workspace().style.getPropertyValue('--left-w')).toBe('560px');expect(workspace().style.getPropertyValue('--right-w')).toBe('240px')
 await event(handle('left'),'keydown',{key:'ArrowLeft'});expect(workspace().style.getPropertyValue('--left-w')).toBe('544px')
 await event(handle('left'),'keydown',{key:'ArrowRight',shiftKey:true});expect(workspace().style.getPropertyValue('--left-w')).toBe('560px')
 await event(handle('right'),'keydown',{key:'ArrowLeft',shiftKey:true});expect(workspace().style.getPropertyValue('--right-w')).toBe('288px')
 await event(handle('right'),'keydown',{key:'ArrowRight'});expect(workspace().style.getPropertyValue('--right-w')).toBe('272px')
 await event(handle('right'),'keydown',{key:'Enter'});expect(JSON.parse(localStorage.getItem('xiumi-panel-widths')!)).toEqual({left:560,right:272})
 await event(handle('left'),'dblclick');expect(workspace().style.getPropertyValue('--left-w')).toBe('');expect(JSON.parse(localStorage.getItem('xiumi-panel-widths')!)).toEqual({right:272})
 width=700;await act(async()=>resize());expect(workspace().style.getPropertyValue('--right-w')).toBe('240px');expect(JSON.parse(localStorage.getItem('xiumi-panel-widths')!)).toEqual({right:272})
 width=1440;await event(window,'resize');expect(workspace().style.getPropertyValue('--right-w')).toBe('272px')
})
it('pointer dragging previews without persisting until release, handles right direction and cleans resizing on unmount',async()=>{
 localStorage.setItem('xiumi-panel-widths',JSON.stringify({left:260,right:320}));await mount()
 await event(handle('left'),'pointermove',{clientX:800});expect(workspace().style.getPropertyValue('--left-w')).toBe('260px')
 await event(handle('left'),'pointerdown',{clientX:100});expect(document.body.classList.contains('resizing')).toBe(true)
 await event(handle('left'),'pointermove',{clientX:180});expect(workspace().style.getPropertyValue('--left-w')).toBe('340px');expect(JSON.parse(localStorage.getItem('xiumi-panel-widths')!).left).toBe(260)
 await event(handle('left'),'pointerup');expect(document.body.classList.contains('resizing')).toBe(false);expect(JSON.parse(localStorage.getItem('xiumi-panel-widths')!).left).toBe(340)
 await event(handle('right'),'pointerdown',{clientX:800});await event(handle('right'),'pointermove',{clientX:750});expect(workspace().style.getPropertyValue('--right-w')).toBe('370px');await event(handle('right'),'pointerup')
 await event(handle('right'),'pointerdown',{clientX:800});await act(async()=>root.render(null));expect(document.body.classList.contains('resizing')).toBe(false)
})
it('invalid storage and denied persistence leave resizing usable with default minima',async()=>{
 localStorage.setItem('xiumi-panel-widths','invalid');await mount();expect(workspace().style.getPropertyValue('--left-w')).toBe('')
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Denied')})
 await event(handle('left'),'keydown',{key:'ArrowRight'});expect(workspace().style.getPropertyValue('--left-w')).toBe('216px')
 await event(handle('right'),'keydown',{key:'ArrowLeft'});expect(workspace().style.getPropertyValue('--right-w')).toBe('256px')
})
it('ignores malformed widths and handles narrow/default and unmeasured bounds',async()=>{
 localStorage.setItem('xiumi-panel-widths',JSON.stringify({left:'bad',right:null}));await mount();expect(workspace().style.getPropertyValue('--left-w')).toBe('');expect(workspace().style.getPropertyValue('--right-w')).toBe('')
 expect(effectiveWidths({left:500,right:500},0)).toEqual({left:500,right:500})
 expect(effectiveWidths({left:500},1000)).toEqual({left:320})
 vi.mocked(window.matchMedia).mockReturnValue({matches:true} as MediaQueryList)
 expect(effectiveWidths({left:500},1000)).toEqual({left:360})
 expect(effectiveWidths({right:500},1000)).toEqual({right:430})
 expect(clampWidth('right',1000,300,260)).toBe(240)
})

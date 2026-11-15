// @vitest-environment jsdom
import { act, createElement as el } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Help } from '../../src/editor/Help'
let host:HTMLDivElement, root:Root
beforeEach(()=>{
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()})
const mount=()=>act(()=>root.render(el(Help,{title:'排版',children:el('span',null,'可选说明')})))
const button=()=>host.querySelector<HTMLButtonElement>('button')!
const note=()=>document.querySelector<HTMLElement>('[role="tooltip"]')
const event=(target:EventTarget,type:string)=>act(()=>target.dispatchEvent(new MouseEvent(type,{bubbles:true})))
const tick=(ms:number)=>act(()=>vi.advanceTimersByTime(ms))
it('opens a labelled body portal without bubbling activation to its containing action',()=>{
  const outer=vi.fn();act(()=>root.render(el('div',{onClick:outer},el(Help,{title:'排版',children:el('span',null,'可选说明')}))))
  expect(button().getAttribute('aria-label')).toBe('排版说明');expect(note()).toBeNull()
  act(()=>button().click())
  expect(note()?.textContent).toBe('可选说明');expect(host.contains(note())).toBe(false)
  expect(button().getAttribute('aria-describedby')).toBe(note()?.id);expect(outer).not.toHaveBeenCalled()
  act(()=>button().click());expect(note()).toBeNull();expect(button().getAttribute('aria-expanded')).toBe('false')
})
it('delays hover, cancels abandoned hover and lets pointer transfer into the note retain it',()=>{
  mount();const wrapper=host.querySelector('.help')!
  event(wrapper,'mouseover');tick(649);expect(note()).toBeNull()
  event(wrapper,'mouseout');tick(650);expect(note()).toBeNull()
  event(wrapper,'mouseover');tick(650);expect(note()).not.toBeNull()
  event(wrapper,'mouseout');tick(100);event(note()!,'mouseover');tick(100);expect(note()).not.toBeNull()
  event(note()!,'mouseout');expect(note()).toBeNull()
})
it('keeps a focused explanation on mouse leave and closes it when focus leaves the control group',()=>{
  mount();act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})))
  act(()=>button().focus());expect(note()).not.toBeNull()
  event(host.querySelector('.help')!,'mouseout');tick(200);expect(note()).not.toBeNull()
  act(()=>button().blur());expect(note()).toBeNull()
})
it('dismisses outside, resize and external scroll but preserves pointer and scroll inside its portal',()=>{
  mount();act(()=>button().click());event(note()!,'pointerdown');expect(note()).not.toBeNull()
  act(()=>note()!.dispatchEvent(new Event('scroll',{bubbles:true})));expect(note()).not.toBeNull()
  event(document.body,'pointerdown');expect(note()).toBeNull()
  act(()=>button().click());act(()=>window.dispatchEvent(new Event('resize')));expect(note()).toBeNull()
  act(()=>button().click());act(()=>document.body.dispatchEvent(new Event('scroll',{bubbles:true})));expect(note()).toBeNull()
})
it('owns Escape only while open and removes capture listeners after dismissal and unmount',()=>{
  mount();act(()=>button().click());const later=vi.fn();window.addEventListener('keydown',later)
  try {
  const escape=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})
  act(()=>window.dispatchEvent(escape));expect(escape.defaultPrevented).toBe(true);expect(later).not.toHaveBeenCalled()
  act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(later).toHaveBeenCalledTimes(1)
  event(host.querySelector('.help')!,'mouseover');act(()=>root.render(null));tick(1000);expect(note()).toBeNull()
  } finally { window.removeEventListener('keydown',later) }
})
it.each([
  [30,20,100,40,30,46], [190,170,100,40,92,124], [-5,2,250,300,8,8],
])('positions from measured geometry and clamps viewport edges (%s,%s)',(left,top,width,height,wantLeft,wantTop)=>{
  vi.stubGlobal('innerWidth',200);vi.stubGlobal('innerHeight',200)
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    return (this.classList.contains('help')?{left,top,bottom:top+20,width:30,height:20}:{left:0,top:0,bottom:height,width,height}) as DOMRect
  })
  mount();act(()=>button().click());expect(note()?.style.left).toBe(wantLeft+'px');expect(note()?.style.top).toBe(wantTop+'px')
})

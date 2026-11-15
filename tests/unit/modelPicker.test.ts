// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ModelPicker, movingModelIndex, openingModelIndex } from '../../src/editor/ModelPicker'
let host:HTMLDivElement
let root:Root
const models=Array.from({length:40},(_,i)=>({id:'model-'+i,contextWindow:128000}))
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const trigger=()=>host.querySelector<HTMLButtonElement>('[data-testid="ai-model-picker"]')!
const key=(name:string)=>act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true})))
it('starts collapsed, toggles, selects, and returns focus',()=>{
 const select=vi.fn()
 act(()=>root.render(createElement(ModelPicker,{models,value:'model-2',onSelect:select})))
 expect(trigger().getAttribute('aria-expanded')).toBe('false')
 expect(host.querySelector('[role="listbox"]')).toBeNull()
 act(()=>trigger().click())
 expect(host.querySelectorAll('[role="option"]')).toHaveLength(40)
 act(()=>host.querySelectorAll<HTMLElement>('[role="option"]')[5].click())
 expect(select).toHaveBeenCalledWith('model-5')
 expect(trigger().getAttribute('aria-expanded')).toBe('false')
 expect(document.activeElement).toBe(trigger())
 act(()=>trigger().click());act(()=>trigger().click())
 expect(host.querySelector('[role="listbox"]')).toBeNull()
})
it('supports keyboard boundaries and selection without changing value while browsing',()=>{
 const select=vi.fn()
 act(()=>root.render(createElement(ModelPicker,{models,value:'model-2',onSelect:select})))
 trigger().focus();key('ArrowDown');key('End')
 expect(host.querySelector('[data-active="true"]')?.textContent).toContain('model-39')
 key('ArrowUp');expect(select).not.toHaveBeenCalled()
 key('Home');key('ArrowDown');key(' ')
 expect(select).toHaveBeenCalledWith('model-1')
 expect(document.activeElement).toBe(trigger())
})


it('keeps DOM focus on listbox while virtual option focus moves and closes without stealing external focus',()=>{
 act(()=>root.render(createElement(ModelPicker,{models,value:'model-2',onSelect:vi.fn()})))
 trigger().focus();key('ArrowDown');const list=host.querySelector<HTMLElement>('[role="listbox"]')!;
 expect(document.activeElement).toBe(list);key('End');expect(document.activeElement).toBe(list);
 const active=host.querySelector<HTMLElement>('[data-active="true"]')!;expect(list.getAttribute('aria-activedescendant')).toBe(active.id);
 expect([...list.querySelectorAll<HTMLElement>('[role="option"]')].every(option=>option.tabIndex<0)).toBe(true);
 const outside=document.createElement('button');document.body.append(outside);act(()=>outside.focus());expect(host.querySelector('[role="listbox"]')).toBeNull();expect(document.activeElement).toBe(outside);outside.remove()
})
it('readonly cannot expand and outside pointer closes without stealing focus',()=>{
 act(()=>root.render(createElement(ModelPicker,{models,value:'model-2',disabled:true,onSelect:vi.fn()})))
 expect(trigger().disabled).toBe(true);act(()=>trigger().click());expect(host.querySelector('[role="listbox"]')).toBeNull()
 act(()=>root.render(createElement(ModelPicker,{models,value:'model-2',onSelect:vi.fn()})))
 act(()=>trigger().click());act(()=>document.body.dispatchEvent(new Event('pointerdown',{bubbles:true})))
 expect(host.querySelector('[role="listbox"]')).toBeNull()
})
it('virtual cursor is independent of the selected item and long accessible names are intact',()=>{
 const long='a'.repeat(300)
 act(()=>root.render(createElement(ModelPicker,{models:[{id:long},{id:'other'}],value:long,onSelect:vi.fn()})))
 expect(trigger().getAttribute('aria-label')).toContain(long)
 trigger().focus();key('ArrowDown');key('End')
 expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe(long)
 expect(host.querySelector('[data-active="true"]')?.textContent).toBe('other')
})


it.each(['below','above'] as const)('reveals fractional %s edges with integer scroll offsets and available local scroll range', direction=>{
 let offset=200
 const max=1000
 act(()=>root.render(createElement('div',{className:'modal-body'},createElement(ModelPicker,{models,value:'model-0',onSelect:vi.fn()}))))
 const body=host.querySelector<HTMLElement>('.modal-body')!
 Object.defineProperties(body,{clientHeight:{value:400},scrollHeight:{value:1400},scrollTop:{get:()=>offset,set:(next:number)=>{offset=Math.max(0,Math.min(max,Math.round(next)))}}})
 const bounds=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  if(this===body)return {top:100,bottom:500,height:400} as DOMRect
  if(this.getAttribute('role')==='listbox'){
   const top=(direction==='below'?476.3125:299.6875)-offset
   return {top,bottom:top+224,height:224} as DOMRect
  }
  return {top:300,bottom:320,height:20} as DOMRect
 })
 try {
  act(()=>trigger().click())
  const list=host.querySelector<HTMLElement>('[role="listbox"]')!
  expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(100)
  expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(500)
  expect(offset).toBe(direction==='below'?201:199)
  expect(max-offset).toBeGreaterThan(0)
  const revealed=offset;key('End');expect(offset).toBe(revealed)
  expect(document.documentElement.scrollTop).toBe(0)
 } finally {bounds.mockRestore()}
})

it('opens at the selected model, resets its cursor on reopen, and selects only from the listbox', () => {
 const select = vi.fn()
 act(() => root.render(createElement(ModelPicker, { models, value: 'model-2', onSelect: select })))
 const activeLabel = () => host.querySelector('[data-active="true"]')?.getAttribute('title')
 trigger().focus()
 key('ArrowUp')
 expect(activeLabel()).toBe('model-2')
 key('End')
 expect(activeLabel()).toBe('model-39')
 // Unhandled keys (including Tab and printable characters) remain native.
 for (const nativeKey of ['m', 'Tab']) {
  const event = new KeyboardEvent('keydown', { key: nativeKey, bubbles: true, cancelable: true })
  act(() => document.activeElement!.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
 }
 expect(activeLabel()).toBe('model-39')
 key('Escape')
 expect(document.activeElement).toBe(trigger())
 expect(select).not.toHaveBeenCalled()
 key('ArrowDown')
 expect(activeLabel()).toBe('model-2')
 key('Enter')
 expect(select).toHaveBeenCalledExactlyOnceWith('model-2')
 expect(document.activeElement).toBe(trigger())
})

it.each([['ArrowUp', 'model-39'], ['ArrowDown', 'model-0'], ['Home', 'model-0'], ['End', 'model-39']])(
 'opens with %s and no saved selection at %s', (openingKey, id) => {
  const select = vi.fn()
  act(() => root.render(createElement(ModelPicker, { models, value: 'manual-only', onSelect: select })))
  trigger().focus()
  key(openingKey)
  expect(host.querySelector('[data-active="true"]')?.getAttribute('title')).toBe(id)
  expect(select).not.toHaveBeenCalled()
 },
)

it('calculates opening and movement indices without accessing the DOM', () => {
 expect(openingModelIndex('ArrowDown', 2, 40)).toBe(2)
 expect(openingModelIndex('ArrowUp', -1, 40)).toBe(39)
 expect(openingModelIndex('Home', 2, 40)).toBe(0)
 expect(openingModelIndex('End', 2, 40)).toBe(39)
 expect(movingModelIndex('ArrowUp', 0, 40)).toBe(0)
 expect(movingModelIndex('ArrowDown', 39, 40)).toBe(39)
 expect(movingModelIndex('ArrowUp', 2, 40)).toBe(1)
 expect(movingModelIndex('ArrowDown', 2, 40)).toBe(3)
 expect(movingModelIndex('Home', 39, 40)).toBe(0)
 expect(movingModelIndex('End', 0, 40)).toBe(39)
})

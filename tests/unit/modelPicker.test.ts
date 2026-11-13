// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ModelPicker } from '../../src/editor/ModelPicker'
import { Modal } from '../../src/editor/Modal'
let host:HTMLDivElement
let root:Root
const models=Array.from({length:40},(_,i)=>({id:'model-'+i,contextWindow:128000}))
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove()})
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
it('Escape closes the picker before the containing modal',()=>{
 const close=vi.fn()
 act(()=>root.render(createElement(Modal,{title:'Settings',onClose:close,children:createElement(ModelPicker,{models,value:'model-0',onSelect:vi.fn()})})))
 act(()=>trigger().click());key('Escape')
 expect(close).not.toHaveBeenCalled()
 expect(trigger().getAttribute('aria-expanded')).toBe('false')
 expect(document.activeElement).toBe(trigger())
 key('Escape');expect(close).toHaveBeenCalledTimes(1)
})

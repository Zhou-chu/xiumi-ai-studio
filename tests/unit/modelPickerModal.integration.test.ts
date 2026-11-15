// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Modal } from '../../src/editor/Modal'
import { ModelPicker } from '../../src/editor/ModelPicker'
let host:HTMLDivElement
let root:Root
const models=Array.from({length:40},(_,i)=>({id:'model-'+i,contextWindow:128000}))
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const trigger=()=>host.querySelector<HTMLButtonElement>('[data-testid="ai-model-picker"]')!
const key=(name:string)=>act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true})))
it('Escape closes the picker before the containing modal',()=>{
 const close=vi.fn()
 act(()=>root.render(createElement(Modal,{title:'Settings',onClose:close,children:createElement(ModelPicker,{models,value:'model-0',onSelect:vi.fn()})})))
 act(()=>trigger().click());key('Escape')
 expect(close).not.toHaveBeenCalled()
 expect(trigger().getAttribute('aria-expanded')).toBe('false')
 expect(document.activeElement).toBe(trigger())
 key('Escape');expect(close).toHaveBeenCalledTimes(1)
})

it('nested dialog takes focus away from the picker and receives Escape without closing its parent',()=>{
 const outerClose=vi.fn(),innerClose=vi.fn()
 const picker=createElement(ModelPicker,{models,value:'model-0',onSelect:vi.fn()})
 const outer=createElement(Modal,{title:'Outer',onClose:outerClose,children:picker})
 act(()=>root.render(createElement('div',{},outer)));act(()=>trigger().click())
 act(()=>root.render(createElement('div',{},outer,createElement(Modal,{title:'Inner',onClose:innerClose,children:createElement('button',{},'Inner action')}))))
 expect(host.querySelector('[data-model-picker-open]')).toBeNull()
 expect(document.activeElement?.textContent).toBe('✕')
 key('Escape');expect(innerClose).toHaveBeenCalledTimes(1);expect(outerClose).not.toHaveBeenCalled()
})

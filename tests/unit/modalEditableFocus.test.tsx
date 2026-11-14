// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect} from 'vitest'
import {Modal} from '../../src/editor/Modal'
it('includes rich text inputs in the dialog focus cycle',()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  act(()=>root.render(<Modal title="Paste" onClose={()=>{}}><button data-before>Paste tab</button><div contentEditable role="textbox" aria-label="Paste input"/></Modal>))
  const before=host.querySelector<HTMLButtonElement>('[data-before]')!,editable=host.querySelector<HTMLElement>('[contenteditable]')!
  before.focus();const forward=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});act(()=>before.dispatchEvent(forward));expect(forward.defaultPrevented).toBe(false)
  editable.focus();const wrap=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});act(()=>editable.dispatchEvent(wrap));expect(wrap.defaultPrevented).toBe(true);expect(document.activeElement).toBe(host.querySelector('.close'))
 }finally{act(()=>root.unmount());host.remove()}
})

it('skips hidden, disabled and contenteditable=false targets when cycling backwards',()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  act(()=>root.render(<Modal title="Focus" onClose={()=>{}}><button data-last>Last visible</button><input type="hidden"/><div style={{display:'none'}}><div contentEditable/></div><div contentEditable aria-disabled="true"/><div contentEditable={false}/><button disabled>Disabled</button></Modal>))
  const first=host.querySelector<HTMLButtonElement>('.close')!;first.focus();act(()=>first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));expect(document.activeElement).toBe(host.querySelector('[data-last]'))
 }finally{act(()=>root.unmount());host.remove()}
})

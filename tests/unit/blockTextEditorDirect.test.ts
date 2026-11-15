// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Block } from '../../src/core/types'
import { BlockTextEditor } from '../../src/editor/BlockTextEditor'

let root: Root, host: HTMLDivElement
const patch=vi.fn(), done=vi.fn(), outer=vi.fn()
const q=<T extends HTMLElement=HTMLElement>(s:string)=>host.querySelector<T>(s)!
const labeled=(caption:string)=>[...host.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent===caption)!
function mount(block:Block){
  act(()=>root.render(createElement('div',{onClick:outer,onDoubleClick:outer,onKeyDown:outer},
    createElement(BlockTextEditor,{block,onChange:patch,onDone:done}))))
}
function value(node:HTMLTextAreaElement|HTMLSelectElement,next:string){
  const isSelect=node instanceof HTMLSelectElement
  act(()=>{
    Object.getOwnPropertyDescriptor(isSelect?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,'value')!.set!.call(node,next)
    node.dispatchEvent(new Event(isSelect?'change':'input',{bubbles:true}))
  })
}
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  for(const f of [patch,done,outer])f.mockClear()
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('focuses the first field and dispatches title changes for an image-bearing cover',()=>{
  const cover=createBlock('cover',{title:'原标题',image:{src:'/media/original.png'}})
  mount(cover)
  const field=labeled('标题').querySelector('textarea')!
  expect(document.activeElement).toBe(q('textarea'))
  expect(field.value).toBe('原标题')
  value(field,'新标题')
  expect(patch).toHaveBeenCalledExactlyOnceWith({title:'新标题'},'title')
  expect(cover.props.image?.src).toBe('/media/original.png')
  const alignment=labeled('封面标题对齐').querySelector('select')!
  value(alignment,'right')
  expect(patch).toHaveBeenLastCalledWith({titleAlign:'right'},'titleAlign')
})
it('preserves each image reference when changing only one caption in a fixed photo group',()=>{
  const pics=[{image:{src:'/media/a.png'},caption:'甲'},{image:{src:'/media/b.png'},caption:'乙'}]
  const snapshots=structuredClone(pics)
  mount(createBlock('photos',{pics,count:2}))
  value(labeled('图注 2').querySelector('textarea')!,'修改乙')
  expect(patch).toHaveBeenCalledExactlyOnceWith({pics:[pics[0],{...pics[1],caption:'修改乙'}]},'pics.1.caption')
  expect(pics).toEqual(snapshots)
  expect(q('select')).toBeNull()
})
it('updates one table cell without exposing or replacing unrelated text or rich-paragraph controls',()=>{
  const table=createBlock('table',{headers:['表头'],rows:[['原值']],caption:'说明'})
  mount(table)
  value(labeled('第 1 行第 1 列').querySelector('textarea')!,'新值')
  expect(patch).toHaveBeenCalledExactlyOnceWith({rows:[['新值']]},'rows.0.0')
  expect(table.props.rows).toEqual([['原值']])
  mount(createBlock('paragraph',{align:'right'}))
  expect(q('textarea')).toBeNull()
  expect(patch).toHaveBeenCalledTimes(1)
})
it('keeps ordinary keyboard behavior, ends on Escape without bubbling to editor and finishes via button',()=>{
  mount(createBlock('heading'))
  const area=q('textarea')
  act(()=>area.dispatchEvent(new MouseEvent('click',{bubbles:true})))
  act(()=>area.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})))
  expect(outer).not.toHaveBeenCalled()
  const normal=new KeyboardEvent('keydown',{key:'a',bubbles:true,cancelable:true})
  act(()=>area.dispatchEvent(normal))
  expect(normal.defaultPrevented).toBe(false)
  expect(outer).toHaveBeenCalledTimes(1)
  const escape=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})
  act(()=>area.dispatchEvent(escape))
  expect(escape.defaultPrevented).toBe(true)
  expect(outer).toHaveBeenCalledTimes(1)
  expect(done).toHaveBeenCalledOnce()
  act(()=>q('button').click())
  expect(outer).toHaveBeenCalledTimes(1)
  expect(done).toHaveBeenCalledTimes(2)
})

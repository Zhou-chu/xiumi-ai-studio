// @vitest-environment jsdom
import { act, createElement, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Area, Point } from 'react-easy-crop'
import type { Asset } from '../../src/editor/api'
import { CropModal } from '../../src/editor/CropModal'

interface CropAdapter {
  image: string; crop: Point; zoom: number; aspect: number; objectFit: string;
  onCropChange: (p: Point) => void; onZoomChange: (n: number) => void;
  onCropComplete: (fraction: Area, pixels: Area) => void;
}
const h = vi.hoisted(() => ({ crop: vi.fn(), notify: vi.fn(), adapter: null as CropAdapter | null }))
vi.mock('../../src/editor/api', () => ({ api: { cropAsset: h.crop } }))
vi.mock('../../src/editor/store', () => ({ useStore: { getState:()=>({notify:h.notify}) } }))
vi.mock('react-easy-crop', () => ({
  default: (props: CropAdapter) => { h.adapter = props; return createElement('div',{'data-crop-fixture':true}) },
}))
vi.mock('../../src/editor/Modal', () => ({
  Modal: ({ children, title, onClose }: { children:ReactNode; title:string; onClose:()=>void }) =>
    createElement('section',{role:'dialog','aria-label':title},children,createElement('button',{onClick:onClose},'关闭')),
}))
const pic:Asset={id:'fixture-a',file:'a.png',name:'原图甲',width:800,height:400,size:12,createdAt:1}
const cropped:Asset={...pic,id:'crop-result',file:'crop.png',name:'裁剪图',width:250,height:200}
const other:Asset={...pic,id:'fixture-b',file:'b.png',name:'原图乙'}
const pixel={x:12,y:14,width:250,height:200}
const percent={x:10,y:10,width:80,height:80}
const close=vi.fn(), done=vi.fn(), fetchGuard=vi.fn(()=>{throw Error('Unexpected crop transport')})
let root:Root,host:HTMLDivElement
const query=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!
const click=async(text:string)=>{await act(async()=>query(text).click())}
const mounted=(asset=pic)=>act(()=>root.render(createElement(CropModal,{asset,onClose:close,onDone:done})))
const ready=()=>act(()=>h.adapter!.onCropComplete(percent,pixel))
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  fetchGuard.mockClear();vi.stubGlobal('fetch',fetchGuard)
  h.crop.mockReset().mockImplementation(()=>{throw Error('Unexpected crop dispatch')})
  h.notify.mockReset();h.adapter=null;close.mockReset();done.mockReset()
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();expect(fetchGuard).not.toHaveBeenCalled();vi.unstubAllGlobals()})
it('initializes the crop adapter safely and does not enable saving until it receives pixel bounds',()=>{
  mounted()
  expect(host.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('裁剪：原图甲')
  expect(h.adapter).toMatchObject({image:'/media/a.png',crop:{x:0,y:0},zoom:1,aspect:4/3,objectFit:'contain'})
  expect(query('裁剪并另存').disabled).toBe(true)
  ready()
  expect(query('裁剪并另存').disabled).toBe(false)
})
it('supports explicit aspect ratios, retaining source ratio for free mode and controlled pan/zoom',async()=>{
  mounted()
  await click('自由');expect(h.adapter?.aspect).toBe(2)
  await click('公众号封面 2.35:1');expect(h.adapter?.aspect).toBe(2.35)
  act(()=>{h.adapter?.onCropChange({x:9,y:-12});h.adapter?.onZoomChange(2)})
  expect(h.adapter).toMatchObject({crop:{x:9,y:-12},zoom:2})
  const slider=host.querySelector('input')!
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'2.35');slider.dispatchEvent(new Event('input',{bubbles:true}))})
  expect(h.adapter?.zoom).toBe(2.35)
})
it('sends only crop pixel bounds, keeps the original, and waits for the asynchronous new asset receipt',async()=>{
  mounted();ready()
  let resolve!:(asset:Asset)=>void
  h.crop.mockReturnValueOnce(new Promise<Asset>(value=>{resolve=value}))
  await click('裁剪并另存')
  expect(h.crop).toHaveBeenCalledExactlyOnceWith(pic.id,pixel)
  expect(query('处理中…').disabled).toBe(true)
  expect(done).not.toHaveBeenCalled()
  await act(async()=>{resolve(cropped)})
  expect(done).toHaveBeenCalledExactlyOnceWith(cropped)
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('已另存为新素材（原图保留）')
  expect(pic.file).toBe('a.png')
})
it('keeps failure retryable and forwards only completion for a successful retry',async()=>{
  mounted();ready()
  h.crop.mockRejectedValueOnce(Error('合成裁剪失败')).mockResolvedValueOnce(cropped)
  await click('裁剪并另存')
  expect(h.notify).toHaveBeenCalledExactlyOnceWith('合成裁剪失败','error')
  expect(done).not.toHaveBeenCalled()
  expect(query('裁剪并另存').disabled).toBe(false)
  await click('裁剪并另存')
  expect(done).toHaveBeenCalledExactlyOnceWith(cropped)
  expect(h.crop.mock.calls).toEqual([[pic.id,pixel],[pic.id,pixel]])
})
it('dismisses from either visible close action without starting a service operation',async()=>{
  mounted(other);ready()
  await click('取消')
  await click('关闭')
  expect(close).toHaveBeenCalledTimes(2)
  expect(h.crop).not.toHaveBeenCalled()
  expect(done).not.toHaveBeenCalled()
})

it('does not reuse a previous asset crop rectangle when a different image replaces it',()=>{
  mounted(pic);ready()
  expect(query('裁剪并另存').disabled).toBe(false)
  mounted(other)
  expect(h.adapter?.image).toBe('/media/b.png')
  expect(query('裁剪并另存').disabled).toBe(true)
  expect(h.crop).not.toHaveBeenCalled()
})
it('does not close a new crop dialog when an already submitted previous crop completes',async()=>{
  function Host(){
    const [viewing,setViewing]=useState<Asset|null>(pic)
    return createElement('div',null,
      createElement('button',{onClick:()=>setViewing(other)},'裁剪乙'),
      viewing&&createElement(CropModal,{asset:viewing,onClose:()=>setViewing(null),onDone:(a:Asset)=>{done(a);setViewing(null)}}))
  }
  act(()=>root.render(createElement(Host)))
  ready()
  let resolve!:(asset:Asset)=>void
  h.crop.mockReturnValueOnce(new Promise<Asset>(value=>{resolve=value}))
  const refresh=vi.fn()
  window.addEventListener('assets-changed',refresh)
  try{
    await click('裁剪并另存');await click('取消');await click('裁剪乙')
    expect(host.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('裁剪：原图乙')
    await act(async()=>{resolve(cropped)})
    expect(host.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('裁剪：原图乙')
    expect(done).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledOnce()
  }finally{window.removeEventListener('assets-changed',refresh)}
})
it('does not notify a rejected crop receipt after the dialog is dismissed',async()=>{
  mounted();ready()
  let reject!:(error:Error)=>void
  h.crop.mockReturnValueOnce(new Promise<Asset>((_,fail)=>{reject=fail}))
  await click('裁剪并另存');await click('关闭')
  await act(async()=>{reject(Error('失效后才到达的错误'))})
  expect(h.notify).not.toHaveBeenCalled()
  expect(done).not.toHaveBeenCalled()
})
it('allows only one dispatch for synchronous repeated clicks from the same render',async()=>{
  mounted();ready()
  let resolve!:(asset:Asset)=>void
  const pending=new Promise<Asset>(value=>{resolve=value})
  h.crop.mockReturnValue(pending)
  const save=query('裁剪并另存')
  act(()=>{save.click();save.click()})
  expect(h.crop).toHaveBeenCalledExactlyOnceWith(pic.id,pixel)
  await act(async()=>{resolve(cropped)})
  expect(done).toHaveBeenCalledExactlyOnceWith(cropped)
})
it('does not finish a fresh crop for the same asset after switching away and back',async()=>{
  mounted(pic);ready()
  let resolve!:(asset:Asset)=>void
  h.crop.mockReturnValueOnce(new Promise<Asset>(value=>{resolve=value}))
  const refresh=vi.fn()
  window.addEventListener('assets-changed',refresh)
  try{
    await click('裁剪并另存')
    mounted(other);mounted(pic)
    expect(query('裁剪并另存')?.disabled).toBe(true)
    await act(async()=>{resolve(cropped)})
    expect(query('裁剪并另存').disabled).toBe(true)
    expect(done).not.toHaveBeenCalled()
    expect(h.notify).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledOnce()
  }finally{window.removeEventListener('assets-changed',refresh)}
})
it('refreshes the library for a receipt after actual unmount but runs no local completion',async()=>{
  mounted();ready()
  let resolve!:(asset:Asset)=>void
  h.crop.mockReturnValueOnce(new Promise<Asset>(value=>{resolve=value}))
  const refresh=vi.fn()
  window.addEventListener('assets-changed',refresh)
  try{
    await click('裁剪并另存')
    act(()=>root.render(null))
    await act(async()=>{resolve(cropped)})
    expect(refresh).toHaveBeenCalledOnce()
    expect(done).not.toHaveBeenCalled()
    expect(h.notify).not.toHaveBeenCalled()
  }finally{window.removeEventListener('assets-changed',refresh)}
})

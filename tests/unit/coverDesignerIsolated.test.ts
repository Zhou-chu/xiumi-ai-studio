// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Doc } from '../../src/core/types'
import { CoverDesigner } from '../../src/editor/CoverDesigner'
const h=vi.hoisted(()=>({doc:{} as Doc,assets:vi.fn(),upload:vi.fn(),setDocFields:vi.fn(),notify:vi.fn(),close:vi.fn()}))
vi.mock('../../src/editor/store',()=>({useStore:Object.assign((pick:(s:{doc:Doc})=>unknown)=>pick({doc:h.doc}),{getState:()=>h})}))
vi.mock('../../src/editor/api',async(original)=>{const {assetRef}=await original<typeof import('../../src/editor/api')>();return{assetRef,api:{assets:h.assets,uploadAssets:h.upload}}})
vi.mock('../../src/editor/Modal',()=>({Modal:({children}:{children:ReactNode})=>createElement('section',null,children)}))
const asset={id:'photo',file:'photo.jpg',name:'照片',width:900,height:383,size:3,mime:'image/jpeg',createdAt:1}
let root:Root,host:HTMLDivElement,ctx:Record<string,unknown>,images:FakeImage[],blobCallback:((b:Blob|null)=>void)|undefined
class FakeImage {onload:(()=>void)|null=null;onerror:(()=>void)|null=null;src='';width=1200;height=800;constructor(){images.push(this)}}
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent===text)!
const click=async(text:string)=>{await act(async()=>button(text).click())}
const input=(placeholder:string,value:string)=>act(()=>{const el=host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})
const mount=async()=>{await act(async()=>root.render(createElement(CoverDesigner,{onClose:h.close})))}
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('Image',FakeImage);vi.stubGlobal('fetch',()=>{throw Error('Unexpected cover transport')})
 for(const spy of [h.assets,h.upload,h.setDocFields,h.notify,h.close])spy.mockReset()
 h.assets.mockResolvedValue([asset]);h.upload.mockImplementation(()=>{throw Error('Unexpected upload')})
 h.doc={id:'doc',title:'合成封面',author:'',digest:'',blocks:[],themeId:'minimal-magazine',createdAt:1,updatedAt:1}
 images=[];blobCallback=undefined
 ctx={fillStyle:'',font:'',fillRect:vi.fn(),drawImage:vi.fn(),fillText:vi.fn(),measureText:vi.fn((text:string)=>({width:[...text].length*100})),createLinearGradient:vi.fn(()=>({addColorStop:vi.fn()}))}
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>ctx as never)
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>{blobCallback=cb})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('draws fixed-size cover layouts and wraps Unicode title into bounded readable lines',async()=>{
 await mount();expect(host.querySelector('canvas')?.getAttribute('width')).toBe('900');expect(host.querySelector('canvas')?.getAttribute('height')).toBe('383')
 expect(ctx.fillRect).toHaveBeenCalledWith(0,0,900,383)
 input('小标签','编辑式');input('标题','甲乙丙丁戊己庚辛壬癸😀末')
 ;(ctx.fillText as ReturnType<typeof vi.fn>).mockClear()
 await click('白底标题框')
 expect(ctx.fillRect).toHaveBeenCalledWith(48,64,expect.closeTo(504,8),255)
 expect(ctx.fillText).toHaveBeenCalledWith('编辑式',80,112)
 expect(ctx.fillText).toHaveBeenCalledWith('甲乙丙丁',80,164)
 ;(ctx.fillText as ReturnType<typeof vi.fn>).mockClear()
 await click('底部色带')
 expect(ctx.fillRect).toHaveBeenCalledWith(0,253,900,130)
 expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map(c=>c[0])).toEqual(['甲乙丙丁戊己庚','辛壬癸😀末'])
})
it('loads normalized media, centers its crop and permits direct original assignment',async()=>{
 await mount();await act(async()=>host.querySelector('img')!.click())
 expect(images.at(-1)?.src).toBe('/media/photo.jpg?w=1200')
 await act(async()=>images.at(-1)!.onload!())
 expect(ctx.drawImage).toHaveBeenCalledWith(images.at(-1),0,-108.5,900,600)
 await click('直接用原图')
 expect(h.setDocFields).toHaveBeenCalledExactlyOnceWith({cover:{src:'/media/photo.jpg',assetId:'photo',alt:'照片',width:900,height:383}})
 expect(h.upload).not.toHaveBeenCalled();expect(h.close).toHaveBeenCalledOnce()
})
it('never draws a superseded successfully loaded image over a newer pure background',async()=>{
 await mount();await act(async()=>host.querySelector('img')!.click());const old=images.at(-1)!
 await click('纯色');(ctx.fillText as ReturnType<typeof vi.fn>).mockClear()
 await act(async()=>old.onload!())
 expect(ctx.drawImage).not.toHaveBeenCalled();expect(ctx.fillText).not.toHaveBeenCalled()
})
it('encodes JPEG then uploads before assigning cover and dispatching one refresh',async()=>{
 await mount();h.upload.mockResolvedValue([asset]);const refresh=vi.fn();window.addEventListener('assets-changed',refresh)
 try{
 await click('生成并设为封面');expect(button('生成中…').disabled).toBe(true);expect(h.upload).not.toHaveBeenCalled()
 await act(async()=>blobCallback!(new Blob(['jpeg'],{type:'image/jpeg'})))
 const file=h.upload.mock.calls[0][0][0] as File
 expect(file.type).toBe('image/jpeg');expect(file.name).toMatch(/^cover-\d+\.jpg$/);expect(file.size).toBe(4)
 expect(h.setDocFields).toHaveBeenCalledOnce();expect(refresh).toHaveBeenCalledOnce();expect(h.notify).toHaveBeenCalledExactlyOnceWith('封面已生成并设置');expect(h.close).toHaveBeenCalledOnce()
 }finally{window.removeEventListener('assets-changed',refresh)}
})
it('retains the editor on upload failure and leaves cancellation without document writes',async()=>{
 await mount();h.upload.mockRejectedValue(Error('上传失败'));await click('生成并设为封面')
 await act(async()=>blobCallback!(new Blob(['x'])))
 expect(h.notify).toHaveBeenCalledExactlyOnceWith('上传失败','error');expect(h.setDocFields).not.toHaveBeenCalled();expect(button('生成并设为封面').disabled).toBe(false)
 await click('取消');expect(h.close).toHaveBeenCalledOnce();expect(h.setDocFields).not.toHaveBeenCalled()
})
it('does not upload or change the cover when canvas encoding returns null',async()=>{
 await mount();h.upload.mockResolvedValue([asset]);await click('生成并设为封面')
 await act(async()=>blobCallback!(null))
 expect(h.upload).not.toHaveBeenCalled();expect(h.setDocFields).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled()
 expect(h.notify.mock.calls[0]?.[1]).toBe('error');expect(button('生成并设为封面').disabled).toBe(false)
})
it('does not paint an obsolete title/layout when its old background image rejects',async()=>{
 await mount();await act(async()=>host.querySelector('img')!.click());const old=images.at(-1)!
 await click('纯色');input('标题','当前新标题');(ctx.fillText as ReturnType<typeof vi.fn>).mockClear()
 await act(async()=>old.onerror!())
 expect(ctx.fillText).not.toHaveBeenCalled()
})
it('keeps a current failed image on a solid readable background and retries encoding after a null result',async()=>{
 await mount();await act(async()=>host.querySelector('img')!.click());(ctx.fillText as ReturnType<typeof vi.fn>).mockClear()
 await act(async()=>images.at(-1)!.onerror!())
 expect(ctx.fillText).toHaveBeenCalledWith('合成封面',56,110)
 await click('生成并设为封面');await act(async()=>blobCallback!(null))
 h.upload.mockResolvedValue([asset]);await click('生成并设为封面');await act(async()=>blobCallback!(new Blob(['valid'])))
 expect(h.upload).toHaveBeenCalledOnce();expect(h.setDocFields).toHaveBeenCalledOnce();expect(h.close).toHaveBeenCalledOnce()
})
it('does not assign a late uploaded cover to a different current document',async()=>{
 await mount();let finish!:(a:typeof asset[])=>void;h.upload.mockReturnValue(new Promise(resolve=>{finish=resolve}))
 await click('生成并设为封面');await act(async()=>blobCallback!(new Blob(['jpeg'])))
 h.doc={...h.doc,id:'another'}
 await act(async()=>finish([asset]))
 expect(h.setDocFields).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled()
})
it('does not start upload from an encoding receipt after the cover editor unmounts',async()=>{
 await mount();h.upload.mockResolvedValue([asset]);await click('生成并设为封面');act(()=>root.render(null))
 await act(async()=>blobCallback!(new Blob(['jpeg'])))
 expect(h.upload).not.toHaveBeenCalled();expect(h.setDocFields).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled()
})
it('refreshes persisted assets after dismissal without assigning or closing a later dialog',async()=>{
 await mount();let finish!:(a:typeof asset[])=>void;h.upload.mockReturnValue(new Promise(resolve=>{finish=resolve}))
 const refresh=vi.fn();window.addEventListener('assets-changed',refresh)
 try{
 await click('生成并设为封面');await act(async()=>blobCallback!(new Blob(['jpeg'])));await click('取消')
 h.close.mockClear();h.notify.mockClear();await act(async()=>finish([asset]))
 expect(refresh).toHaveBeenCalledOnce();expect(h.setDocFields).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled();expect(h.notify).not.toHaveBeenCalled()
 }finally{window.removeEventListener('assets-changed',refresh)}
})
it('does not overwrite intervening edits in the same document or report a stale upload error',async()=>{
 await mount();let reject!:(error:Error)=>void;h.upload.mockReturnValue(new Promise((_,fail)=>{reject=fail}))
 await click('生成并设为封面');await act(async()=>blobCallback!(new Blob(['jpeg'])))
 h.doc={...h.doc,title:'手动修改'};await act(async()=>reject(Error('旧请求错误')))
 expect(h.notify).not.toHaveBeenCalled();expect(h.setDocFields).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled()
 expect(button('生成并设为封面').disabled).toBe(false)
})
it('does not upload a superseded preview if the editor changes it during encoding',async()=>{
 await mount();h.upload.mockResolvedValue([asset]);await click('生成并设为封面')
 await click('底部色带')
 await act(async()=>blobCallback!(new Blob(['obsolete jpeg'])))
 expect(h.upload).not.toHaveBeenCalled();expect(h.setDocFields).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled()
 expect(button('生成并设为封面').disabled).toBe(false)
})
it('fits a complete long title down to the existing readability floor and blocks an overflowing title',async()=>{
 const measure=ctx.measureText as ReturnType<typeof vi.fn>
 measure.mockImplementation((text:string)=>({width:[...text].length*Number(String(ctx.font).match(/(\d+)px/)?.[1]??44)}))
 const fits='完整长标题'.repeat(8)
 h.doc={...h.doc,title:fits}
 await mount()
 expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map(([line])=>line).join('')).toContain(fits)
 expect(Number(String(ctx.font).match(/(\d+)px/)?.[1])).toBeGreaterThanOrEqual(24)
 expect(button('生成并设为封面').disabled).toBe(false)
 input('标题','无法完整排版的标题'.repeat(20))
 expect(Number(String(ctx.font).match(/(\d+)px/)?.[1])).toBe(24)
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('不会导出截断的标题')
 expect(button('生成并设为封面').disabled).toBe(true)
 await click('生成并设为封面');expect(blobCallback).toBeUndefined();expect(h.upload).not.toHaveBeenCalled()
})
it('blocks generation when the preview canvas is unavailable',async()=>{
 vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
 await mount()
 expect(h.notify).toHaveBeenCalledExactlyOnceWith('封面预览生成失败，请调整标题或版式后重试。','error')
 expect(button('生成并设为封面').disabled).toBe(true)
})

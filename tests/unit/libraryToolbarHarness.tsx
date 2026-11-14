import {act,type ReactNode} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {expect,vi} from 'vitest'
import {api} from '../../src/editor/api'
import {emptyDoc,useStore} from '../../src/editor/store'
import {createBlock} from '../../src/core/blocks'
export const state=()=>useStore.getState()
export const asset={id:'asset',file:'asset.png',name:'Photo',width:20,height:10,size:20,createdAt:1}
export const template={id:'tpl',name:'Template',blocks:[createBlock('heading')],createdAt:1,themeId:'minimal-magazine'}
export let host:HTMLDivElement,root:Root
export function setup(){vi.useFakeTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
 state().load({...emptyDoc(),title:'Document',blocks:[createBlock('heading')]});state().setMatchColors(false)
 vi.spyOn(api,'assets').mockResolvedValue([asset]);vi.spyOn(api,'templates').mockResolvedValue([template]);vi.spyOn(api,'components').mockResolvedValue([]);vi.spyOn(api,'projects').mockResolvedValue([])
 vi.spyOn(api,'saveProject').mockResolvedValue({updatedAt:1,revision:'r'});vi.spyOn(window,'confirm').mockReturnValue(true);vi.spyOn(window,'prompt').mockReturnValue('Name')
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
}
export function cleanup(){act(()=>root.unmount());host.remove();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()}
export const mount=(node:ReactNode)=>act(async()=>{root.render(node)})
export const click=async(el:Element|null|undefined)=>{expect(el).toBeTruthy();await act(async()=>{(el as HTMLElement).click()})}
export const byTest=(id:string)=>host.querySelector(`[data-testid="${id}"]`)
export const button=(text:string)=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);if(!b)throw new Error(`Missing ${text}: ${[...host.querySelectorAll('button')].map(x=>x.textContent).join('|')}`);return b}
export const input=async(el:Element|null,value:string)=>{expect(el).toBeTruthy();await act(async()=>{const n=el as HTMLInputElement;const proto=n.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(n,value);n.dispatchEvent(new Event(n.tagName==='SELECT'?'change':'input',{bubbles:true}))})}
export const dispatch=(name:string)=>act(async()=>{window.dispatchEvent(new Event(name))})

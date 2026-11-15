// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { PhotoPlanner, type PhotoGroup } from '../../src/editor/PhotoPlanner'
import type { Asset } from '../../src/editor/api'
import type { RoleId } from '../../src/core/roles'
const assets:Asset[]=['a','b','c'].map(id=>({id,file:id+'.png',name:'照片'+id,width:100,height:100,size:12,createdAt:1}))
let host:HTMLDivElement,root:Root
let current:{images:Asset[];notes:Record<string,string>;anchors:Record<string,string>;groups:PhotoGroup[]}
const transport=vi.fn(()=>{throw Error('Unexpected photo transport')})
function mount(initial:{images?:Asset[];groups?:PhotoGroup[];anchors?:Record<string,string>;layouts?:RoleId[]}={}) {
 function Fixture(){
  const [images,setImages]=useState(initial.images??assets)
  const [groups,setGroups]=useState(initial.groups??[])
  const [anchors,setAnchors]=useState(initial.anchors??{})
  const [notes,setNotes]=useState<Record<string,string>>({})
  current={images,groups,anchors,notes}
  return createElement(PhotoPlanner,{images,setImages,groups,setGroups,anchors,setAnchors,notes,setNotes,layouts:initial.layouts??[],text:'# 开幕\n\n欢迎大家参加活动。\n\n# 交流\n\n分享学习成果。'})
 }
 act(()=>root.render(createElement(Fixture)))
}
const el=<T extends HTMLElement=HTMLElement>(id:string)=>host.querySelector<T>(`[data-testid="${id}"]`)!
const click=(node:HTMLElement)=>act(()=>node.click())
function change(node:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string){
 const proto=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype
 act(()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}))})
}
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);transport.mockClear();vi.stubGlobal('fetch',transport)
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();expect(transport).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('shows an honest empty state without a group or upload side effect',()=>{
 mount({images:[]});expect(host.textContent).toContain('照片（0）');expect(host.textContent).toContain('还没有照片');expect(host.querySelectorAll('img')).toHaveLength(0)
})
it('edits independent captions and validates anchors against actual copy text',()=>{
 mount();change(el<HTMLTextAreaElement>('photo-note-2'),'交流合影');expect(current.notes).toEqual({b:'交流合影'})
 change(el<HTMLInputElement>('photo-anchor-1'),'欢迎大家参加活动。');expect(current.anchors).toEqual({a:'欢迎大家参加活动。'})
 expect(host.querySelector('.anchor .ok')?.textContent).toContain('导语')
 change(el<HTMLInputElement>('photo-anchor-1'),'正文中不存在的句子');expect(host.querySelector('.anchor .bad')?.textContent).toContain('找不到')
 change(el<HTMLInputElement>('photo-anchor-1'),' ');expect(host.querySelector('.anchor small')).toBeNull()
 expect(host.querySelector('img')?.getAttribute('src')).toBe('/media/a.png?fit=1:1&w=160')
})
it('groups photos in document order rather than click order and clears only member anchors',()=>{
 vi.spyOn(Date,'now').mockReturnValue(1000)
 mount({anchors:{a:'old a',b:'old b',c:'keep c'}})
 click(el('photo-pick-2'));expect(el('make-group')).toBeNull();click(el('photo-pick-1'));click(el('make-group'))
 expect(current.groups).toEqual([{id:'grs',photos:['a','b'],layout:''}]);expect(current.anchors).toEqual({c:'keep c'})
 expect(el<HTMLInputElement>('photo-pick-1').disabled).toBe(true);expect(el<HTMLInputElement>('photo-pick-2').disabled).toBe(true)
 expect(el('make-group')).toBeNull();expect(el('photo-group').textContent).toContain('照片 1、2')
})
it('deselecting a photo removes the grouping action without changing assets',()=>{
 mount();click(el('photo-pick-1'));click(el('photo-pick-3'));expect(el('make-group')).not.toBeNull();click(el('photo-pick-1'))
 expect(el('make-group')).toBeNull();expect(current.images).toEqual(assets);expect(current.groups).toEqual([])
})
it('shows only compatible configured layouts and stores an explicit group choice',()=>{
 mount({groups:[{id:'g',photos:['a','b'],layout:''}],layouts:['img1','img2lr','img3row']})
 const select=el<HTMLSelectElement>('group-layout');expect([...select.options].map(o=>o.value)).toEqual(['','img2lr'])
 change(select,'img2lr');expect(current.groups[0].layout).toBe('img2lr');expect(select.value).toBe('img2lr')
})
it('states when configured templates lack a compatible layout rather than inventing one',()=>{
 mount({groups:[{id:'g',photos:['a','b'],layout:''}],layouts:['img1']})
 expect(el('photo-group').textContent).toContain('所选模块里没有 2 图版式');expect(el<HTMLSelectElement>('group-layout').options).toHaveLength(1)
})
it('keeps group anchors synchronized from either member and allows explicit ungrouping',()=>{
 mount({groups:[{id:'g',photos:['a','b'],layout:''}]})
 change(el<HTMLInputElement>('photo-anchor-2'),'分享学习成果。')
 expect(current.anchors).toEqual({g:'分享学习成果。'});expect(el<HTMLInputElement>('group-anchor').value).toBe('分享学习成果。')
 expect(el<HTMLInputElement>('photo-anchor-1').value).toBe('分享学习成果。')
 change(el<HTMLInputElement>('group-anchor'),'欢迎大家参加活动。');expect(el<HTMLInputElement>('photo-anchor-2').value).toBe('欢迎大家参加活动。')
 click(el('ungroup'));expect(current.groups).toEqual([]);expect(el<HTMLInputElement>('photo-pick-1').disabled).toBe(false)
 expect(el<HTMLInputElement>('photo-anchor-1').value).toBe('')
})
it('removes a member, dissolves a one-photo group and retains unrelated photos',()=>{
 mount({groups:[{id:'g',photos:['a','b'],layout:''}]})
 click(host.querySelectorAll<HTMLButtonElement>('button[title="不使用这张照片"]')[0])
 expect(current.images.map(x=>x.id)).toEqual(['b','c']);expect(current.groups).toEqual([])
 expect(host.querySelectorAll('img')).toHaveLength(2);expect(el<HTMLInputElement>('photo-pick-1').disabled).toBe(false)
})
it('removes a selected photo from the local pending selection without grouping stale ids',()=>{
 mount();click(el('photo-pick-1'));click(el('photo-pick-2'))
 click(host.querySelectorAll<HTMLButtonElement>('button[title="不使用这张照片"]')[0])
 expect(el('make-group')).toBeNull();click(el('photo-pick-2'));click(el('make-group'))
 expect(current.groups[0].photos).toEqual(['b','c'])
})
it('keeps a group with two remaining members and its explicit layout when one of three is removed',()=>{
 mount({groups:[{id:'g',photos:['a','b','c'],layout:'carousel'}],anchors:{g:'分享学习成果。'},layouts:['carousel']})
 click(host.querySelectorAll<HTMLButtonElement>('button[title="不使用这张照片"]')[1])
 expect(current.images.map(x=>x.id)).toEqual(['a','c'])
 expect(current.groups).toEqual([{id:'g',photos:['a','c'],layout:'carousel'}])
 expect(current.anchors).toEqual({g:'分享学习成果。'})
 expect(el('photo-group').textContent).toContain('照片 1、2')
 expect(el<HTMLInputElement>('photo-pick-1').disabled).toBe(true)
})

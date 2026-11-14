import { describe, expect, it } from 'vitest'
import { aiPlaceRequest, checkPlan, fixedPlacements, normalizeAiPlacements, planReady, rulePlacements, type PlanInput, type PhotoUnit } from '../../src/core/photoPlan'
import { createBlock } from '../../src/core/blocks'
const copy={title:'Title',subtitle:'',credits:[],items:[{id:'h',kind:'heading' as const,level:1,text:'Heading'},{id:'p',kind:'para' as const,text:'Anchor paragraph'},{id:'q',kind:'para' as const,text:'Other paragraph'}]}
const kit={h1:{role:'h1' as const,block:createBlock('heading'),from:'test'},img2lr:{role:'img2lr' as const,block:createBlock('photos',{count:2}),from:'test'},img1:{role:'img1' as const,block:createBlock('image'),from:'test'}}
const u=(key:string,photos:number[],extra:Partial<PhotoUnit>={}):PhotoUnit=>({key,photos,grouped:false,...extra})
const input=(units:PhotoUnit[]):PlanInput=>({copy,kit,units,crowd:{},singlesFor:new Set()})
describe('photo plan decision boundaries',()=>{
 it('reports each independent readiness blocker and accepts available explicit layouts',()=>{
  const clean={levels:null,unmatched:[],crowded:[],noLayout:[]};expect(planReady(clean)).toBe(true)
  for(const key of ['unmatched','crowded','noLayout'])expect(planReady({...clean,[key]:[{}]} as any)).toBe(false)
  expect(planReady({...clean,levels:{copy:2,kit:1}})).toBe(false)
  const a=checkPlan(copy,kit,[u('a',[0],{anchor:'missing'}),u('b',[1,2],{grouped:true,layout:'img2lr'}),u('c',[3],{anchor:'Anchor paragraph'})]);expect(a.unmatched).toHaveLength(1);expect(a.noLayout).toEqual([]);expect(a.crowded).toEqual([])
 })
 it('resolves crowd choices and free/fixed grouped singles without duplicating units',()=>{
  const units=[u('a',[0],{anchor:'Anchor paragraph'}),u('b',[1],{anchor:'Anchor paragraph'}),u('c',[2,3],{grouped:true}),u('d',[4,5],{grouped:true,anchor:'Other paragraph',layout:'img2lr'})]
  for(const decision of [undefined,{mode:'singles' as const},{mode:'group' as const,layout:'img2lr' as const},{mode:'ai' as const,request:'Separate'}]){
   const i=input(units);i.singlesFor.add('c');if(decision)i.crowd.p=decision
   const result=fixedPlacements(i);expect(result.free[0]).toMatchObject({grouped:false,layout:undefined});expect(result.fixed.find(p=>p.after==='q')).toMatchObject({photos:[4,5],layout:'img2lr'})
   if(decision?.mode==='ai')expect(result.askAi).toEqual([{after:'p',photos:[0,1],request:'Separate'}]);else expect(result.fixed.find(p=>p.after==='p')?.photos).toEqual([0,1])
  }
 })
 it('carries explicit free layouts and plain, automatic and grouped AI notes',()=>{
  const free=[u('a',[0,1],{grouped:true,layout:'img2lr'}),u('b',[2,3],{grouped:true}),u('c',[4])]
  expect(rulePlacements(copy,free,[])[0].layout).toBe('img2lr')
  const req=aiPlaceRequest(input(free),free,[{after:'p',photos:[5,6],request:'Please place'}],['note'])
  expect(req.units[0].note).toContain('note');expect(req.units[1].layout).toBeTruthy();expect(req.units[2].layout).toBe('');expect(req.units[3].fixedAfter).toBe('p');expect(req.layouts['2']).toContain('双图左右')
 })
 it('rejects malformed assignments and restores omitted fixed photos',()=>{
  const free=[u('a',[0,1],{grouped:true,layout:'img2lr'}),u('b',[2])];const i=input(free);const ask=[{after:'p',photos:[3,4],request:'Keep here'}];const req=aiPlaceRequest(i,free,ask,[])
  for(const raw of [null,{}, {placements:[null,{photos:'bad'},{photos:[99,'bad',1.5]},{photos:[1],after:'p'},{photos:[1,2,3],after:'p'},{photos:[3],after:'missing'}]}]){
   const out=normalizeAiPlacements(raw,i,req,free,ask,[]);expect(out.flatMap(p=>p.photos).sort()).toEqual([0,1,2,3,4]);expect(out[0]).toMatchObject({after:'p',photos:[3,4],layout:'singles'})
  }
 })
 it('honors fixed positions, validates layout names, skips used photos and permits singles override',()=>{
  const free=[u('a',[0]),u('b',[1]),u('c',[2])];const i=input(free);const ask=[{after:'p',photos:[3,4],request:'Keep'}];const req=aiPlaceRequest(i,free,ask,[])
  const out=normalizeAiPlacements({placements:[{after:'q',photos:[4,5],layout:'逐张单图'},{after:'p',photos:[1,2],layout:'四图对称并列'},{after:'q',photos:[1,3],layout:'单图'}]},i,req,free,ask,[])
  expect(out[0]).toMatchObject({after:'p',photos:[3,4],layout:'singles'});expect(out[1]).toMatchObject({photos:[0,1],layout:undefined});expect(out[2]).toMatchObject({photos:[2],layout:'singles'})
  const grouped=[u('g',[0,1],{grouped:true,layout:'img2lr'})];const gi=input(grouped);const gr=aiPlaceRequest(gi,grouped,[],[]);expect(normalizeAiPlacements({placements:[{after:'p',photos:[1,2]}]},gi,gr,grouped,[],[])[0].layout).toBe('img2lr')
 })
})

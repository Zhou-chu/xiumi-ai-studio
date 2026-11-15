import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Copy } from '../../src/core/copy'
import type { Kit } from '../../src/core/assemble'
import { aiPlaceRequest, checkPlan, fixedPlacements, normalizeAiPlacements, planReady, rulePlacements, type PlanInput, type PhotoUnit } from '../../src/core/photoPlan'
const copy: Copy = { title: '文稿', subtitle: '', credits: [], items: [
  { id: 'h', kind: 'heading', level: 1, text: '章节' },
  { id: 'p', kind: 'para', text: '大家一起合影。' },
  { id: 'q', kind: 'quote', text: '**引用**', source: '作者' },
] }
const kit: Kit = {
  h1: { role: 'h1', block: createBlock('heading'), from: 'fixture' },
  img2lr: { role: 'img2lr', block: createBlock('photos', { count: 2 }), from: 'fixture' },
}
const unit = (key: string, photos: number[], more: Partial<PhotoUnit> = {}): PhotoUnit => ({ key, photos, grouped: false, ...more })
const input = (units: PhotoUnit[]): PlanInput => ({ copy, kit, units, crowd: {}, singlesFor: new Set() })
it('reports heading capacity, missing anchors, crowded originals and unsupported groups independently', () => {
  const units = [unit('a',[0],{anchor:'大家一起合影。'}),unit('b',[1],{anchor:'大家一起合影。'}),unit('c',[2],{anchor:'没有这句'}),unit('g',[3,4,5,6],{grouped:true})]
  const before = structuredClone(units)
  const report = checkPlan(copy, kit, units)
  expect(report.levels).toBeNull()
  expect(report.unmatched).toEqual([units[2]])
  expect(report.crowded).toEqual([{after:'p',anchor:'大家一起合影。',section:'章节',photos:[0,1],layouts:['img2lr']}])
  expect(report.noLayout).toEqual([units[3]])
  expect(planReady(report)).toBe(false)
  expect(checkPlan(copy,{},[]).levels).toEqual({copy:1,kit:0})
  expect(planReady(checkPlan(copy,kit,[]))).toBe(true)
  expect(units).toEqual(before)
})
it('keeps free groups intact except explicitly opted-in singles and resolves fixed grouped positions', () => {
  const data=input([unit('free',[0,1],{grouped:true,layout:'img2lr'}),unit('split',[2,3],{grouped:true,layout:'img2lr'}),unit('fixed',[4,5],{grouped:true,anchor:'大家一起合影。',layout:'img2lr'})])
  data.singlesFor.add('split')
  expect(fixedPlacements(data)).toEqual({fixed:[{after:'p',photos:[4,5],layout:'img2lr'}],free:[data.units[0],{...data.units[1],grouped:false,layout:undefined}],askAi:[]})
  expect(data.units[1].grouped).toBe(true)
})
it.each(['singles','group','ai'] as const)('applies one %s decision to every photo sharing an anchor without duplicate output', mode => {
  const data=input([unit('a',[0],{anchor:'大家一起合影。'}),unit('b',[2],{anchor:'大家一起合影。'})])
  data.crowd.p=mode==='group'?{mode,layout:'img2lr'}:mode==='ai'?{mode,request:'前后对照'}:{mode}
  const result=fixedPlacements(data)
  expect(result.free).toEqual([])
  expect(result.fixed).toEqual(mode==='ai'?[]:[{after:'p',photos:[0,2],layout:mode==='group'?'img2lr':'singles'}])
  expect(result.askAi).toEqual(mode==='ai'?[{after:'p',photos:[0,2],request:'前后对照'}]:[])
})
it('makes one-based AI requests with named layouts and text-only bounded context', () => {
  const data=input([]), free=[unit('g',[0,2],{grouped:true,layout:'img2lr'})]
  const req=aiPlaceRequest(data,free,[{after:'p',photos:[1,3],request:'分开'}],['第一张','','第三张'])
  expect(req.items).toEqual([{id:'p',section:'章节',text:'大家一起合影。'},{id:'q',section:'章节',text:'引用'}])
  expect(req.units).toEqual([{id:'U1',photos:[1,3],note:'照片1：第一张；照片3：第三张',layout:'双图左右'},{id:'R1',photos:[2,4],note:'照片2；照片4',layout:'',fixedAfter:'p',request:'分开'}])
  expect(req.layouts['2']).toEqual(['双图左右'])
})
it('rejects malformed or split AI groups then restores every grouped photo together through rule fallback', () => {
  const data=input([]), free=[unit('g',[0,1],{grouped:true,layout:'img2lr'})]
  const req=aiPlaceRequest(data,free,[],[])
  for(const raw of [null,{}, {placements:[{after:'missing',photos:[1,2]}]}, {placements:[{after:'p',photos:[1]}]}, {placements:[{after:'p',photos:[-1,0,1.5,'x']}]}]) {
    const out=normalizeAiPlacements(raw,data,req,free,[],[])
    expect(out).toEqual(rulePlacements(copy,free,[]))
    expect(out.flatMap(p=>p.photos)).toEqual([0,1])
  }
})
it('honors fixed anchors, filters duplicate reuse across placements and restores omitted requested photos', () => {
  const data=input([]), ask=[{after:'p',photos:[0,1,2],request:'安排'}]
  const req=aiPlaceRequest(data,[],ask,[])
  const out=normalizeAiPlacements({placements:[{after:'wrong',photos:[1,2],layout:'双图左右'},{after:'q',photos:[1],layout:'单图'}]},data,req,[],ask,[])
  expect(out).toEqual([{after:'p',photos:[0,1],layout:'img2lr'},{after:'p',photos:[2],layout:'singles'}])
})
it('does not duplicate a photo repeated inside the same model placement', () => {
  const data=input([]), ask=[{after:'p',photos:[0,1],request:'安排'}]
  const req=aiPlaceRequest(data,[],ask,[])
  const out=normalizeAiPlacements({placements:[{after:'p',photos:[1,1]}]},data,req,[],ask,[])
  expect(out.flatMap(p=>p.photos)).toEqual([0,1])
})
it('deduplicates after numeric normalization while preserving original photo order and intact group constraints', () => {
  const data=input([]), free=[unit('g',[0,1],{grouped:true,layout:'img2lr'})]
  const req=aiPlaceRequest(data,free,[],[])
  const out=normalizeAiPlacements({placements:[{after:'p',photos:['2',2,1,'1',-1],layout:'双图左右'},{after:'q',photos:[1,2]}]},data,req,free,[],[])
  expect(out).toEqual([{after:'p',photos:[1,0],layout:'img2lr'}])
  const split=normalizeAiPlacements({placements:[{after:'p',photos:[1,'1']}]},data,req,free,[],[])
  expect(split).toEqual(rulePlacements(copy,free,[]))
})

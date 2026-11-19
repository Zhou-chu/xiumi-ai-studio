// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { anchorOf, planCursors, renderCursors, type CursorPlan } from '../../src/core/replay/cursors'
import type { RenderCtx } from '../../src/core/replay/draw'
import type { TimedItem, Timeline } from '../../src/core/replay/schedule'
import { defaultReplay } from '../../src/core/replay/schema'
import type { ReplayDoc, ReplayScene } from '../../src/core/replay/types'

const make=(index:number,action:TimedItem['action'],tStart:number,x:number,patch:Partial<TimedItem['item']>={}):TimedItem=>({
 item:{id:'fixture-'+index,type:'text',content:'Only fixture',...patch},index,action,tStart,tEnd:tStart+0.4,preset:'pop',
 box:{x,y:50,w:40,h:35},style:{color:'#224466',fill:'',stroke:'',fontSize:20,fontWeight:400,align:'left',lineHeight:1.5,letterSpacing:0,radius:0},
})
const doc=(count:number,names?:string[]):ReplayDoc=>({...defaultReplay(),textMode:'svg-text',cursors:{count,names,show:true}})
const scene=(finale:ReplayScene['finale']='exit'):ReplayScene=>({id:'synthetic',layout:'flow',finale,items:[]})
const timeline=(items:TimedItem[],end=8):Timeline=>({items,end,height:720,overflow:false})

it('anchors body text at its first baseline but chooses the stat box rather than the label geometry',()=>{
 const t=make(5,'type',2,100)
 t.text={x:85,y:70,w:95,lines:['Body'],font:{size:20,weight:400,letterSpacing:0},color:'#224466',lineHeight:20,align:'left'}
 expect(anchorOf(t)).toEqual({x:87,y:81})
 expect(anchorOf({...t,item:{...t.item,type:'stat'}})).toEqual({x:104,y:54})
})

it('reports waiting cursors without mutating or reordering the timeline when a simultaneous action cannot be assigned',()=>{
 const items=[make(9,'click',2,100),make(2,'click',2,200),make(7,'none',1,500)]
 const input=timeline(items),original=structuredClone(input)
 const plan=planCursors(input,doc(1,['Lead']),scene())
 const [track]=plan.tracks
 expect(track.name).toBe('Lead')
 expect(track.stops.map(x=>x.item)).toEqual([2])
 expect(plan.unassigned).toEqual([9])
 expect(track.ripples).toEqual([{t:2,x:204,y:54}])
 expect(track.exit?.x).toBe(-60)
 expect(input).toEqual(original)
})

it('assigns a requested available cursor, retains the drag endpoint and leaves far motion settled before action',()=>{
 const items=[make(0,'drag',2,550,{cursor:{who:1}}),make(1,'type',5,100,{cursor:{who:1}})]
 const [idle,used]=planCursors(timeline(items),doc(2),scene()).tracks
 expect(idle.spawn).toBeNull()
 expect(used.stops.map(x=>[x.item,x.action,x.act])).toEqual([[0,'drag',2],[1,'type',5]])
 expect(used.pos).toContainEqual(expect.objectContaining({v:'590 85'}))
 const stop=used.stops[1]
 expect(stop.depart).toBeLessThan(stop.arrive);expect(stop.arrive).toBeLessThan(stop.act)
 expect(used.pos).toContainEqual({t:stop.arrive,v:'104 54',ease:'inout'})
 expect(used.pos).toContainEqual(expect.objectContaining({v:'90 80'}))
 expect(used.ripples).toEqual([{t:2,x:554,y:54}])
})

it('swarm gathers only active cursors and cleanup on the simple route exits to the nearer side',()=>{
 const t=timeline([make(0,'click',2,550,{cursor:{who:1}})])
 const swarm=planCursors(t,doc(3),scene('swarm'))
 expect(swarm.swarm).toMatchObject({members:[1],x:375,radius:46})
 expect(swarm.end).toBeGreaterThan(t.end)
 expect(swarm.tracks[0].exit).toBeNull()
 expect(swarm.tracks[1].exit).toMatchObject({x:421})
 expect(planCursors(t,doc(3),scene()).tracks[1].exit?.x).toBe(810)
 expect(planCursors(timeline([make(4,'none',1,500)]),doc(3),scene('swarm'))).toMatchObject({swarm:null,end:8,unassigned:[]})
})

it('serializes an active named cursor and swarm as parseable SVG without exposing idle cursors',()=>{
 const d=doc(2,['角 A','idle hidden'])
 const plan:CursorPlan={
  tracks:[
   {who:0,color:'#123456',name:'角 A',spawn:{t:1,x:20,y:30},stops:[],pos:[{t:1,v:'20 30'},{t:3,v:'421 180'}],
    scale:[{t:1,v:0},{t:2,v:1}],ripples:[{t:2,x:50,y:60}],exit:{t:3,x:421,y:180}},
   {who:1,color:'#fedcba',name:'idle hidden',spawn:null,stops:[],pos:[],scale:[],ripples:[],exit:null},
  ],
  unassigned:[],swarm:{t:3,x:375,y:180,radius:46,members:[0]},end:6,
 }
 const ctx:RenderCtx={doc:d,mode:{kind:'once'},idsAllowed:false,sceneHeight:720,sid:'fixture',img:vi.fn(()=>{throw Error('unexpected image')}),warn:vi.fn()}
 const markup=renderCursors(plan,ctx)
 const svg=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">'+markup+'</svg>','image/svg+xml')
 expect(svg.querySelector('parsererror')).toBeNull()
 expect(svg.querySelectorAll('path')).toHaveLength(2)
 expect(svg.documentElement.textContent).toContain('角 A')
 expect(svg.documentElement.textContent).not.toContain('idle hidden')
 expect(svg.querySelectorAll('circle')).toHaveLength(1)
 expect(svg.querySelectorAll('animateTransform[type=rotate]').length).toBeGreaterThanOrEqual(2)
 expect(markup).not.toMatch(/NaN|Infinity|undefined/)
 expect(ctx.img).not.toHaveBeenCalled()
})

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PRESET_RENDERERS, renderItem, renderItemStatic } from '../../src/core/replay/presets'
import { defaultReplay } from '../../src/core/replay/schema'
import { replayEnv, setReplayEnv } from '../../src/core/replay/text'
import type { RenderCtx } from '../../src/core/replay/draw'
import type { TimedItem } from '../../src/core/replay/schedule'
import type { EnterPreset } from '../../src/core/replay/types'
const svg=(s:string)=>new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">'+s+'</svg>','image/svg+xml')
const context=():RenderCtx=>({doc:{...defaultReplay(),textMode:'svg-text'},mode:{kind:'once'},sceneHeight:400,idsAllowed:false,sid:'s',img:vi.fn((s:string)=>s),warn:vi.fn()})
const item=(preset:EnterPreset):TimedItem=>({
 item:{id:'text',type:'text',content:'值12.50%'},index:2,box:{x:20,y:30,w:100,h:60},
 style:{color:'#123456',fill:'',stroke:'',fontSize:20,fontWeight:400,align:'left',lineHeight:1.5,letterSpacing:0,radius:0},
 text:{x:20,y:30,w:100,lines:['值12.50%'],font:{size:20,weight:400,letterSpacing:0},color:'#123456',lineHeight:30,align:'left'},
 preset,action:'none',tStart:1,tEnd:2,
})
let prior:ReturnType<typeof replayEnv>
beforeEach(()=>{prior=replayEnv();setReplayEnv({measure:t=>[...t].length*8,rasterize:null})})
afterEach(()=>setReplayEnv(prior))
it.each(Object.keys(PRESET_RENDERERS) as EnterPreset[])('%s emits finite monotonic animations with stable input and static content',preset=>{
 const ti=item(preset),c=context(),before=structuredClone(ti)
 const out=renderItem(ti,c),doc=svg(out)
 expect(doc.querySelector('parsererror')).toBeNull()
 expect(out).not.toMatch(/NaN|Infinity|undefined/)
 expect(out).toBe(renderItem(ti,c))
 const animations=[...doc.querySelectorAll('animate,animateTransform')]
 expect(animations.length).toBeGreaterThan(0)
 for(const animation of animations){
  const times=animation.getAttribute('keyTimes')!.split(';').map(Number)
  expect(times[0]).toBe(0);expect(times.at(-1)).toBe(1)
  expect(times).toEqual([...times].sort((a,b)=>a-b))
  expect(animation.getAttribute('begin')).toBe('0s')
  expect(animation.getAttribute('fill')).toBe('freeze')
 }
 const still=svg(renderItemStatic(ti,c))
 expect(still.querySelector('animate,animateTransform')).toBeNull()
 expect(still.documentElement.textContent).toBe('值12.50%')
 expect(ti).toEqual(before)
})
it('count-up retains exact decimal suffix in its terminal value and merges tiny repeated intermediate numbers',()=>{
 const ti=item('count-up'),c=context()
 const values=[...svg(renderItem(ti,c)).querySelectorAll('text')].map(n=>n.textContent)
 expect(values.at(-1)).toBe('值12.50%')
 expect(values.length).toBe(5)
 ti.item.content='0';ti.text!.lines=['0']
 expect([...svg(renderItem(ti,c)).querySelectorAll('text')].map(n=>n.textContent)).toEqual(['0'])
 ti.item.content='无数字'
 expect(renderItem(ti,c)).toBe(renderItem({...ti,preset:'pop'},c))
})
it('falls back from typing without a text run and keeps independent scale layers centered on the box',()=>{
 const ti=item('type-on');delete ti.text
 const c=context()
 expect(renderItem(ti,c)).toBe(renderItem({...ti,preset:'pop'},c))
 const out=svg(renderItem({...ti,preset:'pop'},c))
 expect(out.querySelector('g[transform="translate(70 60)"]')).not.toBeNull()
 expect(out.querySelector('g[transform="translate(-70 -60)"]')).not.toBeNull()
 expect(out.querySelector('animateTransform[type=scale]')?.getAttribute('values')).toBe('0.9;0.9;1.03;1')
})
it('uses shrinking solid covers but line fades over image backgrounds without painting opaque strips',()=>{
 const ti=item('type-on'),c=context()
 const solid=svg(renderItem(ti,c))
 expect(solid.querySelector('rect > animate[attributeName=width]')).not.toBeNull()
 c.doc.canvas.background={type:'image',value:'/media/background.png'}
 const image=svg(renderItem(ti,c))
 expect(image.querySelector('rect > animate[attributeName=width]')).toBeNull()
 expect(image.querySelector('text')?.textContent).toBe('值12.50%')
 expect(image.querySelector('animate[attributeName=opacity]')).not.toBeNull()
})
it('uses explicit tap/loop timing and preserves alert frame geometry and end visibility',()=>{
 const ti=item('alert-box'),c=context();c.mode={kind:'tap',trigger:'start',cycle:4}
 const out=svg(renderItem(ti,c));const frame=out.querySelector('rect[stroke-width="3"]')!
 expect(['x','y','width','height'].map(k=>frame.getAttribute(k))).toEqual(['12','22','116','76'])
 const animation=frame.querySelector('animate')!
 expect(animation.getAttribute('values')?.split(';').at(-1)).toBe('1')
 expect(animation.getAttribute('begin')).toBe('start.click')
 expect(animation.getAttribute('repeatCount')).toBe('indefinite')
 expect(animation.getAttribute('dur')).toBe('4s')
})

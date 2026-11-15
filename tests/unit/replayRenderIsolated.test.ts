// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest'
import {defaultReplay,makeScene,makeItem} from '../../src/core/replay/schema'
import {renderReplay,replayFinalTimes} from '../../src/core/replay/render'
import type {RenderCtx} from '../../src/core/replay/draw'
const h=vi.hoisted(()=>({schedule:vi.fn(),plan:vi.fn(),cursors:vi.fn(),item:vi.fn(),lint:vi.fn(),bytes:vi.fn(),draw:vi.fn()}))
vi.mock('../../src/core/replay/schedule',()=>({scheduleScene:h.schedule}))
vi.mock('../../src/core/replay/cursors',()=>({planCursors:h.plan,renderCursors:h.cursors}))
vi.mock('../../src/core/replay/presets',()=>({renderItem:h.item}))
vi.mock('../../src/core/replay/lint',()=>({lintReplaySvg:h.lint,estimateBytes:h.bytes}))
vi.mock('../../src/core/replay/draw',async original=>({...await original<typeof import('../../src/core/replay/draw')>(),drawRun:h.draw}))
const document=()=>({...defaultReplay(),scenes:[makeScene([])]})
const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html')
const context=()=>h.item.mock.calls[0][1] as RenderCtx
beforeEach(()=>{
 h.schedule.mockReset().mockReturnValue({height:300,end:2,items:[{synthetic:true}],overflow:false})
 h.plan.mockReset().mockReturnValue({end:3,unassigned:[]})
 h.item.mockReset().mockReturnValue('<rect data-layer="item"/>')
 h.cursors.mockReset().mockReturnValue('<path data-layer="cursor"/>')
 h.lint.mockReset().mockReturnValue({errors:[],warnings:[]})
 h.bytes.mockReset().mockReturnValue(100)
 h.draw.mockReset().mockReturnValue(['<text>提示</text>'])
})
it('assembles independent element and cursor layers, forwards image mapping and honors explicit cursor visibility',()=>{
 const doc=document(),map=vi.fn((url:string)=>'mapped:'+url)
 const result=renderReplay(doc,{showCursors:false,mapImage:map,pendingLocalImages:true})
 expect(result.scenes[0]).toMatchObject({height:300,end:2,total:3,bytes:100,itemLayer:'<rect data-layer="item"/>'})
 expect(h.cursors).not.toHaveBeenCalled();expect(result.html).not.toContain('data-layer="cursor"')
 expect(context().img('/media/photo.jpg')).toBe('mapped:/media/photo.jpg')
 expect(map).toHaveBeenCalledExactlyOnceWith('/media/photo.jpg')
 expect(h.lint).toHaveBeenCalledExactlyOnceWith(result.scenes[0].svg,{idsAllowed:false,pendingLocalImages:true})
 expect(context().mode).toEqual({kind:'once'})
})
it('uses the longest cursor/item tail and rounds looping cycles to milliseconds',()=>{
 const doc=document();doc.playback.loop={hold:1.2345}
 h.plan.mockReturnValue({end:1,unassigned:[]})
 const result=renderReplay(doc)
 expect(result.scenes[0].total).toBe(2.4);expect(result.scenes[0].cycle).toBe(3.635)
 expect(context().mode).toEqual({kind:'loop',cycle:3.635})
 expect(replayFinalTimes(doc)).toEqual([2.4])
 expect(result.html).toContain('data-layer="cursor"')
})
it('sanitizes local tap identifiers and hides both layers until the explicit scene trigger',()=>{
 const doc=document();doc.playback.trigger='tap'
 const result=renderReplay(doc,{idPrefix:'<>?!'}),dom=parse(result.html)
 expect(context().mode).toEqual({kind:'tap',trigger:'rp0',cycle:undefined})
 expect(dom.querySelector('rect[id="rp0"]')).toBeTruthy()
 expect(dom.querySelectorAll('set[end="rp0.click"]')).toHaveLength(3)
 expect(h.draw).toHaveBeenCalledOnce()
})
it.each(['#eeeeee','#111111'])('uses external replay triggers without initial hiding and retains readable replay button for %s',color=>{
 const doc=document();doc.playback.trigger='tap';doc.playback.triggerId='start';doc.playback.replay=true;doc.playback.start=1
 doc.canvas.background={type:'color',value:color}
 const result=renderReplay(doc,{idPrefix:'long-safe-prefix-TOO-LONG'}),dom=parse(result.html)
 expect(context().mode).toMatchObject({kind:'tap',trigger:'start',replay:{id:'long-safe-prefix0r',offset:1}})
 expect(dom.querySelectorAll('set')).toHaveLength(0)
 const circle=dom.querySelector('g[id] circle')!
 expect(circle.getAttribute('fill')).toBe(color==='#eeeeee'?'#f2f5fb':'#000000')
 expect(circle.getAttribute('fill-opacity')).toBe(color==='#eeeeee'?'1':'0.35')
})
it('builds tap gradients with actual stops and maps local background images while retaining grid geometry',()=>{
 const doc=document();doc.playback.trigger='tap';doc.canvas.background={type:'gradient',value:'#112233,#445566'}
 const gradient=parse(renderReplay(doc).html)
 expect([...gradient.querySelectorAll('stop')].map(s=>[s.getAttribute('offset'),s.getAttribute('stop-color')])).toEqual([['0','#112233'],['1','#445566']])
 doc.canvas.background={type:'image',value:'',image:{src:'/media/bg.png?old=1'},grid:{size:100,color:'#aaa'}}
 const map=vi.fn(()=> 'data:image/png;base64,AA')
 const output=parse(renderReplay(doc,{mapImage:map}).html)
 expect(map).toHaveBeenCalledExactlyOnceWith('/media/bg.png?w=1500')
 expect(output.querySelector('image')?.getAttribute('href')).toBe('data:image/png;base64,AA')
 expect(output.querySelector('path[stroke="#aaa"]')?.getAttribute('d')).toContain('M100 0V300')
})
it('deduplicates lint messages while reporting per-scene resource, overflow, timing and missing-image evidence',()=>{
 const doc=document();doc.scenes=[makeScene([makeItem('image')]),makeScene([])];doc.budget={sceneKB:1,totalKB:2};doc.cursors.show=true
 h.schedule.mockReturnValue({height:300,end:8,items:[],overflow:true});h.plan.mockReturnValue({end:9,unassigned:['first']});h.bytes.mockReturnValue(2048)
 h.lint.mockReturnValue({errors:['bad','bad'],warnings:['lint warning','lint warning']})
 const result=renderReplay(doc)
 expect(result.errors).toEqual(['bad']);expect(result.warnings.filter(w=>w==='lint warning')).toHaveLength(1)
 for(const fragment of ['场景 1 约 2 KB','场景 2 约 2 KB','整体约 4 KB','内容超出了','没有空闲光标','播放 8.0 秒','有 1 个图片元素'])expect(result.warnings.some(w=>w.includes(fragment))).toBe(true)
})

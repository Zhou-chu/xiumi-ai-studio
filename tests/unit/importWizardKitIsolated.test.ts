// @vitest-environment jsdom
import { act, createElement as el, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Kit } from '../../src/core/assemble'
import type { PlanCheck } from '../../src/core/photoPlan'
import type { Doc } from '../../src/core/types'
import type { Asset } from '../../src/editor/api'
import { ImportWizard } from '../../src/editor/ImportWizard'

const h=vi.hoisted(()=>{
 const deny=()=>{throw Error('Unexpected kit editor operation')}
 const mock=()=>vi.fn<(...args:unknown[])=>unknown>(deny)
 const asyncMock=()=>vi.fn<(...args:unknown[])=>Promise<unknown>>(deny)
 return {deny,fetch:asyncMock(),place:asyncMock(),write:asyncMock(),status:asyncMock(),templates:asyncMock(),notify:vi.fn(),check:mock(),kit:mock(),
  fixed:mock(),rule:mock(),request:mock(),normalize:mock(),assemble:mock(),theme:mock(),probe:vi.fn(),planUi:vi.fn(),photoUi:vi.fn()}
})
vi.mock('../../src/editor/api',()=>({api:{aiStatus:h.status,templates:h.templates,aiCopywrite:h.write,aiPlacePhotos:h.place,aiOutline:h.deny,aiDesign:h.deny,aiEnrichCopy:h.deny,saveProject:h.deny},assetRef:(a:Asset)=>({src:'/media/'+a.file})}))
vi.mock('../../src/editor/store',()=>({useStore:Object.assign((select:(x:unknown)=>unknown)=>select({themes:[]}),{getState:()=>({notify:h.notify})}),saveBeforeLeave:h.deny}))
vi.mock('../../src/editor/documentNavigation',()=>({loadIfUnchanged:h.deny}))
vi.mock('../../src/editor/Modal',()=>({Modal:({children,onClose}:{children:ReactNode;onClose:()=>void})=>el('div',null,el('button',{'data-testid':'close-probe',onClick:onClose},'Close'),children)}))
vi.mock('../../src/editor/KitPicker',()=>({KitPicker:()=>null,useComponents:()=>[],kitCandidates:()=>[],resolveKit:h.kit,layoutOptions:()=>[]}))
vi.mock('../../src/editor/Copywriter',()=>({Copywriter:h.deny}))
vi.mock('../../src/core/layouts',()=>({RECIPES:[],buildDoc:h.deny}))
vi.mock('../../src/core/compiler',()=>({compileDoc:()=>({html:'<p>isolated preview</p>',charCount:16})}))
vi.mock('../../src/core/assemble',()=>({assemble:h.assemble,kitLevels:()=>1}))
vi.mock('../../src/core/templateFill',async original=>({...await original<typeof import('../../src/core/templateFill')>(),templateTheme:h.theme}))
vi.mock('../../src/core/photoPlan',()=>({checkPlan:h.check,fixedPlacements:h.fixed,rulePlacements:h.rule,aiPlaceRequest:h.request,normalizeAiPlacements:h.normalize}))
type PlanProps={check:PlanCheck;onFlatten:()=>void;onAiFlatten:()=>void;onClearAnchor:(key:string)=>void;onContinue:()=>void;onCancel:()=>void;setCrowd:(x:unknown)=>void;setSinglesFor:(x:unknown)=>void}
vi.mock('../../src/editor/PlanIssues',()=>({PlanIssues:(p:PlanProps)=>{
 h.planUi(p)
 return el('div',{'data-testid':'plan-probe'},
  el('button',{'data-testid':'flatten-probe',onClick:p.onFlatten},'Flatten'),
  el('button',{'data-testid':'ai-flatten-probe',onClick:p.onAiFlatten},'AI flatten'),
  el('button',{'data-testid':'continue-probe',onClick:p.onContinue},'Continue'),
  el('button',{'data-testid':'clear-anchor-probe',onClick:()=>p.onClearAnchor('g')},'Clear anchor'),
  el('button',{'data-testid':'resolve-crowd-probe',onClick:()=>{p.setCrowd({para:{mode:'singles'}});p.setSinglesFor(new Set(['g']))}},'Resolve crowd'),
  el('button',{'data-testid':'cancel-plan-probe',onClick:p.onCancel},'Cancel plan'))
}}))
type PhotoProps={setNotes:(x:unknown)=>void;setGroups:(x:unknown)=>void;setAnchors:(x:unknown)=>void;images:Asset[];anchors:Record<string,string>}
vi.mock('../../src/editor/PhotoPlanner',()=>({PhotoPlanner:(p:PhotoProps)=>{
 h.photoUi(p)
 return el('div',null,
  el('button',{'data-testid':'note-probe',onClick:()=>p.setNotes({a:' 展厅设备 '})},'Photo notes'),
  el('button',{'data-testid':'group-probe',onClick:()=>{p.setGroups([{id:'g',photos:['b','missing','a'],layout:'photo2'}, {id:'empty',photos:['missing']}]);p.setAnchors({g:'合成定位'})}},'Group and anchor'))
}}))

const fixture='# 手稿\n\n## 一级标题\n\n已有正文，保留这个句子。\n\n### 二级标题\n\n另一段正文。'
const enabled={enabled:true,model:'synthetic-model',name:'synthetic provider'}
const asset=(id:string):Asset=>({id,file:id+'.jpg',name:id,width:900,height:600,size:7,createdAt:1})
const draft:Doc={id:'fixture-doc',title:'组合结果',author:'',digest:'',themeId:'default',createdAt:1,updatedAt:1,blocks:[]}
const ready:PlanCheck={levels:null,unmatched:[],crowded:[],noLayout:[]}
const close=vi.fn()
const richKit=(html='<p>段落</p>'):Kit=>({body:{role:'body',from:'测试模板',block:createBlock('html',{html})}})
let root:Root,host:HTMLDivElement
const by=(id:string)=>host.querySelector<HTMLElement>('[data-testid="'+id+'"]')!
const press=async(id:string)=>{expect(by(id)).toBeTruthy();await act(async()=>by(id).click())}
const text=()=>by('import-text') as HTMLTextAreaElement
const enter=(value:string)=>act(()=>{
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(text(),value)
 text().dispatchEvent(new Event('input',{bubbles:true}))
})
const mount=async()=>{
 await act(async()=>root.render(el(ImportWizard,{initialText:fixture,initialImages:[asset('a'),asset('b'),asset('c')],onClose:close})))
}
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',h.fetch)
 for(const m of [h.fetch,h.place,h.write,h.status,h.templates,h.check,h.kit,h.fixed,h.rule,h.request,h.normalize,h.assemble,h.theme])m.mockReset()
 for(const m of [h.notify,h.probe,h.planUi,h.photoUi,close])m.mockClear()
 h.kit.mockReturnValue(richKit());h.check.mockReturnValue(ready)
 h.status.mockResolvedValue({enabled:false});h.templates.mockResolvedValue([])
 h.fixed.mockReturnValue({fixed:[],free:[],askAi:[]});h.rule.mockReturnValue([])
 h.assemble.mockReturnValue({doc:draft,warnings:[]})
 vi.stubGlobal('Image',class ImageProbe{
  referrerPolicy='';naturalWidth=0;naturalHeight=0
  onload:(()=>void)|null=null;onerror:(()=>void)|null=null
  set src(value:string){
   h.probe(value,this.referrerPolicy)
   queueMicrotask(()=>{
    if(value==='/media/no-metadata.jpg'){this.onerror?.();return}
    this.naturalWidth=value.includes('icon')?120:600;this.naturalHeight=300;this.onload?.()
   })
  }
 })
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{
 try { act(()=>root.unmount());expect(h.fetch).not.toHaveBeenCalled() }
 finally {host.remove();vi.unstubAllGlobals()}
})

it('brings unresolved kit issues into review, preserves typed text, and lets the user correct or cancel',async()=>{
 h.check.mockReturnValue({...ready,levels:{copy:2,kit:1}})
 await mount();await press('generate')
 expect(by('plan-probe')).toBeTruthy();expect(h.assemble).not.toHaveBeenCalled()
 expect(h.planUi.mock.calls.at(-1)?.[0].check.levels).toEqual({copy:2,kit:1})
 await press('flatten-probe')
 expect(text().value).not.toContain('### 二级标题')
 expect(text().value).toContain('**二级标题**')
 expect(text().value).toContain('另一段正文。')
 await press('cancel-plan-probe')
 expect(by('plan-probe')).toBeNull();expect(by('generate')).toBeTruthy()
})

it('lists current valid group membership and only proceeds when selected crowd and single-photo resolutions remove barriers',async()=>{
 const unit={key:'g',photos:[1,0],grouped:true,layout:'photo2',anchor:'合成定位'}
 h.check.mockReturnValue({...ready,crowded:[{after:'para',anchor:'合成定位',section:'one',photos:[0,1],layouts:['img2h']}],noLayout:[unit]})
 await mount();await press('group-probe');await press('generate')
 expect(h.check.mock.calls.at(-1)?.[2]).toEqual([unit,{key:'c',photos:[2],grouped:false,anchor:undefined}])
 await press('clear-anchor-probe')
 expect(h.photoUi.mock.calls.at(-1)?.[0].anchors.g).toBe('')
 await press('resolve-crowd-probe');await press('continue-probe')
 expect(h.fixed.mock.calls[0][0]).toMatchObject({crowd:{para:{mode:'singles'}},singlesFor:new Set(['g'])})
 expect(h.assemble).toHaveBeenCalledOnce()
 expect(host.textContent).toContain('套用模板')
})

it('measures unique photo slots, marks small icons, tolerates failed reads and passes actual ratios to assembly',async()=>{
 h.kit.mockReturnValue(richKit('<div><img src="/media/photo.jpg"><img src="/media/photo.jpg"><img src="/media/icon.jpg"><img src="/media/no-metadata.jpg"></div>'))
 h.assemble.mockReturnValue({doc:draft,warnings:['合成版式提示']})
 await mount();await press('generate')
 expect(h.probe.mock.calls).toEqual([['/media/photo.jpg','no-referrer'],['/media/icon.jpg','no-referrer'],['/media/no-metadata.jpg','no-referrer']])
 expect(h.assemble.mock.calls[0][4]).toEqual({ratios:{'/media/photo.jpg':0.5,'/media/icon.jpg':0},captions:['','',''],theme:undefined})
 expect(host.textContent).toContain('合成版式提示');expect(host.textContent).toContain('「测试模板」')
})

it.each([false,true])('uses photo planning or explicitly falls back to rules (%s)',async failure=>{
 const fixed={after:'fixed',photos:[0],layout:'singles'}, free={key:'b',photos:[1],grouped:false}, ask={after:'ask',photos:[2],request:'近段落'}
 const fallback={after:'rule',photos:[1],layout:'singles'}, result={after:'arranged',photos:[1,2],layout:'singles'}
 const request={fixture:'placement'}, aiReply={fixture:'reply'}
 h.status.mockResolvedValue(enabled);h.fixed.mockReturnValue({fixed:[fixed],free:[free],askAi:[ask]})
 h.request.mockReturnValue(request);h.normalize.mockReturnValue([result]);h.rule.mockReturnValue([fallback])
 if(failure)h.place.mockRejectedValue(Error('合成摆图失败'));else h.place.mockResolvedValue(aiReply)
 await mount();await press('note-probe');await press('generate');await press('enrich-no')
 expect(h.place).toHaveBeenCalledExactlyOnceWith(request)
 expect(h.request.mock.calls[0].slice(1)).toEqual([[free],[ask],['展厅设备','','']])
 if(failure){
  expect(h.notify).toHaveBeenCalledWith('AI 安排照片失败，已按章节平均分配：合成摆图失败','error')
  expect(h.normalize).not.toHaveBeenCalled()
  expect(h.assemble.mock.calls[0][3]).toEqual([fixed,{after:'ask',photos:[2],layout:'singles'},fallback])
 }else{
  expect(h.rule).not.toHaveBeenCalled()
  expect(h.normalize.mock.calls[0].slice(2)).toEqual([request,[free],[ask],[fixed]])
  expect(h.assemble.mock.calls[0][3]).toEqual([fixed,result])
  expect(host.textContent).toContain('AI 按照片描述安排了照片位置')
 }
})

it('forwards the current draft and available kit heading count when the user explicitly asks for a rewrite',async()=>{
 h.status.mockResolvedValue(enabled);h.check.mockReturnValue({...ready,levels:{copy:2,kit:1}})
 h.write.mockResolvedValue({markdown:'# 新草稿\n\n## 标题\n\n保留正文。'})
 await mount();await press('generate');await press('ai-flatten-probe')
 expect(h.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({levels:1,previous:fixture,revise:expect.stringContaining('改成 1 级标题')}))
 expect(text().value).toContain('# 新草稿')
 enter('# 手动文案\n\n仍可编辑。');expect(text().value).toContain('仍可编辑。')
 expect(h.assemble).not.toHaveBeenCalled()
})

it.each(['new text','ABA','close'])('does not apply a heading rewrite after %s invalidates its original draft',async reason=>{
 h.status.mockResolvedValue(enabled);h.check.mockReturnValue({...ready,levels:{copy:2,kit:1}})
 let settle!:(value:{markdown:string})=>void
 h.write.mockReturnValueOnce(new Promise<{markdown:string}>(resolve=>{settle=resolve}))
 await mount();await press('generate');await press('ai-flatten-probe')
 const newer='# 手工新稿\n\n这次操作比 AI 请求更新。'
 if(reason==='close')await press('close-probe')
 else{
  enter(newer)
  if(reason==='ABA')enter(fixture)
 }
 await act(async()=>{settle({markdown:'# 陈旧改写\n\n## 标题\n\n不应替换。'})})
 expect(text().value).toBe(reason==='new text'?newer:fixture)
 expect(h.assemble).not.toHaveBeenCalled()
 if(reason==='close'){expect(close).toHaveBeenCalledOnce();expect(h.notify).not.toHaveBeenCalled()}
 else expect(h.notify).toHaveBeenCalledExactlyOnceWith('当前文案已变化，未应用 AI 标题改写')
})

it('keeps a failed current title rewrite retryable and only applies the next valid response',async()=>{
 h.status.mockResolvedValue(enabled);h.check.mockReturnValue({...ready,levels:{copy:2,kit:1}})
 h.write.mockRejectedValueOnce(Error('合成传输中断')).mockResolvedValueOnce({markdown:'# 有效重试\n\n## 一级标题\n\n保留正文。'})
 await mount();await press('generate');await press('ai-flatten-probe')
 expect(text().value).toBe(fixture)
 expect(h.notify).toHaveBeenCalledExactlyOnceWith('合成传输中断','error')
 await press('ai-flatten-probe')
 expect(text().value).toContain('# 有效重试')
 expect(h.write).toHaveBeenCalledTimes(2)
 expect(h.assemble).not.toHaveBeenCalled()
})

// @vitest-environment jsdom
import {act,useState,type ReactNode} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {KitPicker,useComponents,kitCandidates,resolveKit,layoutOptions,type KitChoice} from '../../src/editor/KitPicker'
import {TemplateModules,templateRoles,themeOf} from '../../src/editor/TemplateModules'
import {PhotoPlanner,type PhotoGroup} from '../../src/editor/PhotoPlanner'
import {api,type Asset} from '../../src/editor/api'
import {createBlock} from '../../src/core/blocks'
import {useStore} from '../../src/editor/store'
vi.mock('../../src/editor/ComponentLibrary',()=>({LazyPreview:({block}:any)=><div data-testid="preview" data-block-id={block.id}/>}))
vi.mock('../../src/editor/api',async original=>({...await original<typeof import('../../src/editor/api')>(),api:{components:vi.fn(),updateTemplate:vi.fn()}}))
let host:HTMLDivElement,root:Root
const initial=useStore.getState()
const heading=createBlock('heading',{title:'Heading'}),photo=createBlock('image'),html=createBlock('html',{html:'<p>original</p>',label:'HTML label'})
const template:any={id:'tpl',name:'Fixture template',blocks:[heading,photo,html],roles:{[heading.id]:'h1',[photo.id]:'img1',[html.id]:'other'}}
const comps:any[]=[{id:'c1',name:'First heading',role:'h1',tags:['formal'],block:heading},{id:'c2',name:'Second heading',role:'h1',tags:[],block:createBlock('heading')},{id:'c3',name:'Inferred body',tags:[],block:createBlock('paragraph')}].map(c=>({...c,origin:{title:'Source',account:'',kind:'original',url:''},text:c.name,palette:[]}))
function KitHarness({templates=[template],components=comps,start=[] as string[],startComps=[] as string[]}:any){const[picked,setPicked]=useState<string[]>(start),[pickedComps,setPickedComps]=useState<string[]>(startComps),[choice,setChoice]=useState<KitChoice>({});return <><KitPicker templates={templates} comps={components} picked={picked} setPicked={setPicked} pickedComps={pickedComps} setPickedComps={setPickedComps} choice={choice} setChoice={setChoice}/><output>{JSON.stringify({picked,pickedComps,choice})}</output></>}
const assets:Asset[]=[1,2,3,4].map(i=>({id:`a${i}`,name:`Photo ${i}`,file:`p${i}.png`,width:800,height:600} as Asset))
function PhotoHarness({start=assets,layout=['img2lr'],initialGroups=[] as PhotoGroup[]}:any){const[images,setImages]=useState<Asset[]>(start),[notes,setNotes]=useState({}),[groups,setGroups]=useState<PhotoGroup[]>(initialGroups),[anchors,setAnchors]=useState<Record<string,string>>({a1:'A matching sentence.',a2:'unused',unrelated:'retained'});return <><PhotoPlanner images={images} setImages={setImages} notes={notes} setNotes={setNotes} groups={groups} setGroups={setGroups} anchors={anchors} setAnchors={setAnchors} layouts={layout} text={'# Title\n## Section\nA matching sentence. Another sentence.'}/><output>{JSON.stringify({images,notes,groups,anchors})}</output></>}
function state(){return JSON.parse(host.querySelector('output')!.textContent!)}
async function render(node:ReactNode){await act(async()=>root.render(node));await act(async()=>{await new Promise(r=>setTimeout(r,0))})}
async function click(selector:string){const el=host.querySelector<HTMLElement>(selector)!;expect(el).toBeTruthy();await act(async()=>el.click())}
async function value(selector:string,text:string){const el=host.querySelector<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(selector)!;const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,text);el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}))})}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.resetAllMocks();useStore.setState(initial,true);vi.mocked(api.components).mockResolvedValue(comps);vi.mocked(api.updateTemplate).mockResolvedValue(template);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('template toggles, explicit role choice, previews and none use real candidate resolution',async()=>{
 await render(<KitHarness/>);expect(host.querySelector('[data-testid="kit-table"]')).toBeNull();await click('[data-testid="pick-template"]');expect(state().picked).toEqual(['tpl']);expect(host.textContent).toContain('图片版式')
 await click('.kit-table th button');expect(host.querySelector('[data-testid="preview"]')).toBeTruthy();await click('.kit-table th button');expect(host.querySelector('[data-testid="preview"]')).toBeNull()
 await value('[data-testid="kit-choice-h1"]','none');expect(host.querySelector('.kit-table tr.off')).toBeTruthy();await click('[data-testid="pick-template"]');expect(state().picked).toEqual([])
})
it('component modal replaces duplicate roles, supports toggles, filters, search and explicit commit',async()=>{
 await render(<KitHarness start={['tpl']} startComps={['missing']}/>);await click('[data-testid="pick-components"]');await click('[data-testid="kit-component"]');await click('[data-testid="kit-component"]');expect(host.querySelectorAll('.tm-card.on')).toHaveLength(0)
 await click('[data-testid="kit-component"]');await click('[data-testid="kit-component"]:nth-child(2)');expect(useStore.getState().toast?.text).toContain('只能用一个组件')
 await value('[role="dialog"] input.grow','no match');expect(host.textContent).toContain('没有符合条件');await value('[role="dialog"] input.grow','');await click('[role="dialog"] .seg button:nth-child(3)');expect(host.querySelectorAll('[data-testid="kit-component"]')).toHaveLength(1);await click('[data-testid="kit-component"]');await click('[data-testid="kit-components-done"]');expect(state().pickedComps).toEqual(['missing','c2','c3'])
 expect(host.textContent).toContain('同名 2 个');await value('[data-testid="kit-choice-h1"]',`t:tpl:${heading.id}`);expect(state().choice.h1).toBe(`t:tpl:${heading.id}`)
 await click('.kit-comps .chip button');expect(state().pickedComps).toEqual(['missing','c3'])
})
it('empty component and template states close without mutating selection',async()=>{
 await render(<KitHarness templates={[]} components={[]}/>);expect(host.textContent).toContain('还没有模板');await click('[data-testid="pick-components"]');expect(host.textContent).toContain('还没有收藏组件');await click('[role="dialog"] button.close');expect(host.querySelector('[role="dialog"]')).toBeNull()
 await click('[data-testid="pick-components"]');await click('.modal-actions button:first-child');expect(state().pickedComps).toEqual([])
})
it('viewing template opens real role editor, cancel closes it',async()=>{await render(<KitHarness/>);await click('[data-testid="view-modules"]');expect(host.querySelectorAll('[data-testid="template-module"]')).toHaveLength(3);await click('.modal-actions button:first-child');expect(host.querySelector('[role="dialog"]')).toBeNull()})
it('candidate and theme helpers ignore missing ids and preserve explicit component precedence',()=>{
 const t:any={...template,roles:{[heading.id]:'h1',[photo.id]:'img1',[html.id]:'body'}};const c=kitCandidates([t],['missing','tpl'],comps,['missing','c1']);expect(c).toHaveLength(4);expect(c.find(x=>x.block.id===html.id)?.label).toContain('HTML label');expect(resolveKit(c,{}).h1?.from).toBe('组件库');expect(resolveKit(c,{h1:'none'}).h1).toBeUndefined();expect(layoutOptions(resolveKit(c,{}))).toEqual(['img1']);expect(themeOf(t).themeId).toBe('minimal-magazine');expect(themeOf({...t,themeId:'warm'}).themeId).toBe('warm')
})
it('role editor saves mapping and emits refresh, failures preserve unsaved choices',async()=>{
 const close=vi.fn(),saved=vi.fn(),refresh=vi.fn();window.addEventListener('templates-changed',refresh);await render(<TemplateModules template={template} onClose={close} onSaved={saved}/>);expect(host.querySelector('[data-testid="save-module-roles"]')?.hasAttribute('disabled')).toBe(true)
 await value('[data-testid="module-role-2"]','h1');expect(host.textContent).toContain('同名 2 个');vi.mocked(api.updateTemplate).mockRejectedValueOnce(new Error('save failed'));await click('[data-testid="save-module-roles"]');expect(useStore.getState().toast?.text).toBe('save failed');expect(close).not.toHaveBeenCalled();expect((host.querySelector('[data-testid="module-role-2"]') as HTMLSelectElement).value).toBe('h1')
 await click('[data-testid="save-module-roles"]');expect(api.updateTemplate).toHaveBeenLastCalledWith('tpl',{roles:{[heading.id]:'h1',[photo.id]:'img1',[html.id]:'h1'}});expect(saved).toHaveBeenCalledWith(template);expect(close).toHaveBeenCalledOnce();expect(refresh).toHaveBeenCalledOnce();window.removeEventListener('templates-changed',refresh)
})
it('unconfirmed roles are inferred but can be explicitly saved without optional callback',async()=>{
 const t={...template,roles:undefined};expect(templateRoles(t).confirmed).toEqual([false,false,false]);await render(<TemplateModules template={t} onClose={()=>{}}/>);expect(host.textContent).toContain('自动识别');expect(host.querySelector('[data-testid="save-module-roles"]')?.hasAttribute('disabled')).toBe(false);await click('[data-testid="save-module-roles"]');expect(api.updateTemplate).toHaveBeenCalled()
})
it('useComponents refreshes on event, preserves last results on failure and unsubscribes',async()=>{
 function Probe(){const components=useComponents();return <output>{components.length}</output>}
 await render(<Probe/>);expect(host.querySelector('output')?.textContent).toBe('3');vi.mocked(api.components).mockRejectedValueOnce(new Error('offline'));await act(async()=>window.dispatchEvent(new Event('components-changed')));expect(host.querySelector('output')?.textContent).toBe('3');vi.mocked(api.components).mockResolvedValue([]);await act(async()=>window.dispatchEvent(new Event('components-changed')));expect(host.querySelector('output')?.textContent).toBe('0');await render(null);const calls=vi.mocked(api.components).mock.calls.length;window.dispatchEvent(new Event('components-changed'));expect(api.components).toHaveBeenCalledTimes(calls)
})
it('photo notes and anchors update genuine state with match validation',async()=>{
 await render(<PhotoHarness/>);expect(host.textContent).toContain('✓');await value('[data-testid="photo-note-1"]','Opening ceremony');expect(state().notes.a1).toBe('Opening ceremony');await value('[data-testid="photo-anchor-1"]','not in article');expect(host.querySelector('.anchor .bad')).toBeTruthy();await value('[data-testid="photo-anchor-1"]','');expect(host.querySelector('li:first-child .anchor small')).toBeNull()
})
it('photo group sorts by source order, clears individual anchors and shares group location',async()=>{
 await render(<PhotoHarness/>);await click('[data-testid="photo-pick-3"]');await click('[data-testid="photo-pick-1"]');await click('[data-testid="photo-pick-1"]');await click('[data-testid="photo-pick-1"]');await click('[data-testid="make-group"]');const s=state();expect(s.groups[0].photos).toEqual(['a1','a3']);expect(s.anchors.a1).toBeUndefined();expect(s.anchors.unrelated).toBe('retained');expect(host.querySelector('[data-testid="photo-pick-1"]')?.hasAttribute('disabled')).toBe(true)
 await value('[data-testid="group-layout"]','img2lr');expect(state().groups[0].layout).toBe('img2lr');await value('[data-testid="group-anchor"]','A matching sentence.');expect(state().anchors[s.groups[0].id]).toBe('A matching sentence.');await value('[data-testid="photo-anchor-1"]','Another sentence.');expect((host.querySelector('[data-testid="photo-anchor-3"]') as HTMLInputElement).value).toBe('Another sentence.')
 await click('[data-testid="ungroup"]');expect(state().groups).toEqual([])
})
it('removing photos prunes undersized groups and selection but preserves valid remaining groups',async()=>{
 await render(<PhotoHarness initialGroups={[{id:'g1',photos:['a1','a2'],layout:''},{id:'g2',photos:['a3','a4'],layout:''}]}/>);await value('[data-testid="group-layout"]','img2lr');expect(state().groups[1].layout).toBe('');await click('li:first-child > button');expect(state().images).toHaveLength(3);expect(state().groups.map((g:any)=>g.id)).toEqual(['g2']);await click('[data-testid="ungroup"]');await click('[data-testid="photo-pick-1"]');await click('li:first-child > button');expect(host.querySelector('[data-testid="make-group"]')).toBeNull()
})
it('group layout availability, automatic layout and empty photos are honest',async()=>{
 await render(<PhotoHarness layout={['img1']} initialGroups={[{id:'g',photos:['a1','a2'],layout:''}]}/>);expect(host.textContent).toContain('没有 2 图版式');await render(<PhotoHarness key="auto" layout={[]} initialGroups={[{id:'g',photos:['a1','a2'],layout:''}]}/>);expect(host.textContent).toContain('排版时决定');await render(<PhotoHarness key="empty" start={[]}/>);expect(host.textContent).toContain('还没有照片')
})

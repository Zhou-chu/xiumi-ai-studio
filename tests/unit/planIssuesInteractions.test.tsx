// @vitest-environment jsdom
import {useState} from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {PlanIssues} from '../../src/editor/PlanIssues'
import type {PlanCheck,Crowd} from '../../src/core/photoPlan'
import {setup,cleanup,mount,host,click,byTest,input} from './libraryToolbarHarness'
beforeEach(setup);afterEach(cleanup)
const clear:PlanCheck={levels:null,unmatched:[],crowded:[],noLayout:[]}
const callbacks=()=>({onFlatten:vi.fn(),onAiFlatten:vi.fn(),onClearAnchor:vi.fn(),onContinue:vi.fn(),onCancel:vi.fn()})
function Live({check=clear,aiOn=true,busy='',initial={},cb=callbacks()}:{check?:PlanCheck;aiOn?:boolean;busy?:string;initial?:Record<string,Crowd>;cb?:ReturnType<typeof callbacks>}){
 const[crowd,setCrowd]=useState(initial),[singlesFor,setSinglesFor]=useState(new Set<string>())
 return <PlanIssues {...cb} {...{check,aiOn,busy,crowd,setCrowd,singlesFor,setSinglesFor}}/>
}
const disabled=()=> (byTest('plan-continue') as HTMLButtonElement).disabled
it('clear plans continue, cancellation remains available; busy blocks continue',async()=>{
 const cb=callbacks();await mount(<Live cb={cb}/>);expect(disabled()).toBe(false);await click(byTest('plan-continue'));expect(cb.onContinue).toHaveBeenCalledOnce();await click(host.querySelector('.modal-actions button'));expect(cb.onCancel).toHaveBeenCalledOnce()
 await mount(<Live cb={cb} busy="Working"/>);expect(disabled()).toBe(true);expect(byTest('plan-continue')?.textContent).toBe('Working')
})
it('level and unmatched issues block continuation and expose exact repair callbacks',async()=>{
 const cb=callbacks(),check={...clear,levels:{copy:3,kit:0},unmatched:[{key:'missing',photos:[0,2],grouped:false,anchor:'Missing sentence'}]}
 await mount(<Live check={check} cb={cb}/>);expect(disabled()).toBe(true);expect(byTest('issue-unmatched')?.textContent).toContain('Missing sentence');await click(byTest('flatten-levels'));await click(byTest('ai-flatten'));await click(byTest('issue-unmatched')?.querySelector('button'));expect(cb.onFlatten).toHaveBeenCalledOnce();expect(cb.onAiFlatten).toHaveBeenCalledOnce();expect(cb.onClearAnchor).toHaveBeenCalledWith('missing')
 await mount(<Live check={{...check,levels:{copy:2,kit:1}}} cb={cb} busy="Busy"/>);expect((byTest('ai-flatten') as HTMLButtonElement).disabled).toBe(true)
 await mount(<Live check={check} aiOn={false}/>);expect(byTest('ai-flatten')).toBeNull()
})
it('crowded choices update real state, validate group layouts and require nonblank AI requests',async()=>{
 const check:PlanCheck={...clear,crowded:[{after:'p',anchor:'A'.repeat(40),section:'Intro',photos:[0,1],layouts:['img2lr','img2tb']}]}
 await mount(<Live check={check}/>);expect(disabled()).toBe(true);expect(byTest('issue-crowded')?.textContent).not.toContain('A'.repeat(40))
 await click(byTest('crowd-singles'));expect(disabled()).toBe(false)
 await click(byTest('crowd-group'));expect(disabled()).toBe(false);await input(byTest('crowd-layout'),'img2tb');expect((byTest('crowd-layout') as HTMLSelectElement).value).toBe('img2tb')
 await click(byTest('crowd-ai'));expect(disabled()).toBe(true);await input(byTest('crowd-request'),'   ');expect(disabled()).toBe(true);await input(byTest('crowd-request'),'Place side by side');expect(disabled()).toBe(false)
 await click(byTest('crowd-singles'));await click(byTest('crowd-ai'));expect((byTest('crowd-request') as HTMLInputElement).value).toBe('')
})
it('unavailable grouping/AI are disabled, invalid saved layout does not pass, splitting can be toggled back',async()=>{
 const check:PlanCheck={...clear,crowded:[{after:'p',anchor:'Short',section:'Intro',photos:[0,1],layouts:[]}],noLayout:[{key:'group',photos:[2,3],grouped:true}]}
 await mount(<Live check={check} aiOn={false} initial={{p:{mode:'group',layout:'img2lr'}}}/>);expect(disabled()).toBe(true);expect((byTest('crowd-group') as HTMLInputElement).disabled).toBe(true);expect((byTest('crowd-ai') as HTMLInputElement).disabled).toBe(true)
 await click(byTest('crowd-singles'));expect(disabled()).toBe(true);await click(byTest('issue-nolayout')?.querySelector('input'));expect(disabled()).toBe(false);await click(byTest('issue-nolayout')?.querySelector('input'));expect(disabled()).toBe(true)
})

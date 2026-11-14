// @vitest-environment jsdom
import {act} from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {ComponentLibrary,LazyPreview} from '../../src/editor/ComponentLibrary'
import {api} from '../../src/editor/api'
import {makeDraft,type LibraryComponent,fingerprint} from '../../src/core/components'
import {createBlock} from '../../src/core/blocks'
import {setup,cleanup,mount,host,click,button,byTest,input,dispatch,state,template} from './libraryToolbarHarness'
const make=(name='Saved',kind:'original'|'xiumi'='original'):LibraryComponent=>({...makeDraft({name,block:createBlock('html',{label:'Card',html:'<p style="color:#aa1133">Reusable text</p>'}),source:{kind,title:'Source',url:'',account:''},via:'block',attested:true}),id:name,schema:1,rev:1,createdAt:1,updatedAt:1})
beforeEach(setup);afterEach(cleanup)
it('saved component insert/edit/cancel/delete are real operations with confirmation',async()=>{
 const c={...make(),missing:['gone.png'],fixedDecor:1};vi.mocked(api.components).mockResolvedValue([c]);const update=vi.spyOn(api,'updateComponent').mockResolvedValue(c);const del=vi.spyOn(api,'deleteComponent').mockResolvedValue({} as any)
 await mount(<ComponentLibrary templates={[]}/>);const n=state().doc.blocks.length;await click(byTest('component-insert'));expect(state().doc.blocks).toHaveLength(n+1);expect(state().toast?.kind).toBe('error')
 await click(byTest('component-edit'));await input(byTest('component-name'),'Rename');await input(byTest('component-tags'),'one,two');const role=host.querySelector('[data-testid="component-role"] option[value]:not([value=""])')!.getAttribute('value')!;await input(byTest('component-role'),role);await click(button('取消'));expect(update).not.toHaveBeenCalled()
 await click(byTest('component-edit'));await click(byTest('component-edit-save'));expect(update).toHaveBeenCalledWith(c.id,expect.objectContaining({name:'Rename',tags:['one','two'],role}))
 vi.mocked(window.confirm).mockReturnValueOnce(false);await click(byTest('component-delete'));expect(del).not.toHaveBeenCalled();await click(byTest('component-delete'));expect(del).toHaveBeenCalledWith(c.id)
})
it('search, kind, hue, role and match-on-insert filters reflect real library metadata',async()=>{
 const c=make('External','xiumi');vi.mocked(api.components).mockResolvedValue([c,{...make('Other'),id:'other',role:'',tags:['tag']}]);await mount(<ComponentLibrary templates={[]}/>);expect(host.querySelectorAll('[data-testid="component-card"]')).toHaveLength(2)
 await input(byTest('component-search'),'External');expect(host.querySelectorAll('[data-testid="component-card"]')).toHaveLength(1);await input(byTest('component-search'),'none');expect(host.textContent).toContain('没有符合条件');await input(byTest('component-search'),'')
 await click(byTest(`kind-${c.kind}`));await click(byTest(`kind-${c.kind}`));await click(button('全部'))
 const hue=host.querySelector('.comp-hues button')!;await click(hue);await click(hue);await input(byTest('component-role-filter'),c.role!);expect(host.querySelectorAll('[data-testid="component-card"]').length).toBeGreaterThan(0);await input(byTest('component-role-filter'),'')
 await click(byTest('match-on-insert'));expect(state().matchColors).toBe(true);await dispatch('components-changed');await dispatch('assets-changed');expect(api.components).toHaveBeenCalledTimes(3)
})
it('template parts insert and emit collection requests, show collected identities and filter absence',async()=>{
 const html=createBlock('html',{html:'<p>Template part</p>',label:'Part',source:{kind:'xiumi',title:'Source',url:'',account:''}});const tpl={...template,blocks:[html,createBlock('heading')]}
 await mount(<ComponentLibrary templates={[tpl]}/>);await click(byTest('components-parts'));expect(host.querySelectorAll('[data-testid="part-card"]')).toHaveLength(2)
 const listener=vi.fn();window.addEventListener('open-collect',listener);await click(byTest('part-collect'));expect(listener).toHaveBeenCalled();window.removeEventListener('open-collect',listener)
 const n=state().doc.blocks.length;await click(byTest('part-insert'));expect(state().doc.blocks).toHaveLength(n+1)
 vi.mocked(api.components).mockResolvedValue([{...make(),fingerprint:fingerprint(html)}]);await dispatch('components-changed');expect(host.querySelector('.comp-done')).not.toBeNull()
 await input(byTest('component-search'),'absent');expect(host.textContent).toContain('没有符合条件的部件');await click(byTest('components-saved'));expect(byTest('component-role-filter')).not.toBeNull()
})
it('empty and failed libraries are honest and lazy previews handle observer lifecycle and invalid markup',async()=>{
 vi.mocked(api.components).mockRejectedValue(new Error('Library unavailable'));await mount(<ComponentLibrary templates={[]}/>);expect(state().toast?.text).toBe('Library unavailable');expect(host.textContent).toContain('还没有收藏组件');await click(byTest('components-parts'));expect(host.textContent).toContain('还没有收藏模板')
 let notify!:(entries:any[])=>void;const disconnect=vi.fn();vi.stubGlobal('IntersectionObserver',class {constructor(cb:any){notify=cb}observe(){}disconnect=disconnect})
 await mount(<LazyPreview block={createBlock('heading',{title:'Preview heading'})} doc={state().doc} tall/>);expect(host.querySelector('.comp-inner')?.innerHTML).toBe('');await act(async()=>notify([{isIntersecting:true}]));expect(host.textContent).toContain('Preview heading');await act(async()=>notify([{isIntersecting:false}]));expect(host.querySelector('.comp-inner')?.innerHTML).toBe('')
 await mount(<div/>);expect(disconnect).toHaveBeenCalled();vi.stubGlobal('IntersectionObserver',undefined);await mount(<LazyPreview block={{...createBlock('heading'),props:null} as any} doc={state().doc}/>);expect(host.querySelector('.comp-inner')?.innerHTML).toBe('')
})

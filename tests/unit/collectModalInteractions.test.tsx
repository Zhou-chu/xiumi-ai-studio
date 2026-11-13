// @vitest-environment jsdom
import {act} from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {CollectHost} from '../../src/editor/CollectModal'
import {openCollect,type CollectRequest} from '../../src/editor/componentActions'
import {createBlock} from '../../src/core/blocks'
import {api} from '../../src/editor/api'
import {setup,cleanup,mount,host,click,button,byTest,input,state} from './libraryToolbarHarness'
beforeEach(setup);afterEach(cleanup)
const open=async(req:CollectRequest)=>{await mount(<CollectHost/>);await act(async()=>{openCollect(req)})}
it('native blocks save with explicit name/role/tags and close without imported-content attestation',async()=>{
 const save=vi.spyOn(api,'saveComponent').mockResolvedValue({component:{name:'Native'} as any,duplicate:false});await open({block:createBlock('heading'),via:'block'});expect(byTest('collect-attest')).toBeNull();await input(byTest('collect-name'),' Native ');await input(byTest('collect-tags'),'one, two one');const role=(host.querySelector('[data-testid="collect-role"] option:not([value=""])') as HTMLOptionElement).value;await input(byTest('collect-role'),role);await click(byTest('collect-save'));expect(save).toHaveBeenCalledWith(expect.objectContaining({name:'Native',tags:['one','two'],role,origin:expect.objectContaining({attested:true,via:'block'})}));expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('picked HTML preserves scope, requires authorization, edits source and reports duplicate saves',async()=>{
 const save=vi.spyOn(api,'saveComponent').mockResolvedValue({component:{name:'Existing'} as any,duplicate:true});const block=createBlock('html',{label:'Whole',html:'<h2>Whole title</h2><p>Whole body</p>',source:{kind:'wechat',title:'Seed',url:'https://source.test',account:'Source'}})
 await open({block,fragment:'<p>Picked text</p>',via:'fragment'});expect(byTest('collect-preview')?.textContent).toContain('Picked text');expect((byTest('collect-save') as HTMLButtonElement).disabled).toBe(true)
 await click(byTest('split-1'));expect((byTest('collect-name') as HTMLInputElement).value).toBe('Whole');await click(byTest('split-0'));const selectedRole=(byTest('collect-role') as HTMLSelectElement).value;await input(byTest('collect-role'),selectedRole);await click(byTest('split-1'));expect((byTest('collect-role') as HTMLSelectElement).value).toBe(selectedRole)
 await click(button('秀米'));await input(host.querySelector('input[placeholder="https://"]'),' https://updated.test ');const fields=host.querySelectorAll('.article-options label.field input');await input(fields[2],'Updated source');await input(byTest('collect-name'),'');await click(byTest('collect-attest'));await click(byTest('collect-save'));expect(state().toast?.text).toContain('Existing');expect(save).toHaveBeenCalledWith(expect.objectContaining({origin:expect.objectContaining({kind:'xiumi',url:'https://updated.test'})}));expect(host.textContent).toContain('已收藏');await click(byTest('collect-close'));expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('split collection supports decorated parts and error retry without losing the draft',async()=>{
 const card=(title:string)=>`<section style="border:1px solid #aa3344;padding:20px;margin:16px"><h2>${title}</h2><p>${'Body content. '.repeat(12)}</p></section>`
 const save=vi.spyOn(api,'saveComponent').mockRejectedValueOnce(new Error('Save failed')).mockResolvedValue({component:{name:'Saved'} as any,duplicate:false})
 await open({block:createBlock('html',{html:card('First')+card('Second')+'<section style="background:#eeeeee;padding:24px"><p>Another independent block with distinct structure and enough content for extraction.</p></section>',label:'Full'}),source:{title:'Request source',kind:'other',url:'',account:''},via:'template'})
 expect(host.querySelectorAll('.split-list button').length).toBeGreaterThan(1);await click(byTest('split-1'));await click(byTest('collect-attest'));await click(byTest('collect-save'));expect(state().toast?.text).toBe('Save failed');expect(host.querySelector('[role="dialog"]')).not.toBeNull();await click(byTest('collect-save'));expect(save).toHaveBeenLastCalledWith(expect.objectContaining({origin:expect.objectContaining({via:'fragment'})}));await click(byTest('collect-close'))
})
it('cancel never persists and unseeded HTML has an honest default source',async()=>{
 const save=vi.spyOn(api,'saveComponent');await open({block:createBlock('html',{html:'<p>Only text</p>',label:'Simple'}),via:'block'});expect(host.textContent).toContain('其他');await click(byTest('collect-close'));expect(save).not.toHaveBeenCalled()
})

// @vitest-environment jsdom
import {act} from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {RightPanel} from '../../src/editor/RightPanel'
import {api} from '../../src/editor/api'
import {emptyDoc} from '../../src/editor/store'
import {setup,cleanup,mount,host,click,button,input,state} from './libraryToolbarHarness'
beforeEach(setup);afterEach(cleanup)
const html='<h1 style="font-size:32px;color:#aa1133">Title</h1><p style="font-size:16px;color:#111111;line-height:1.8">Body</p><p style="font-size:14px;color:#333333">More</p><div style="padding:24px;border-radius:4px">Card</div>'
const open=async(mode:'theme'|'reference')=>{await mount(<RightPanel/>);await click(host.querySelector(`[data-testid="tab-${mode}"]`));if(mode==='reference'){await click(host.querySelector('input[type="checkbox"]'));await input(host.querySelector('textarea'),html);await click(button('分析粘贴内容'))}return button(mode==='theme'?'保存为我的主题':'保存并应用为新主题')}
for(const mode of ['theme','reference'] as const){
 it(`${mode} reports save failure, releases busy state and allows retry without altering draft`,async()=>{
  const save=vi.spyOn(api,'saveTheme').mockRejectedValueOnce(new Error('Theme storage unavailable')).mockResolvedValue({})
  const action=await open(mode),before=state().doc;await click(action);expect(state().toast).toEqual({text:'Theme storage unavailable',kind:'error'});expect(state().doc).toBe(before);expect(action.disabled).toBe(false)
  await click(action);expect(save).toHaveBeenCalledTimes(2);expect(state().doc.themeId).not.toBe(before.themeId)
 })
 for(const change of ['switch','edit'] as const)it(`${mode} does not apply a delayed saved theme after document ${change}`,async()=>{
  let resolve!:(x:unknown)=>void;const save=vi.spyOn(api,'saveTheme').mockImplementation(()=>new Promise(r=>{resolve=r}));const action=await open(mode);await click(action)
  await act(async()=>{if(change==='switch')state().load({...emptyDoc(),id:'other',title:'Other draft'});else state().setDocFields({title:'Fresh edit'})});const expected=state().doc
  await act(async()=>{resolve({});await Promise.resolve()});expect(state().doc).toBe(expected);expect(state().themes.some(t=>t.id===save.mock.calls[0][0].id)).toBe(true);expect(state().toast?.text).toContain('未应用');expect(state().toast?.kind).toBe('error')
 })
 it(`${mode} serializes duplicate saves and does not mutate a draft after the panel closes`,async()=>{
  let resolve!:(x:unknown)=>void;const save=vi.spyOn(api,'saveTheme').mockImplementation(()=>new Promise(r=>{resolve=r}));const action=await open(mode);const before=state().doc;await click(action);await click(action);expect(save).toHaveBeenCalledTimes(1);expect(action.disabled).toBe(true)
  await click(host.querySelector('[data-testid="tab-style"]'));await act(async()=>{resolve({});await Promise.resolve()});expect(state().doc).toBe(before)
 })
 it(`${mode} cancellation never persists or applies a theme`,async()=>{vi.spyOn(window,'prompt').mockReturnValue(null);const save=vi.spyOn(api,'saveTheme').mockResolvedValue({});await click(await open(mode));expect(save).not.toHaveBeenCalled()})
}

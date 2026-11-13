// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {RightPanel} from '../../src/editor/RightPanel'
import {useStore,emptyDoc} from '../../src/editor/store'
import {createBlock} from '../../src/core/blocks'
import {instructionSuggestions} from '../../src/editor/suggestionQueue'
import {api} from '../../src/editor/api'
let root:Root,host:HTMLDivElement
const state=()=>useStore.getState()
const click=async(el:Element|null)=>{expect(el).not.toBeNull();await act(async()=>{(el as HTMLElement).click()})}
const button=(text:string)=>{const result=[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);if(!result)throw new Error(`Missing ${text}: ${[...host.querySelectorAll('button')].map(b=>b.textContent).join('|')}`);return result}
const input=async(el:Element|null,value:string)=>{expect(el).not.toBeNull();await act(async()=>{const node=el as HTMLInputElement;const proto=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}))})}
const mount=()=>act(async()=>{root.render(<RightPanel/>)})
const ai=async()=>{await click(host.querySelector('[data-testid="tab-ai"]'))}
const instruction=(text:string)=>input(host.querySelector('.ai-suggestion-input textarea'),text)
beforeEach(()=>{
 instructionSuggestions.clear();vi.useFakeTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.setItem('xiumi:auto-input-suggestions','off')
 vi.spyOn(api,'aiStatus').mockResolvedValue({enabled:true,provider:'openai',model:'fixture',name:'Test model',profileId:'fixture'} as any)
 vi.spyOn(api,'assets').mockResolvedValue([]);vi.spyOn(api,'aiSuggestInstruction').mockResolvedValue({suggestion:'Suggested edit'})
 state().load({...emptyDoc(),title:'Original doc',blocks:[{...createBlock('heading'),id:'a',props:{index:'01',title:'Alpha',subtitle:'Sub',variant:'auto'}},{...createBlock('heading'),id:'b'}]})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks()})
it('edits document metadata then keeps single and multi-module properties synchronized',async()=>{
 await mount();const fields=host.querySelectorAll('.props-form input,.props-form textarea');await input(fields[0],'New title');await input(fields[1],'Author');await input(fields[2],'Digest');expect(state().doc).toMatchObject({title:'New title',author:'Author',digest:'Digest'})
 await act(async()=>state().select('a'));await input(host.querySelectorAll('.props-form input')[1],'Edited Alpha');expect(state().doc.blocks[0].props).toMatchObject({title:'Edited Alpha'})
 await act(async()=>state().select('b',{toggle:true}));expect(host.textContent).toContain('已选 2 个模块');expect(host.querySelectorAll('.props-form input')).toHaveLength(0)
 await click(button('取消选择'));expect(state().selectedIds).toEqual([])
 await act(async()=>{state().select('a');state().select('b',{toggle:true})});await click(host.querySelector('[data-testid="delete-selected-blocks"]'));expect(state().doc.blocks).toHaveLength(0)
})
it('AI scope resets on selection changes and sends actual scope, not stale full-document override',async()=>{
 const edit=vi.spyOn(api,'aiEdit').mockResolvedValue({summary:'Edit',ops:[{op:'update',id:'b',props:{title:'AI'}}]})
 await mount();await act(async()=>state().select('a'));await ai();await input(host.querySelector('select'),'document');await act(async()=>state().select('b'));expect((host.querySelector('select') as HTMLSelectElement).value).toBe('selection')
 await instruction('Update selected');await click(button('生成修改建议'));expect(edit.mock.calls[0][3]).toBe('b');expect(state().proposal?.items).toHaveLength(1)
 await click(button('在文中审阅修改（1）'));expect(state().doc.blocks[0].props).toMatchObject({title:'Alpha'})
})
it('handles disabled models, refreshed model state, empty input and API errors honestly',async()=>{
 vi.mocked(api.aiStatus).mockRejectedValueOnce(new Error('offline'));await mount();await ai();expect(button('生成修改建议').disabled).toBe(true)
 await act(async()=>window.dispatchEvent(new Event('ai-settings-changed')));expect(host.textContent).toContain('Test model')
 const edit=vi.spyOn(api,'aiEdit').mockRejectedValue(new Error('Provider failed'));await click(button('生成修改建议'));expect(edit).not.toHaveBeenCalled()
 await instruction('Edit');await click(button('生成修改建议'));expect(state().toast?.text).toBe('Provider failed');expect(button('生成修改建议').disabled).toBe(false)
})
it('local image natural-language intent opens confirmation without an AI call',async()=>{
 const edit=vi.spyOn(api,'aiEdit');await mount();await ai();await instruction('把图片保存到素材库');await click(host.querySelector('[data-testid="ai-image-library-command"]'))
 expect(host.querySelector('[role="dialog"]')).not.toBeNull();expect(edit).not.toHaveBeenCalled();await click(host.querySelector('[role="dialog"] button.close'));expect(host.querySelector('[role="dialog"]')).toBeNull()
 await click(host.querySelector('[data-testid="collect-article-images"]'));expect(host.querySelector('[role="dialog"]')).not.toBeNull()
})
for(const change of ['selection','document','unmount'] as const)it(`ignores delayed AI results after ${change}`,async()=>{
 let resolve!:(v:any)=>void;vi.spyOn(api,'aiEdit').mockImplementation(()=>new Promise(r=>{resolve=r}))
 await mount();await act(async()=>state().select('a'));await ai();await instruction('Edit');await click(button('生成修改建议'));expect(host.textContent).toContain('AI 思考中')
 if(change==='selection')await act(async()=>state().select('b'))
 if(change==='document')await act(async()=>state().updateProps('a',{title:'Manual'}))
 if(change==='unmount')await click(host.querySelector('[data-testid="tab-style"]'))
 await act(async()=>resolve({summary:'Late',ops:[{op:'update',id:'a',props:{title:'Late'}}]}));expect(state().proposal).toBeNull();expect(state().doc.blocks[0].props).not.toMatchObject({title:'Late'})
})
it('automatic suggestion preference requests real mocked suggestions and reports failure',async()=>{
 await mount();await ai();const check=host.querySelector('input[type="checkbox"]')!;await click(check)
 await act(async()=>{await vi.advanceTimersByTimeAsync(1600)});expect(api.aiSuggestInstruction).toHaveBeenCalled()
 await instruction('Explicit text');await click(check);expect(localStorage.getItem('xiumi:auto-input-suggestions')).toBe('off')
})
it('theme controls change tokens and save a named theme through the API',async()=>{
 vi.spyOn(window,'prompt').mockReturnValue('My theme');const save=vi.spyOn(api,'saveTheme').mockResolvedValue({} as any)
 await mount();await click(host.querySelector('[data-testid="tab-theme"]'));await click(host.querySelector('.theme-card'))
 for(const el of [...host.querySelectorAll('input[type="range"]')])await input(el,String(Number((el as HTMLInputElement).min)+Number((el as HTMLInputElement).step||1)))
 for(const el of [...host.querySelectorAll('input[type="color"]')])await input(el,'#123456')
 expect(state().doc.themeOverrides).toBeDefined();await click(button('重置'));expect(state().doc.themeOverrides).toBeUndefined()
 await click(button('全部模块样式跟随主题'));await click(button('保存为我的主题'));expect(save).toHaveBeenCalled();expect(state().doc.themeId).toMatch(/^custom-/)
})
it('reference panel validates sparse HTML, handles fetch errors, and applies a generated theme',async()=>{
 const fetch=vi.spyOn(api,'fetchReference').mockRejectedValue(new Error('Fetch failed'));vi.spyOn(api,'saveTheme').mockResolvedValue({} as any);vi.spyOn(window,'prompt').mockReturnValue('Reference')
 await mount();await click(host.querySelector('[data-testid="tab-reference"]'));await click(host.querySelector('input[type="checkbox"]'));await input(host.querySelector('textarea'),'<p>small</p>');await click(button('分析粘贴内容'));expect(state().toast?.kind).toBe('error')
 await input(host.querySelector('input:not([type="checkbox"])'),'https://example.test/article');await click(button('抓取并分析'));expect(fetch).toHaveBeenCalled();expect(state().toast?.text).toBe('Fetch failed')
 await input(host.querySelector('textarea'),'<h1 style="font-size:32px;color:#aa1133">Title</h1><p style="font-size:16px;color:#111111;line-height:1.8">Body</p><p style="font-size:14px;color:#333333">More</p><div style="padding:24px;border-radius:4px">Card</div>');await click(button('分析粘贴内容'));expect(host.querySelector('.report')).not.toBeNull();await click(button('保存并应用为新主题'));expect(api.saveTheme).toHaveBeenCalled()
})

it('rule actions propose without mutating the article and model settings remain reachable',async()=>{
 await mount();await ai();const original=state().doc;const event=vi.fn();window.addEventListener('open-ai-settings',event)
 await click(button('切换'));expect(event).toHaveBeenCalled();window.removeEventListener('open-ai-settings',event)
 for(const action of [...host.querySelectorAll('.quick-grid button')]){await click(action);expect(state().proposal).not.toBeNull();expect(state().doc).toBe(original)}
})
it('suggestion errors are visible and do not block explicit instructions',async()=>{
 vi.mocked(api.aiSuggestInstruction).mockRejectedValue(new Error('no suggestion'));await mount();await ai();await click(host.querySelector('input[type="checkbox"]'))
 await act(async()=>{await vi.advanceTimersByTimeAsync(32000)});expect(host.textContent).toContain('自动建议暂不可用');await instruction('Manual request');expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Manual request')
})

it('multi-selection AI sends the complete selection and malformed output remains an empty review',async()=>{
 const edit=vi.spyOn(api,'aiEdit').mockResolvedValue({ops:'invalid'} as any);await mount();await act(async()=>{state().select('a');state().select('b',{toggle:true})});await ai();expect(host.textContent).toContain('已选 2 个模块');await instruction('Edit both');await click(button('生成修改建议'));expect(edit.mock.calls[0][3]).toEqual(['a','b']);expect(state().proposal).toMatchObject({summary:'AI 修改建议',items:[]})
})
it('cover entry shows the existing cover and can open/close the real designer',async()=>{
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillRect:vi.fn()} as any)
 state().setDocFields({cover:{src:'/media/cover.png'}});await mount();expect(host.querySelector('.cover-preview')?.getAttribute('src')).toContain('cover.png')
 await click([...host.querySelectorAll('button')].find(b=>b.textContent?.includes('设计封面'))!);expect(host.querySelector('[role="dialog"]')).not.toBeNull();await click(host.querySelector('[role="dialog"] button.close'));expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('canceling theme naming performs no save',async()=>{
 vi.spyOn(window,'prompt').mockReturnValue(null);const save=vi.spyOn(api,'saveTheme');await mount();await click(host.querySelector('[data-testid="tab-theme"]'));await click(button('保存为我的主题'));expect(save).not.toHaveBeenCalled()
})

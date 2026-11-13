// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {ArticleImageImport} from '../../src/editor/ArticleImageImport'
import {useStore,emptyDoc} from '../../src/editor/store'
import {createBlock} from '../../src/core/blocks'
import {api} from '../../src/editor/api'
vi.mock('../../src/editor/api',()=>({api:{importArticleImages:vi.fn()}}))
const initial=useStore.getState(),close=vi.fn();let host:HTMLDivElement,root:Root
const urls=['https://img.xiumi.us/one.png','https://img.xiumi.us/two.png']
async function render(empty=false,scope=false){const block=createBlock('html',{html:empty?'<p>no image</p>':urls.map(u=>`<img src="${u}">`).join('')});const doc={...emptyDoc(),blocks:[block]};useStore.setState({doc});await act(async()=>root.render(<ArticleImageImport doc={doc} selectedId={scope?[block.id]:undefined} onClose={close}/>));return doc}
async function click(selector:string){await act(async()=>host.querySelector<HTMLElement>(selector)!.click())}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.resetAllMocks();useStore.setState(initial,true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('empty selection and deselection disable import; scope is explicit',async()=>{await render(true,true);expect(host.textContent).toContain('仅选中模块');expect(host.textContent).toContain('没有可收集');expect(host.querySelector('button.primary')?.hasAttribute('disabled')).toBe(true);await click('.modal-actions button:first-child');expect(close).toHaveBeenCalled()})
it('imports sequentially, reports existing and new items and never edits document',async()=>{
 const doc=await render();vi.mocked(api.importArticleImages).mockImplementation(async([url])=>[{url,status:url===urls[0]?'imported':'existing'}] as any);await click('input[type="checkbox"]');await click('input[type="checkbox"]');const changed=vi.fn();window.addEventListener('assets-changed',changed);await click('button.primary');expect(api.importArticleImages).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('新增 1 张，已存在 1 张');expect(host.querySelector('button.primary')?.hasAttribute('disabled')).toBe(true);expect(useStore.getState().doc).toBe(doc);expect(changed).toHaveBeenCalledTimes(2);window.removeEventListener('assets-changed',changed)
})
it('failed or missing responses remain retryable, while successful entries are skipped',async()=>{
 await render();vi.mocked(api.importArticleImages).mockResolvedValueOnce([{url:urls[0],status:'imported'}] as any).mockRejectedValueOnce(new Error('failed'));await click('button.primary');expect(host.textContent).toContain('请求失败');vi.mocked(api.importArticleImages).mockResolvedValueOnce([]);await click('button.primary');expect(host.textContent).toContain('服务器未确认');vi.mocked(api.importArticleImages).mockResolvedValueOnce([{url:urls[1],status:'existing'}] as any);await click('button.primary');expect(api.importArticleImages).toHaveBeenCalledTimes(4);expect(host.textContent).toContain('失败或未确认 0 张')
})
it('changed current document blocks import before any network operation',async()=>{await render();useStore.setState({doc:emptyDoc()});await click('button.primary');expect(api.importArticleImages).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toContain('文稿已变化')})
it('close stops remaining requests but honestly allows current transfer to finish',async()=>{
 const doc=await render();let finish!:(value:any)=>void;vi.mocked(api.importArticleImages).mockReturnValue(new Promise(r=>{finish=r}));await click('button.primary');expect(host.textContent).toContain('正在处理');await click('button.close');await act(async()=>finish([{url:urls[0],status:'imported'}]));expect(api.importArticleImages).toHaveBeenCalledTimes(1);expect(useStore.getState().doc).toBe(doc);expect(host.textContent).toContain('新增 0 张');expect(close).toHaveBeenCalledOnce()
})
it('unmount during transfer stops remaining batch and double-click starts only one loop',async()=>{
 await render();let finish!:(value:any)=>void;vi.mocked(api.importArticleImages).mockReturnValue(new Promise(r=>{finish=r}));await act(async()=>{const button=host.querySelector<HTMLElement>('button.primary')!;button.click();button.click()});expect(api.importArticleImages).toHaveBeenCalledTimes(1);await act(async()=>root.render(null));await act(async()=>finish([]));expect(api.importArticleImages).toHaveBeenCalledTimes(1)
})

// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {AiSettingsModal} from '../../src/editor/AiSettingsModal'
import {ArticleImportModal} from '../../src/editor/ArticleImport'
import {Workspace} from '../../src/editor/Workspace'
import {api} from '../../src/editor/api'
let host:HTMLDivElement,root:Root
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);localStorage.clear();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.spyOn(api,'aiSettings').mockResolvedValue({activeId:'a',profiles:[{id:'a',name:'Alpha',provider:'openai',baseUrl:'https://example.test',model:'one',apiKey:'',jsonMode:true},{id:'b',name:'Beta',provider:'openai',baseUrl:'https://example.test',model:'two',apiKey:'',jsonMode:true}]} as any)})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear()})
it('separates native profile editing from named activation radio and announces provider selection',async()=>{
 await act(async()=>root.render(<AiSettingsModal onClose={()=>{}}/>))
 const edit=host.querySelector<HTMLButtonElement>('button[aria-label="编辑模型：Beta"]');expect(edit).not.toBeNull();await act(async()=>edit!.click())
 expect((host.querySelector('[data-testid="ai-model"]') as HTMLInputElement).value).toBe('two')
 expect((host.querySelector('input[aria-label="设为当前模型：Alpha"]') as HTMLInputElement).checked).toBe(true)
 const group=host.querySelector('[role="group"][aria-label="接口类型"]')!;expect(group).not.toBeNull();expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe('OpenAI 兼容')
})
it('names URL and rich-text import inputs without giving editable content button semantics',async()=>{
 await act(async()=>root.render(<ArticleImportModal onClose={()=>{}}/>))
 expect(host.querySelector('[data-testid="article-url"]')?.getAttribute('aria-label')).toBe('文章链接')
 await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent?.startsWith('粘贴富文本'))!.click()})
 const paste=host.querySelector('[data-testid="article-paste"]')!;expect(paste.getAttribute('role')).toBe('textbox');expect(paste.getAttribute('aria-multiline')).toBe('true');expect(paste.getAttribute('aria-label')).toBe('粘贴文章富文本')
})
it('announces separator width and supports keyboard reset without removing keyboard resizing',async()=>{
 localStorage.setItem('xiumi-panel-widths',JSON.stringify({left:300}));await act(async()=>root.render(<Workspace><div/></Workspace>))
 const bar=host.querySelector('[data-testid="resizer-left"]')!;expect(bar.getAttribute('aria-valuenow')).toBe('300');expect(bar.getAttribute('aria-valuemin')).toBe('200');expect(Number(bar.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(300)
 await act(async()=>bar.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})))
 expect(JSON.parse(localStorage.getItem('xiumi-panel-widths')!)).toEqual({});expect(bar.getAttribute('tabindex')).toBe('0')
})

it('groups import mode buttons and exposes the actual selected state after parsing a real article',async()=>{
 vi.spyOn(api,'fetchArticle').mockResolvedValue({html:'<h1 id="activity-name">Article</h1><div id="js_content"><p>Safe article body.</p></div>'} as any);vi.spyOn(api,'fetchAssets').mockResolvedValue({})
 await act(async()=>root.render(<ArticleImportModal onClose={()=>{}}/>))
 const input=host.querySelector<HTMLInputElement>('[data-testid="article-url"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'https://example.test/article');input.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>host.querySelector<HTMLButtonElement>('.row.gap > button.primary')!.click())
 const group=host.querySelector('[role="group"][aria-label="导入方式"]')!;expect(group).not.toBeNull();expect(group.querySelector('[data-testid="mode-keep"]')?.getAttribute('aria-pressed')).toBe('true')
 await act(async()=>group.querySelector<HTMLButtonElement>('[data-testid="mode-relayout"]')!.click());expect(group.querySelector('[data-testid="mode-relayout"]')?.getAttribute('aria-pressed')).toBe('true');expect(group.querySelector('[data-testid="mode-keep"]')?.getAttribute('aria-pressed')).toBe('false')
})

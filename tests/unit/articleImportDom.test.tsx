// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {ArticleImportModal} from '../../src/editor/ArticleImport'
import {useStore,emptyDoc,saveBeforeLeave} from '../../src/editor/store'
import {api} from '../../src/editor/api'
vi.mock('../../src/editor/store',async original=>({...await original<typeof import('../../src/editor/store')>(),saveBeforeLeave:vi.fn().mockResolvedValue(true)}))
vi.mock('../../src/editor/ImportWizard',()=>({ImportWizard:({initialText,initialImages,onClose}:any)=><div data-testid="wizard"><output>{initialText}</output><span>{initialImages.length}</span><button onClick={onClose}>close-wizard</button></div>}))
vi.mock('../../src/editor/api',async original=>({...await original<typeof import('../../src/editor/api')>(),api:{fetchArticle:vi.fn(),fetchAssets:vi.fn(),saveTheme:vi.fn(),saveTemplate:vi.fn(),saveComponent:vi.fn()}}))
let host:HTMLDivElement,root:Root
const close=vi.fn(),initial=useStore.getState()
const html='<html><head><title>Imported title</title><meta name="description" content="digest"></head><body><h1 id="activity-name">Imported title</h1><div id="js_name">Account</div><div id="js_content"><h2>Section</h2><p>Article body content.</p></div></body></html>'
async function flush(){await act(async()=>{await new Promise(r=>setTimeout(r,0))})}
async function click(selector:string){const el=host.querySelector<HTMLElement>(selector)!;expect(el).toBeTruthy();await act(async()=>el.click())}
async function input(selector:string,value:string){const el=host.querySelector<HTMLInputElement>(selector)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})}
async function fetched(source=html){vi.mocked(api.fetchArticle).mockResolvedValue({html:source} as any);await input('[data-testid="article-url"]','https://example.com/article');await click('.row.gap > button.primary');await flush()}
beforeEach(async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.resetAllMocks();useStore.setState({...initial,doc:emptyDoc()},true)
 vi.mocked(saveBeforeLeave).mockResolvedValue(true);vi.mocked(api.fetchAssets).mockResolvedValue({});vi.mocked(api.saveTemplate).mockResolvedValue({} as any);vi.mocked(api.saveTheme).mockResolvedValue({} as any);vi.mocked(api.saveComponent).mockResolvedValue({duplicate:false} as any)
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<ArticleImportModal onClose={close}/>))
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('validates input, reports fetch failure and verification pages without touching the document',async()=>{
 const doc=useStore.getState().doc;expect(host.querySelector('button.primary')?.hasAttribute('disabled')).toBe(true)
 vi.mocked(api.fetchArticle).mockRejectedValueOnce(new Error('network failed'));await input('[data-testid="article-url"]','https://example.com/a');await click('button.primary');expect(useStore.getState().toast?.text).toContain('network failed')
 vi.mocked(api.fetchArticle).mockResolvedValueOnce({html:'<p>verify</p>'} as any);await act(async()=>host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(useStore.getState().toast?.text).toContain('验证页面');expect(useStore.getState().doc).toBe(doc)
})
it('extracts a genuine article and imports only after authorization, saving template and new draft',async()=>{
 const doc=useStore.getState().doc;await fetched();expect(host.querySelector('.article-preview')?.textContent).toContain('Article body')
 expect(host.querySelector('[data-testid="article-import"]')?.hasAttribute('disabled')).toBe(true);await click('[data-testid="article-authorized"]');await click('[data-testid="article-import"]')
 expect(useStore.getState().doc.id).not.toBe(doc.id);expect(useStore.getState().doc.title).toBe('Imported title');expect(api.saveTemplate).toHaveBeenCalled();expect(saveBeforeLeave).toHaveBeenCalledTimes(2);expect(close).toHaveBeenCalledOnce()
})
it('preserves original when pre-navigation save fails and surfaces failed template writes',async()=>{
 const doc=useStore.getState().doc;await fetched();await click('[data-testid="article-authorized"]');vi.mocked(api.saveTemplate).mockRejectedValueOnce(new Error('template failed'));await click('[data-testid="article-import"]');expect(useStore.getState().toast?.text).toContain('template failed');expect(useStore.getState().doc).toBe(doc)
 vi.mocked(saveBeforeLeave).mockResolvedValueOnce(false);await click('[data-testid="article-import"]');expect(useStore.getState().doc).toBe(doc);expect(close).not.toHaveBeenCalled()
})
it('can reselect source, rename, opt out of template and cancel',async()=>{
 await fetched();await input('.article-options > label input','Custom title');await input('.article-options > input','Custom template');await click('[data-testid="source-original"]');await click('.article-options label.check input');await click('[data-testid="article-authorized"]');await click('[data-testid="article-import"]');expect(api.saveTemplate).not.toHaveBeenCalled();expect(useStore.getState().doc.title).toBe('Custom title')
})
it('paste uses real extraction; empty HTML reports error and plain text stays native',async()=>{
 await click('nav button:nth-child(2)');const paste=host.querySelector('[data-testid="article-paste"]')!
 const send=async(value:string)=>{const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=>value}});await act(async()=>paste.dispatchEvent(event));return event}
 expect((await send('')).defaultPrevented).toBe(false);await send('<section></section>');expect(useStore.getState().toast?.kind).toBe('error')
 await send('<h1>Pasted</h1><p>Real body</p>');expect(host.querySelector('.article-preview')?.textContent).toContain('Real body');await click('.article-options .hint .link');expect(host.querySelector('[data-testid="article-paste"]')).toBeTruthy()
})
it('relayout downloads images and passes local rewritten content to wizard',async()=>{
 const source=html.replace('</div></body>','<img src="https://img.xiumi.us/xmi/ua/photo.png"></div></body>');await fetched(source)
 vi.mocked(api.fetchAssets).mockResolvedValue({'https://img.xiumi.us/xmi/ua/photo.png':{id:'img',file:'local.jpg',name:'photo'}} as any)
 await click('[data-testid="mode-relayout"]');await click('[data-testid="article-authorized"]');await click('[data-testid="article-import"]')
 expect(host.querySelector('[data-testid="wizard"]')?.textContent).toContain('/media/local.jpg');expect(saveBeforeLeave).not.toHaveBeenCalled();await click('[data-testid="wizard"] button');expect(close).toHaveBeenCalled()
})
it('keep mode rehosts images, creates theme and components with duplicate counts',async()=>{
 const source=html.replace('</div></body>','<img src="https://img.xiumi.us/xmi/ua/photo.png"></div></body>');await fetched(source)
 vi.mocked(api.fetchAssets).mockResolvedValue({'https://img.xiumi.us/xmi/ua/photo.png':{id:'img',file:'local.jpg',name:'photo'}} as any)
 await act(async()=>{ const input=[...host.querySelectorAll<HTMLLabelElement>('.article-options label.check')].find(label=>label.textContent?.includes('提取配色'))!.querySelector('input')!;input.click() });await click('[data-testid="article-components"]');await click('[data-testid="article-authorized"]');vi.mocked(api.saveComponent).mockResolvedValueOnce({duplicate:true} as any)
 await click('[data-testid="article-import"]');expect(api.saveComponent).toHaveBeenCalled();expect(api.saveTheme).toHaveBeenCalled();expect(JSON.stringify(useStore.getState().doc.blocks)).toContain('/media/local.jpg')
})
it('image download errors remain honest and final save failure does not report completion',async()=>{
 await fetched(html.replace('</div></body>','<img src="https://img.xiumi.us/xmi/ua/photo.png"></div></body>'));await click('[data-testid="article-authorized"]');vi.mocked(api.fetchAssets).mockRejectedValue(new Error('asset unavailable'));await click('[data-testid="article-import"]');expect(useStore.getState().toast?.text).toContain('转存失败')
})
it('cancelled import must not replace a later document when image request resolves',async()=>{
 await fetched(html.replace('</div></body>','<img src="https://img.xiumi.us/xmi/ua/photo.png"></div></body>'));await click('[data-testid="article-authorized"]')
 let finish!:(value:any)=>void;vi.mocked(api.fetchAssets).mockReturnValue(new Promise(r=>{finish=r}));await click('[data-testid="article-import"]');await act(async()=>root.render(null));const later=emptyDoc();useStore.setState({doc:later});await act(async()=>finish({}));await flush();expect(useStore.getState().doc).toBe(later);expect(api.saveTemplate).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled()
})

it('a later edit while template save is pending prevents navigation but preserves the completed external write',async()=>{
 await fetched();await click('[data-testid="article-authorized"]');let finish!:(value:any)=>void;vi.mocked(api.saveTemplate).mockReturnValue(new Promise(r=>{finish=r}));await click('[data-testid="article-import"]');const later={...useStore.getState().doc,title:'Later manual edit'};useStore.setState({doc:later});await act(async()=>finish({}));expect(useStore.getState().doc).toBe(later);expect(close).not.toHaveBeenCalled();expect(useStore.getState().toast?.text).toContain('已开始')
})
it('closing invalidates in-flight fetch even when parent has not unmounted yet',async()=>{
 let finish!:(value:any)=>void;vi.mocked(api.fetchArticle).mockReturnValue(new Promise(r=>{finish=r}));await input('[data-testid="article-url"]','https://example.com/a');await click('button.primary');await click('button.close');await act(async()=>finish({html}));expect(host.querySelector('.article-preview')).toBeNull();expect(useStore.getState().toast?.text).toContain('可能仍会完成');expect(close).toHaveBeenCalledOnce()
})
it('same-document unmount while saving template cannot load even if no new draft was opened',async()=>{
 const doc=useStore.getState().doc;await fetched();await click('[data-testid="article-authorized"]');let finish!:(value:any)=>void;vi.mocked(api.saveTemplate).mockReturnValue(new Promise(r=>{finish=r}));await click('[data-testid="article-import"]');await act(async()=>root.render(null));await act(async()=>finish({}));expect(useStore.getState().doc).toBe(doc);expect(close).not.toHaveBeenCalled()
})
it('final save failure retains imported content without false completion',async()=>{
 await fetched();await click('[data-testid="article-authorized"]');vi.mocked(saveBeforeLeave).mockResolvedValueOnce(true).mockResolvedValueOnce(false);await click('[data-testid="article-import"]');expect(useStore.getState().doc.title).toBe('Imported title');expect(close).not.toHaveBeenCalled()
})
it('plain article relayout needs no download and keep mode remains selectable',async()=>{
 await fetched();await click('[data-testid="mode-relayout"]');await click('[data-testid="mode-keep"]');await click('[data-testid="mode-relayout"]');await click('[data-testid="article-authorized"]');await click('[data-testid="article-import"]');expect(api.fetchAssets).not.toHaveBeenCalled();expect(host.querySelector('[data-testid="wizard"]')).toBeTruthy()
})

it('fetching an empty document is rejected, and closing an idle dialog is immediate',async()=>{
 vi.mocked(api.fetchArticle).mockResolvedValue({html:'<html><body></body></html>'} as any);await input('[data-testid="article-url"]','https://example.com/empty');await click('button.primary');expect(useStore.getState().toast?.kind).toBe('error');await click('button.close');expect(close).toHaveBeenCalledOnce()
})
it('cover download success is preserved in the new draft and failure is nonfatal',async()=>{
 const source=html.replace('</head>','<meta property="og:image" content="https://example.com/cover.png"></head>');await fetched(source);await click('[data-testid="article-authorized"]')
 vi.mocked(api.fetchAssets).mockResolvedValue({'https://example.com/cover.png':{id:'cover',file:'cover.png',name:'Cover',width:400,height:300}} as any);await click('[data-testid="article-import"]');expect(useStore.getState().doc.cover?.src).toBe('/media/cover.png')
})
it('a failed cover download still permits an authorized import without invented cover',async()=>{
 await fetched(html.replace('</head>','<meta property="og:image" content="https://example.com/cover.png"></head>'));await click('[data-testid="article-authorized"]');vi.mocked(api.fetchAssets).mockRejectedValue(new Error('cover failed'));await click('[data-testid="article-import"]');expect(useStore.getState().doc.cover).toBeUndefined();expect(close).toHaveBeenCalled()
})
it('new components and blank title/template use safe fallback names',async()=>{
 await fetched('<html><body><p style="border:1px solid #333;padding:12px">Untitled article body with sufficient useful content for the component library.</p></body></html>');await input('.article-options > label input','');await input('.article-options > input','');await click('[data-testid="source-other"]');await click('[data-testid="article-components"]');await click('[data-testid="article-authorized"]');await click('[data-testid="article-import"]');expect(api.saveTemplate).toHaveBeenCalledWith('导入的推文模板',expect.anything(),expect.anything());expect(api.saveComponent).toHaveBeenCalled()
})
it('duplicate Enter during pending fetch does not start another request; changed doc prevents late preview',async()=>{
 let finish!:(value:any)=>void;vi.mocked(api.fetchArticle).mockReturnValue(new Promise(r=>{finish=r}));await input('[data-testid="article-url"]','https://example.com/a');const el=host.querySelector('input')!;await act(async()=>{el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))});expect(api.fetchArticle).toHaveBeenCalledTimes(1);useStore.setState({doc:emptyDoc()});await act(async()=>finish({html}));expect(host.querySelector('.article-preview')).toBeNull()
})

it('cancel during cover fetch prevents template save and document replacement',async()=>{
 const doc=useStore.getState().doc;await fetched(html.replace('</head>','<meta property="og:image" content="https://example.com/cover.png"></head>'));await click('[data-testid="article-authorized"]');let finish!:(value:any)=>void;vi.mocked(api.fetchAssets).mockReturnValue(new Promise(r=>{finish=r}));await click('[data-testid="article-import"]');await click('button.close');await act(async()=>finish({}));expect(api.saveTemplate).not.toHaveBeenCalled();expect(useStore.getState().doc).toBe(doc)
})
it('cancel during theme or component write stops remaining work, with honest partial-save notice',async()=>{
 const doc=useStore.getState().doc;await fetched();await act(async()=>[...host.querySelectorAll<HTMLLabelElement>('label.check')].find(x=>x.textContent?.includes('提取配色'))!.querySelector('input')!.click());await click('[data-testid="article-authorized"]');let finish!:(value:any)=>void;vi.mocked(api.saveTheme).mockReturnValue(new Promise(r=>{finish=r}));await click('[data-testid="article-import"]');await click('button.close');await act(async()=>finish({}));expect(api.saveTemplate).not.toHaveBeenCalled();expect(useStore.getState().doc).toBe(doc)
})
it('relayout keeps unmapped image URLs and tab navigation returns to URL mode',async()=>{
 await click('nav button:nth-child(2)');await click('nav button:first-child');await fetched(html.replace('</div></body>','<img src="https://img.xiumi.us/a.png"></div></body>'));await click('[data-testid="mode-relayout"]');await click('[data-testid="article-authorized"]');await click('[data-testid="article-import"]');expect(host.querySelector('[data-testid="wizard"]')?.textContent).toContain('https://img.xiumi.us/a.png')
})

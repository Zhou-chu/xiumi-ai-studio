// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { textToRich } from '../../src/core/richtext'
import { createBlock } from '../../src/core/blocks'
import { emptyDoc, useStore, type Proposal } from '../../src/editor/store'
import { InlineReview, ReviewBlock, ReviewHeading, ReviewDocumentEnd } from '../../src/editor/InlineReview'
vi.mock('../../src/editor/Toolbar', () => ({ PhonePreview: ({ html, onClose }: any) => <div role="dialog"><output>{html}</output><button onClick={onClose}>close-preview</button></div> }))
let host: HTMLDivElement, root: Root
const disconnect = vi.fn()
let resize: () => void
const initial = useStore.getState()
const frameFonts = (event: Event) => { const target = event.target; if (target instanceof HTMLIFrameElement && target.contentDocument) Object.defineProperty(target.contentDocument, 'fonts', { configurable:true, value:{ready:Promise.resolve()} }) }
const original = () => createBlock('html', { label: 'Original', html: '<h2>Original title</h2><p>Original paragraph</p>' })
function setup(ops: any[], blocks: any[] = [original()]) {
 const doc = { ...emptyDoc(), blocks }
 const proposal: Proposal = { base: doc, summary: 'Changes', errors: [], items: ops.map(op => ({ status: 'pending', op: typeof op === 'function' ? op(blocks) : op })) }
 useStore.setState({ doc, proposal })
 return { doc, proposal }
}
async function render(node: ReactNode) { await act(async () => { root.render(node) }) }
async function click(selector: string) { const el=host.querySelector<HTMLElement>(selector)!; expect(el).toBeTruthy(); await act(async()=>el.click()) }
beforeEach(() => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
 useStore.setState(initial, true)
 host=document.createElement('div'); document.body.append(host);root=createRoot(host)
 vi.stubGlobal('ResizeObserver', class { constructor(fn:()=>void){resize=fn} observe(){} disconnect=disconnect })
 vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(()=>fn(0),0))
 vi.stubGlobal('cancelAnimationFrame', clearTimeout)
 Object.defineProperty(Document.prototype,'fonts',{configurable:true,value:{ready:Promise.resolve()}})
 Element.prototype.scrollIntoView=vi.fn()
 document.addEventListener('load',frameFonts,true)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();document.removeEventListener('load',frameFonts,true);vi.unstubAllGlobals();vi.clearAllMocks()})
const update = (blocks:any[]) => ({ op:'update', id:blocks[0].id, props:{}, slots:{t0:'Suggested title'}, reason:'Clearer title' })
describe('visible module review DOM',()=>{
 it('keeps original DOM intact, renders a full sandboxed suggestion and accepts explicitly',async()=>{
  const {doc}=setup([update]);const before=JSON.stringify(doc)
  await render(<><ReviewBlock blockId={doc.blocks[0].id}><article data-original="true" dangerouslySetInnerHTML={{__html:doc.blocks[0].props.html}} /></ReviewBlock><InlineReview/></>)
  expect(host.querySelector('[data-review-original]')?.getAttribute('data-review-original')).toBe('0')
  const frame=host.querySelector('iframe')!
  expect(frame.srcdoc).toContain('Suggested title');expect(frame.srcdoc).toContain('Original paragraph')
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');expect(frame.srcdoc).toContain("script-src 'none'")
  expect(JSON.stringify(useStore.getState().doc)).toBe(before)
  Object.defineProperty(frame.contentDocument!.body,'scrollHeight',{value:460,configurable:true})
  await act(async()=>{frame.dispatchEvent(new Event('load'));resize();resize();await new Promise(r=>setTimeout(r,5))})
  expect(frame.style.height).toBe('460px')
  await click('[data-testid="accept-review"]')
  expect((useStore.getState().doc.blocks[0].props as { html: string }).html).toContain('Suggested title')
  expect(host.querySelector('[data-original]')?.innerHTML).toBe('<h2>Original title</h2><p>Original paragraph</p>')
  expect(disconnect).toHaveBeenCalled()
 })
 it('rejects without changing original, and review controls stop destructive keys/clicks',async()=>{
  const {doc}=setup([update]);const outside=vi.fn()
  await render(<div onClick={outside} onKeyDown={outside}><ReviewBlock blockId={doc.blocks[0].id}><p>original</p></ReviewBlock></div>)
  const button=host.querySelector('button')!
  await act(async()=>{button.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));button.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));button.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true}))})
  expect(outside).not.toHaveBeenCalled()
  await click('[data-testid="reject-review"]');expect(useStore.getState().doc).toBe(doc);expect(useStore.getState().proposal?.items[0].status).toBe('rejected')
 })
 it('shows removal, movement, metadata and theme proposals with honest full-module previews',async()=>{
  const {doc}=setup([(b:any[])=>({op:'remove',id:b[0].id}),(b:any[])=>({op:'move',id:b[0].id,to:0}),{op:'setMeta',title:'New title'},{op:'setTheme',themeId:emptyDoc().themeId}])
  await render(<><ReviewHeading><h1>original heading</h1></ReviewHeading><ReviewBlock blockId={doc.blocks[0].id}>original module</ReviewBlock></>)
  expect(host.querySelectorAll('[data-review-index]')).toHaveLength(4)
  expect(host.querySelector('[data-testid="review-item-0"] iframe')).toBeNull()
  expect(host.querySelector('[data-testid="review-suggestion-2"]')?.getAttribute('srcdoc')).toContain('New title')
  expect(host.querySelector('[data-testid="review-original-0"]')?.getAttribute('data-review-original')).toBe('0,1')
 })
 it('renders insertions at their real boundary and missing targets disabled at document end',async()=>{
  const fresh=createBlock('paragraph',{content:textToRich('new')})
  const {doc}=setup([{op:'insert',index:0,block:fresh},{op:'insert',index:1,block:createBlock('paragraph',{content:textToRich('end')})},update])
  await render(<><ReviewBlock blockId={doc.blocks[0].id}>original</ReviewBlock><ReviewDocumentEnd/></>)
  expect(host.querySelectorAll('[data-review-index]')).toHaveLength(3)
  await act(async()=>useStore.setState({doc:{...doc,blocks:[]}}))
  expect(host.querySelector('[data-testid="review-item-2"] [data-testid="accept-review"]')?.hasAttribute('disabled')).toBe(true)
  expect(host.querySelector('[data-testid="review-item-2"] [role="status"]')).toBeTruthy()
 })
 it('keeps child proposals out of the parent original DOM',async()=>{
  const child=createBlock('paragraph',{content:textToRich('child')});const box=createBlock('box',{children:[child]})
  setup([{op:'update',id:box.id,props:{title:"New box title"}},{op:'update',id:child.id,props:{content:'new child'}}],[box])
  await render(<ReviewBlock blockId={box.id}><ReviewBlock blockId={child.id} inBox><p>child</p></ReviewBlock></ReviewBlock>)
  expect(host.querySelector('[data-testid="review-original-0"] iframe')).toBeNull()
  expect(host.querySelectorAll('iframe')).toHaveLength(2)
 })
 it('supports locate, Escape, batch preview, batch actions and ending review',async()=>{
  const {doc}=setup([update]);useStore.setState({proposal:{...useStore.getState().proposal!,errors:['out of scope']}})
  await render(<><InlineReview/><ReviewBlock blockId={doc.blocks[0].id}>original</ReviewBlock></>)
  await click('[data-testid="review-open"]');await act(async()=>{await new Promise(r=>setTimeout(r,5))});expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  const details=host.querySelector('details')!;details.open=true
  await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(details.open).toBe(false);expect(document.activeElement).toBe(details.querySelector('summary'))
  await click('.review-batch-menu button');expect(host.querySelector('[role="dialog"]')).toBeTruthy()
  await click('[role="dialog"] button');expect(host.querySelector('[role="dialog"]')).toBeNull()
  await click('[data-testid="accept-all"]');expect(useStore.getState().proposal?.items[0].status).toBe('accepted')
  await click('.review-summary-bar > button:last-of-type');expect(useStore.getState().proposal).toBeNull()
 })
 it('renders no controls without proposal and batch rejection preserves content',async()=>{
  await render(<><InlineReview/><ReviewDocumentEnd/><ReviewHeading>heading</ReviewHeading></>);expect(host.querySelector('button')).toBeNull()
  const {doc}=setup([update]);await render(<InlineReview/>);await click('.review-batch-menu button:nth-child(2)');expect(useStore.getState().doc).toBe(doc)
 })
})

it('all review wrapper variants stop shell click, pointer and destructive-key propagation',async()=>{
 const {doc}=setup([{op:'setMeta',title:'meta'},{op:'insert',index:0,block:createBlock('divider')},{op:'insert',index:1,block:createBlock('divider')}]);const outer=vi.fn()
 await render(<div onClick={outer} onPointerDown={outer} onKeyDown={outer}><ReviewHeading>heading</ReviewHeading><ReviewBlock blockId={doc.blocks[0].id}>original</ReviewBlock><ReviewDocumentEnd/></div>)
 await act(async()=>{for(const item of host.querySelectorAll('[data-review-index]')){item.dispatchEvent(new MouseEvent('click',{bubbles:true}));item.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true}));item.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}))}})
 expect(outer).not.toHaveBeenCalled()
})

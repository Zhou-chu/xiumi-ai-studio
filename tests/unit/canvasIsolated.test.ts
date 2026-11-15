// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createBlock } from '../../src/core/blocks';
import type { Block } from '../../src/core/types';
const h = vi.hoisted(() => ({ state: {} as any, subscriptions: new Set<(next: { doc: { id: string } }, previous: { doc: { id: string } }) => void>(), over: false, dragging: false, save: vi.fn(), collect: vi.fn(), inline: null as null | ((html: string) => boolean), off: vi.fn(), split: vi.fn(), swap:vi.fn(), outside:vi.fn(()=>{throw Error('Unexpected Canvas network')}), rich: [] as any[] }));
vi.mock('../../src/editor/store', () => ({ useStore: Object.assign((fn: any) => fn(h.state), { getState: () => h.state, subscribe: (listener: Parameters<typeof h.subscriptions.add>[0]) => { h.subscriptions.add(listener); return () => { h.subscriptions.delete(listener) } } }) }));
vi.mock('@dnd-kit/core', () => ({ useDroppable: () => ({ setNodeRef: vi.fn(), isOver: h.over }) }));
vi.mock('@dnd-kit/sortable', () => ({ SortableContext: ({ children }: {
        children: ReactNode;
    }) => children, verticalListSortingStrategy: () => null, useSortable: () => ({ attributes: { 'data-sortable': 'true' }, listeners: {}, setNodeRef: vi.fn(), setActivatorNodeRef: vi.fn(), transform: null, transition: undefined, isDragging: h.dragging, isOver: h.over }) }));
vi.mock('../../src/core/wxImport', () => ({ splitHtmlBlock: h.split }));
vi.mock('../../src/core/photos',async original=>({...await original<typeof import('../../src/core/photos')>(),swapPhotos:h.swap}));
vi.mock('../../src/editor/api', () => ({ api: { saveTemplate: h.save } }));
vi.mock('../../src/editor/componentActions', () => ({ openCollect: h.collect, setInlineTarget: (fn: any) => { h.inline = fn; return h.off; } }));
vi.mock('../../src/editor/InlineReview', () => ({
  ReviewProvider: ({ children }: { children: ReactNode }) => children,
  ReviewBlock: ({ children }: { children: ReactNode }) => children,
  ReviewSlot: () => null,
}));
vi.mock('../../src/editor/ImageResize', () => ({ ImageResize: () => null }));
vi.mock('../../src/editor/HtmlTypographyControls', () => ({ HtmlTypographyControls: (p: any) => createElement('button', { 'data-testid':'typography-commit', onClick:p.onCommit }, 'Apply typography') }));
vi.mock('../../src/editor/BlockTextEditor', () => ({ BlockTextEditor: (p: any) => createElement('div',null,createElement('button',{'data-testid':'text-change',onClick:()=>p.onChange({title:'Typed'},'title')}),createElement('button',{'data-testid':'text-done',onClick:p.onDone})) }));
vi.mock('../../src/editor/RichEditor', () => ({ RichEditor: (p: any) => { h.rich.push(p); return createElement('div',null,createElement('button',{'data-testid':'rich-change',onClick:()=>p.onChange({type:'doc',content:[]})}),createElement('button',{'data-testid':'rich-done',onClick:p.onDone})); } }));
import { Canvas, photoTarget, shownRatio, slotTarget } from '../../src/editor/Canvas';
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(createElement(Canvas)));
const mount = async (blocks: Block[] = []) => { h.state.doc = { ...h.state.doc, blocks }; await render(); };
const event = async (target: EventTarget | null, ev: Event) => { expect(target).toBeTruthy(); await act(async () => { target!.dispatchEvent(ev); }); };
const click = (el: EventTarget | null, mods: MouseEventInit = {}) => event(el, new MouseEvent('click', { bubbles: true, cancelable: true, ...mods }));
const key = (el: EventTarget | null, k: string, extra: KeyboardEventInit = {}) => event(el, new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const blockEl = (b: Block) => host.querySelector(`[data-block-id="${b.id}"]`)!;
const selected = async (b: Block, blocks: Block[] = [b]) => { h.state.selectedId = b.id; h.state.selectedIds = [b.id]; await mount(blocks); };
const editing = async (b: Block) => { h.state.selectedId = b.id; h.state.selectedIds = [b.id]; h.state.editingId = b.id; await mount([b]); };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch',h.outside); h.swap.mockImplementation(()=>{throw Error('Unconfigured Canvas photo swap')}); h.subscriptions.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); h.over = false; h.dragging = false; h.rich = []; h.inline = null; h.save.mockRejectedValue(Error('Unexpected saveTemplate call')); h.split.mockReturnValue(null); h.state = { doc: { id: 'doc', title: 'Title', author: 'Author', digest:'', createdAt:1, updatedAt:1, themeId: 'tsinghua-purple', blocks: [] }, selectedId: null, selectedIds: [], editingId: null, pickingId: null, select: vi.fn(), setEditing: vi.fn(), setPicking: vi.fn(), updateProps: vi.fn(), removeBlock: vi.fn(), replaceBlock: vi.fn(), duplicateBlock: vi.fn(), moveBlock: vi.fn(), moveBlockTo: vi.fn(), notify: vi.fn(), commit: vi.fn(), undo: vi.fn() }; host = document.createElement('div'); document.body.append(host); root = createRoot(host); Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() }); vi.spyOn(window, 'prompt').mockReturnValue('Saved'); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); if (scrollDescriptor)
    Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor);
else
    delete (Element.prototype as any).scrollIntoView; try{expect(h.outside).not.toHaveBeenCalled()}finally{vi.restoreAllMocks(); vi.unstubAllGlobals()} });
it('dispatches ordinary, Ctrl and Cmd selection but protects interactive descendants and resize handles', async () => { const b = createBlock('html', { html: '<p>Body</p><input><textarea></textarea><select><option>A</option></select><button>Action</button><span data-image-handle>Handle</span><div contenteditable="true">Editable</div>' }); await mount([b]); await click(blockEl(b)); await click(blockEl(b), { ctrlKey: true }); await click(blockEl(b), { metaKey: true }); expect(h.state.select.mock.calls).toEqual([[b.id, { toggle: false }], [b.id, { toggle: true }], [b.id, { toggle: true }]]); h.state.select.mockClear(); for (const el of blockEl(b).querySelectorAll('.block-html input,.block-html textarea,.block-html select,.block-html button,.block-html [contenteditable]'))
    await click(el, { ctrlKey: true }); expect(h.state.select).not.toHaveBeenCalled(); await click(host.querySelector('.canvas-scroll')); expect(h.state.select).toHaveBeenCalledWith(null); });
it('toolbar dispatches position, duplicate, collect, delete and editing callbacks without mutating state', async () => { const a = createBlock('heading'), b = createBlock('heading'); await selected(b, [a, b]); const toolbar = blockEl(b).querySelector('.block-toolbar')!; const buttons = toolbar.querySelectorAll('button'); await click(buttons[1]); await click(buttons[2]); expect(h.state.moveBlock.mock.calls).toEqual([[b.id, 0], [b.id, 2]]); await click(buttons[3]); expect(h.state.setEditing).toHaveBeenCalledWith(b.id); await click(buttons[4]); expect(h.state.duplicateBlock).toHaveBeenCalledWith(b.id); await click(toolbar.querySelector('[data-testid="collect-block"]')); expect(h.collect).toHaveBeenCalledWith({ block: b, via: 'block' }); await click(toolbar.querySelector('.danger')); expect(h.state.removeBlock).toHaveBeenCalledWith(b.id); expect(h.state.doc.blocks).toEqual([a, b]); });
it('renders DnD feedback and nested move-out with exact parent placement', async () => { h.over = true; h.dragging = true; const child = createBlock('heading'), box = createBlock('box', { children: [child] }), empty = createBlock('box', { children: [] }); h.state.selectedId = child.id; h.state.selectedIds = [child.id]; await mount([empty, box]); expect(host.querySelector('.block.over')?.getAttribute('style')).toContain('opacity: 0.4'); expect(host.querySelector('.drop-end.over')).toBeTruthy(); expect(host.querySelector('.box-drop.empty')).toBeTruthy(); await click(host.querySelector('[data-testid="move-out"]')); expect(h.state.moveBlockTo).toHaveBeenCalledWith(child.id, null, 2); });
it('split dispatches no-op notice or exact replacement blocks and picker activation', async () => { const b = createBlock('html', { html: '<p>A</p><p>B</p>' }); await selected(b); await click(host.querySelector('[data-testid="split-block"]')); expect(h.state.notify).toHaveBeenCalled(); expect(h.state.replaceBlock).not.toHaveBeenCalled(); const parts = [createBlock('heading'), createBlock('paragraph')]; h.split.mockReturnValue(parts); await click(host.querySelector('[data-testid="split-block"]')); expect(h.state.replaceBlock).toHaveBeenCalledWith(b.id, parts); await click(host.querySelector('[data-testid="pick-fragment"]')); expect(h.state.setPicking).toHaveBeenCalledWith(b.id); });
it('template cancellation sends nothing; successful save uses exact block and publishes refresh', async () => { const b = createBlock('heading'); await selected(b); const button = blockEl(b).querySelector('.block-toolbar button:nth-last-child(2)'); vi.mocked(window.prompt).mockReturnValueOnce(null); await click(button); expect(h.save).not.toHaveBeenCalled(); h.save.mockResolvedValueOnce({}); const refresh = vi.fn(); window.addEventListener('templates-changed', refresh); await click(button); expect(h.save).toHaveBeenCalledWith('Saved', [b], h.state.doc); expect(refresh).toHaveBeenCalledTimes(1); window.removeEventListener('templates-changed', refresh); });
it.each(['paragraph', 'card', 'imageText'] as const)('rich %s child forwards content and done without executing a rich editor workflow', async (type) => { const b = createBlock(type); await editing(b); await click(host.querySelector('[data-testid="rich-change"]')); expect(h.state.updateProps).toHaveBeenCalledWith(b.id, { content: { type: 'doc', content: [] } }, `${b.id}:content`); await click(host.querySelector('[data-testid="rich-done"]')); expect(h.state.setEditing).toHaveBeenCalledWith(null); if (type === 'imageText')
    expect(h.rich.at(-1).fontSize).toBe(14); });
it('HTML commits sanitized edits, preserves text selection and exits editing on Escape', async () => { const b = createBlock('html', { html: '<p>Before</p>' }); await editing(b); const editor = host.querySelector('.html-editor')!; await click(editor.querySelector('p'), { ctrlKey: true }); expect(h.state.select).not.toHaveBeenCalled(); editor.innerHTML = '<p>After</p><script>bad()</script>'; await click(host.querySelector('[data-testid="typography-commit"]')); expect(h.state.updateProps).toHaveBeenCalledWith(b.id, { html: '<p>After</p>' }); const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); await event(editor, e); expect(h.state.setEditing).toHaveBeenCalledWith(null); });
it('HTML media deletion selects whole textless wrappers but never deletes a textual wrapper', async () => { const b = createBlock('html', { html: '<section><img src="https://example.test/a.png"></section><section><svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg></section><p>Text</p>' }); await editing(b); const editor = host.querySelector('.html-editor')!; await click(editor.querySelector('img')); expect(host.querySelector('[data-testid="delete-picked"]')).toBeTruthy(); await key(editor, 'Delete'); expect(editor.querySelector('img')).toBeNull(); expect(h.state.updateProps.mock.lastCall![1].html).toContain('Text'); await click(editor.querySelector('path')); await key(editor, 'a'); expect(host.querySelector('[data-testid="delete-picked"]')).toBeNull(); await click(editor.querySelector('p')); expect(host.querySelector('[data-testid="delete-picked"]')).toBeNull(); await event(editor, new FocusEvent('focusout', { bubbles: true })); expect(h.state.select).not.toHaveBeenCalled(); });
it('inline insertion requires a live saved caret and reports its scoped HTML update', async () => { const b = createBlock('html', { html: '<p>Anchor</p><p>Next</p>' }); await editing(b); expect(h.inline?.('<p>Ignored</p>')).toBe(false); const text = host.querySelector('.html-editor p')!.firstChild!; const range = document.createRange(); range.setStart(text, 2); range.collapse(true); document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); await event(document, new Event('selectionchange')); let inserted = false; await act(async () => { inserted = h.inline!('<p>Inserted</p>'); }); expect(inserted).toBe(true); expect(h.state.updateProps.mock.lastCall![1].html).toContain('Inserted'); expect(h.state.doc.blocks).toEqual([b]); h.state.editingId = null; await render(); expect(h.off).toHaveBeenCalled(); });
it('fragment cancel and empty navigation never fabricate a collection', async () => { const b = createBlock('html', { html: '' }); h.state.pickingId = b.id; await mount([b]); expect((host.querySelector('[data-testid="pick-collect"]') as HTMLButtonElement).disabled).toBe(true); await click(host.querySelector('[data-testid="pick-cancel"]')); expect(h.state.setPicking).toHaveBeenCalledWith(null); expect(h.collect).not.toHaveBeenCalled(); });
it('zoom controls persist only UI preferences, clamp bounds and leave document untouched', async () => { localStorage.setItem('xiumi-canvas-zoom', '1.4'); await mount(); const doc = h.state.doc; await click(host.querySelector('[data-testid="zoom-in"]')); expect(host.querySelector('[data-testid="zoom-reset"]')?.textContent).toBe('150%'); await key(window, '-', { ctrlKey: true }); await key(window, '+', { metaKey: true }); await key(window, '0', { ctrlKey: true }); expect(host.querySelector('.phone')?.getAttribute('data-zoom')).toBe('1'); await event(window, new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true })); expect(Number(host.querySelector('.phone')?.getAttribute('data-zoom'))).toBeGreaterThan(1); await event(window, new WheelEvent('wheel', { deltaY: 100 })); await key(window, 'x', { ctrlKey: true }); await key(window, '+', { ctrlKey: true, altKey: true }); await click(host.querySelector('[data-testid="zoom-out"]')); await click(host.querySelector('[data-testid="zoom-reset"]')); expect(h.state.doc).toBe(doc); expect(h.state.commit).not.toHaveBeenCalled(); });
it('background and nested SVG media selection keeps text-containing blocks intact',async()=>{
    const b=createBlock('html',{html:'<section style="background-image:url(https://example.test/bg.jpg)"></section><svg><svg><path d="M0 0L1 1"/></svg></svg><section><img src="https://example.test/photo.png">Text retained</section>'});await editing(b);
    const editor=host.querySelector('.html-editor')!;await click(editor.querySelector('[style]'));expect(editor.querySelector('.media-picked')).toBeTruthy();await key(editor,'Backspace');expect(editor.innerHTML).not.toContain('background-image');
    await click(editor.querySelector('path'));expect(editor.querySelector('svg')?.classList.contains('media-picked')).toBe(true);
    await click(editor.querySelector('img'));await key(editor,'Delete');expect(editor.textContent).toContain('Text retained');
    await click(editor);expect(host.querySelector('[data-testid="delete-picked"]')).toBeNull();
});
it('unchanged HTML completion is a no-op and pointerdown completion does not lose the caret',async()=>{
    const b=createBlock('html',{html:'<p>Unchanged</p>'});await editing(b);
    const ev=new MouseEvent('mousedown',{bubbles:true,cancelable:true});await event(host.querySelector('.rich-toolbar .done'),ev);expect(ev.defaultPrevented).toBe(true);
    await click(host.querySelector('.rich-toolbar .done'));expect(h.state.updateProps).not.toHaveBeenCalled();expect(h.state.setEditing).toHaveBeenCalledWith(null);
});
it('inline insertion rejects an empty fragment and a detached caret without document side effects',async()=>{
    const b=createBlock('html',{html:'<p>Anchor</p>'});await editing(b);const p=host.querySelector('.html-editor p')!;const range=document.createRange();range.selectNodeContents(p);range.collapse(true);document.getSelection()!.addRange(range);await event(document,new Event('selectionchange'));
    expect(h.inline!('')).toBe(false);expect(h.state.updateProps).not.toHaveBeenCalled();p.remove();expect(h.inline!('<p>Late</p>')).toBe(false);
});
it('empty title/author fallbacks and unrelated dragover remain safe',async()=>{
    h.state.doc={...h.state.doc,title:'',author:''};await mount();expect(host.querySelector('.wx-title')?.textContent).not.toBe('');expect(host.querySelector('.wx-meta')?.textContent).not.toBe('');
    const ev=new MouseEvent('dragover',{bubbles:true,cancelable:true});Object.defineProperty(ev,'dataTransfer',{value:{types:[]}});await event(host.querySelector('.canvas-scroll'),ev);expect(ev.defaultPrevented).toBe(false);expect(h.state.commit).not.toHaveBeenCalled();
});

it('explicit multi mode exposes pressed state, toggles via buttons, and prevents double-click editing', async () => {
  const a = createBlock('heading'), b = createBlock('paragraph')
  await selected(a, [a, b])
  await click(host.querySelector('[data-testid=multi-select-mode]'))
  const toggles = host.querySelectorAll('[data-testid=toggle-block-selection]')
  expect(toggles).toHaveLength(2)
  expect([...toggles].map(el => el.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  await click(toggles[1])
  await event(blockEl(b), new MouseEvent('dblclick', { bubbles: true }))
  expect(h.state.select).toHaveBeenCalledExactlyOnceWith(b.id, { toggle: true })
  expect(h.state.setEditing).not.toHaveBeenCalled()
  expect(host.querySelector('.block-toolbar')).toBeNull()
  await click(host.querySelector('[data-testid=multi-select-mode]'))
  expect(blockEl(a).querySelector('.block-toolbar')).not.toBeNull()
})

it('commits a dirty HTML editor on blur and unregisters its caret on a normal project switch', async () => {
  const original = createBlock('html', { html: '<p>Original</p>' })
  await editing(original)
  const editor = host.querySelector<HTMLElement>('.html-editor')!
  editor.innerHTML = '<p>Changed by author</p>'
  await event(editor, new FocusEvent('focusout', { bubbles: true }))
  expect(h.state.updateProps).toHaveBeenCalledExactlyOnceWith(original.id, { html: '<p>Changed by author</p>' })
  expect(typeof h.inline).toBe('function')
  h.state.editingId = null
  h.state.selectedId = null
  h.state.selectedIds = []
  h.state.doc = { ...h.state.doc, id: 'second-doc', title: 'Second project' }
  const next = createBlock('html', { html: '<p>New project text</p>' })
  await mount([next])
  expect(h.off).toHaveBeenCalledOnce()
  expect(host.querySelector('.wx-title')?.textContent).toBe('Second project')
  expect(blockEl(next).querySelector('.block-html')?.textContent).toBe('New project text')
  expect(host.querySelector('.html-editor')).toBeNull()
  expect(h.state.updateProps).toHaveBeenCalledTimes(1)
})
it('template save failure reports an error without publishing a successful refresh', async () => {
  const b = createBlock('heading')
  await selected(b)
  h.save.mockRejectedValueOnce(Error('Template could not be saved'))
  const refresh = vi.fn()
  window.addEventListener('templates-changed', refresh)
  try {
    await click(blockEl(b).querySelector('[title="收藏为模板"]'))
    expect(h.save).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
    expect(h.state.notify).toHaveBeenCalledWith('Template could not be saved', 'error')
  } finally { window.removeEventListener('templates-changed', refresh) }
})

function deferredTemplate() {
  let resolve!: () => void, reject!: (error: unknown) => void
  const promise = new Promise<void>((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}
const templateButton = (block: Block) => blockEl(block).querySelector<HTMLButtonElement>('[title="收藏为模板"]')!

it('locks two same-tick clicks, captures the source, and refreshes exactly once', async () => {
  const block = createBlock('heading'); await selected(block)
  const doc = h.state.doc, request = deferredTemplate()
  h.save.mockReturnValue(request.promise)
  const refresh = vi.fn(); window.addEventListener('templates-changed', refresh)
  try {
    const button = templateButton(block)
    await act(async () => { button.click(); button.click() })
    expect(window.prompt).toHaveBeenCalledOnce()
    expect(h.save).toHaveBeenCalledExactlyOnceWith('Saved', [block], doc)
    expect(button.disabled).toBe(true)
    await act(async () => request.resolve())
    expect(refresh).toHaveBeenCalledOnce()
    expect(button.disabled).toBe(false)
    expect(h.subscriptions.size).toBe(0)
    expect(h.state.doc).toBe(doc)
  } finally { window.removeEventListener('templates-changed', refresh) }
})

it('prompt cancellation and thrown prompt both release the lock without submitting', async () => {
  const block = createBlock('heading'); await selected(block)
  vi.mocked(window.prompt).mockReturnValueOnce(null).mockImplementationOnce(() => { throw Error('Prompt unavailable') })
  await click(templateButton(block)); await click(templateButton(block))
  expect(h.save).not.toHaveBeenCalled()
  expect(h.state.notify).toHaveBeenCalledExactlyOnceWith('Prompt unavailable', 'error')
  expect(h.subscriptions.size).toBe(0)
  h.save.mockResolvedValueOnce({})
  await click(templateButton(block))
  expect(h.save).toHaveBeenCalledOnce()
})

it('gives a safe notice on an unknown API error and does not retry', async () => {
  const b = createBlock('heading'); await selected(b)
  h.save.mockRejectedValueOnce({ unknown: 'internal metadata' })
  await click(templateButton(b))
  expect(h.state.notify).toHaveBeenCalledExactlyOnceWith('收藏模板失败，请重试', 'error')
  expect(h.save).toHaveBeenCalledOnce()
})

it.each(['ABA', 'view closed'] as const)('refreshes a successful late save after %s without an obsolete toast', async mode => {
  const b = createBlock('heading'); await selected(b)
  const doc = h.state.doc, request = deferredTemplate()
  h.save.mockReturnValueOnce(request.promise)
  const refresh = vi.fn(); window.addEventListener('templates-changed', refresh)
  const setDoc = (next: typeof doc) => {
    const previous = { ...h.state }
    h.state.doc = next
    for (const subscription of [...h.subscriptions]) subscription(h.state, previous)
  }
  try {
    await click(templateButton(b))
    expect(h.subscriptions.size).toBe(1)
    if (mode === 'view closed') {
      await act(async () => root.render(null))
      expect(h.subscriptions.size).toBe(0)
    } else await act(async () => { setDoc({ ...doc, id: 'another' }); setDoc(doc) })
    await act(async () => request.resolve())
    expect(refresh).toHaveBeenCalledOnce()
    expect(h.state.notify).not.toHaveBeenCalled()
    expect(h.subscriptions.size).toBe(0)
  } finally { window.removeEventListener('templates-changed', refresh) }
})

it('does not notify or refresh when a failed save belongs to a document that has been left', async () => {
  const b = createBlock('heading'); await selected(b)
  const request = deferredTemplate(); h.save.mockReturnValueOnce(request.promise)
  const refresh = vi.fn(); window.addEventListener('templates-changed', refresh)
  try {
    await click(templateButton(b))
    const previous = { ...h.state }
    h.state.doc = { ...previous.doc, id: 'another' }
    for (const subscription of [...h.subscriptions]) subscription(h.state, previous)
    await act(async () => request.reject(Error('irrelevant failure')))
    expect(h.state.notify).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(h.subscriptions.size).toBe(0)
  } finally { window.removeEventListener('templates-changed', refresh) }
})

it('chooses and highlights a single fragment, expands and shrinks without collecting unrelated siblings',async()=>{
 const b=createBlock('html',{html:'<section style="font-family:serif"><p><b>目标段落</b></p><p>无需收藏</p></section>'})
 h.state.pickingId=b.id;await mount([b])
 const root=host.querySelector('[data-testid="fragment-picker"]')!
 const title=[...root.querySelectorAll('p')].find(p=>p.textContent==='目标段落')!, span=title.querySelector('b')!
 const outward=host.querySelector<HTMLButtonElement>('[data-testid="pick-expand"]')!, inward=host.querySelector<HTMLButtonElement>('[data-testid="pick-shrink"]')!
 expect(outward.disabled).toBe(true);expect(inward.disabled).toBe(true)
 await event(span,new MouseEvent('mouseover',{bubbles:true}));expect(title.classList.contains('fragment-hover')).toBe(true)
 await event(root,new MouseEvent('mouseout',{bubbles:true}));expect(title.classList.contains('fragment-hover')).toBe(false)
 await click(span);expect(root.querySelector('.fragment-picked')).toBe(title)
 await click(outward);expect(root.querySelector('.fragment-picked')?.textContent).toContain('无需收藏');expect(inward.disabled).toBe(false)
 await click(inward);expect(root.querySelector('.fragment-picked')).toBe(title)
 await click(host.querySelector('[data-testid="pick-collect"]'))
 expect(h.state.setPicking).toHaveBeenCalledExactlyOnceWith(null)
 const collected=h.collect.mock.calls[0][0]
 expect(collected).toMatchObject({block:b,via:'fragment'})
 expect(collected.fragment).toContain('目标段落');expect(collected.fragment).toContain('font-family: serif')
 expect(collected.fragment).not.toContain('无需收藏');expect(collected.fragment).not.toContain('fragment-picked')
})

it('clears a picked fragment from a root click and supports repeated hover and boundary expansion',async()=>{
 const b=createBlock('html',{html:'<p>只有一个块</p>'})
 h.state.pickingId=b.id;await mount([b])
 const root=host.querySelector('[data-testid="fragment-picker"]')!, p=root.querySelector('p')!
 for(let i=0;i<2;i++)await event(p,new MouseEvent('mouseover',{bubbles:true}))
 expect(root.querySelectorAll('.fragment-hover')).toHaveLength(1)
 await click(p);await click(host.querySelector('[data-testid="pick-expand"]'))
 expect(root.querySelectorAll('.fragment-picked')).toHaveLength(1)
 await click(root)
 expect(root.querySelector('.fragment-picked')).toBeNull()
 expect((host.querySelector('[data-testid="pick-collect"]') as HTMLButtonElement).disabled).toBe(true)
 expect(h.collect).not.toHaveBeenCalled()
})

const transfer=()=>{
 const contents=new Map<string,string>()
 return {get types(){return [...contents.keys()]},setData:(k:string,v:string)=>contents.set(k,v),getData:(k:string)=>contents.get(k)??'',effectAllowed:'none',dropEffect:'none'}
}
const photoMime='application/x-xiumi-photo'
const drag=async(el:Element|null,type:string,data:ReturnType<typeof transfer>,y=0)=>{
 const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientY:y})
 Object.defineProperty(e,'dataTransfer',{value:data})
 await event(el,e)
 return e
}
const photoBlock=(name:string)=>createBlock('image',{image:{src:'/media/'+name+'.jpg'}})

it('reads marked canvas photos, empty slots and shown aspect',async()=>{
 const b=photoBlock('fixture');await mount([b])
 const image=blockEl(b).querySelector('img')!
 expect(image.draggable).toBe(true);expect(image.dataset.photo).toBe('0')
 expect(photoTarget(image)).toEqual({img:image,pos:{blockId:b.id,index:0}})
 expect(photoTarget(document)).toBeNull()
 expect(slotTarget(image)).toBeNull();expect(shownRatio(image)).toBeUndefined();expect(shownRatio(null)).toBeUndefined()
 image.setAttribute('data-slot','3')
 expect(slotTarget(image)).toEqual({img:image,pos:{blockId:b.id,index:3}})
 image.removeAttribute('data-slot')
 vi.spyOn(image,'getBoundingClientRect').mockReturnValue({width:300,height:100} as DOMRect)
 expect(shownRatio(image)).toBeCloseTo(1/3,8)
})

it('tracks photo drag feedback and submits one swap with exact positions and measured aspect ratios',async()=>{
 const a=photoBlock('one'), b=photoBlock('two')
 await mount([a,b])
 const first=blockEl(a).querySelector('img')!, second=blockEl(b).querySelector('img')!, frame=host.querySelector<HTMLElement>('.canvas-scroll')!
 vi.spyOn(first,'getBoundingClientRect').mockReturnValue({width:100,height:70} as DOMRect)
 vi.spyOn(second,'getBoundingClientRect').mockReturnValue({width:200,height:100} as DOMRect)
 vi.spyOn(frame,'getBoundingClientRect').mockReturnValue({top:0,bottom:240} as DOMRect)
 frame.scrollTop=30
 const payload=transfer(), start={blockId:a.id,index:0}
 await drag(first,'dragstart',payload)
 expect(JSON.parse(payload.getData(photoMime))).toEqual(start);expect(first.classList.contains('photo-dragging')).toBe(true);expect(payload.effectAllowed).toBe('move')
 expect((await drag(second,'dragover',payload,15)).defaultPrevented).toBe(true);expect(payload.dropEffect).toBe('move')
 expect(frame.scrollTop).toBe(12);expect(second.classList.contains('photo-drop')).toBe(true)
 await drag(second,'dragover',payload,225);expect(frame.scrollTop).toBe(30)
 await drag(frame,'dragover',payload,120);expect(second.classList.contains('photo-drop')).toBe(false)
 const doc=h.state.doc,next={...doc,title:'synthetic swapped'}
 h.swap.mockReturnValueOnce(next);await drag(second,'drop',payload)
 expect(h.swap).toHaveBeenCalledExactlyOnceWith(doc,start,{blockId:b.id,index:0},{ratioA:0.7,ratioB:0.5})
 expect(h.state.commit).toHaveBeenCalledExactlyOnceWith(next)
 expect(h.state.notify).toHaveBeenCalledOnce()
 await drag(first,'dragend',payload);expect(first.classList.contains('photo-dragging')).toBe(false);expect(second.classList.contains('photo-drop')).toBe(false)
})

it('does not commit a no-op photo swap and ignores a non-photo drop on the same canvas',async()=>{
 const a=photoBlock('one');await mount([a])
 const img=blockEl(a).querySelector('img')!, payload=transfer()
 expect((await drag(img,'drop',payload)).defaultPrevented).toBe(false)
 await drag(img,'dragstart',payload)
 h.swap.mockReturnValueOnce(h.state.doc)
 await drag(img,'drop',payload)
 expect(h.swap).toHaveBeenCalledOnce();expect(h.state.commit).not.toHaveBeenCalled();expect(h.state.notify).not.toHaveBeenCalled()
})

it.each(['invalid JSON','null','wrong shape','fractional index','no canvas source'])('ignores a drop from %s without calling the photo adapter or throwing',async malformed=>{
 const a=photoBlock('one'),b=photoBlock('two');await mount([a,b])
 const target=blockEl(b).querySelector('img')!, payload=transfer()
 const raw=malformed==='invalid JSON'?'{':malformed==='null'?'null':malformed==='wrong shape'?'{"index":"0"}':JSON.stringify({blockId:malformed==='no canvas source'?'not-present':a.id,index:malformed==='fractional index'?0.5:0})
 payload.setData(photoMime,raw)
 const outside=document.createElement('div')
 if(malformed==='no canvas source'){
  outside.setAttribute('data-block-id','not-present')
  const image=document.createElement('img');image.dataset.photo='0';outside.append(image);document.body.append(outside)
 }
 const seen:Error[]=[]
 const capture=(e:ErrorEvent)=>{e.preventDefault();seen.push(e.error as Error)}
 window.addEventListener('error',capture)
 try {
  await drag(target,'drop',payload)
  expect(seen).toEqual([])
  expect(h.swap).not.toHaveBeenCalled()
  expect(h.state.commit).not.toHaveBeenCalled()
 } finally {window.removeEventListener('error',capture);outside.remove()}
})

it('looks up an imported quoted block ID by exact canvas dataset instead of selector syntax',async()=>{
 const a={...photoBlock('one'),id:'imported-"photo"'} as Block,b=photoBlock('two')
 await mount([a,b])
 const from=[...host.querySelectorAll<HTMLElement>('[data-block-id]')].find(x=>x.dataset.blockId===a.id)?.querySelector('img')
 if(!from)throw new Error('quoted source photo was not rendered')
 const target=blockEl(b).querySelector('img')!, payload=transfer()
 vi.spyOn(from,'getBoundingClientRect').mockReturnValue({width:200,height:80} as DOMRect)
 const seen:Error[]=[]
 const capture=(e:ErrorEvent)=>{e.preventDefault();seen.push(e.error as Error)}
 window.addEventListener('error',capture)
 try {
  await drag(from,'dragstart',payload)
  h.swap.mockReturnValueOnce(h.state.doc)
  await drag(target,'drop',payload)
  expect(seen).toEqual([])
  expect(h.swap).toHaveBeenCalledExactlyOnceWith(h.state.doc,{blockId:a.id,index:0},{blockId:b.id,index:0},{ratioA:0.4,ratioB:undefined})
 }finally{window.removeEventListener('error',capture)}
})

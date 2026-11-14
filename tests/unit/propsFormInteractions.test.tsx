// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {PropsForm} from '../../src/editor/PropsForm'
import {useStore,emptyDoc} from '../../src/editor/store'
import {createBlock,BLOCK_TYPES} from '../../src/core/blocks'
import type {Block} from '../../src/core/types'
import {api} from '../../src/editor/api'
let root:Root,host:HTMLDivElement
const state=()=>useStore.getState()
function Live(){const block=useStore(s=>s.doc.blocks[0]);return <PropsForm block={block}/>}
const click=async(el:Element|null|undefined)=>{expect(el).toBeTruthy();await act(async()=>{(el as HTMLElement).click()})}
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)
const input=async(el:Element|null,value:string)=>{expect(el).toBeTruthy();await act(async()=>{const node=el as HTMLInputElement;Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))})}
const mount=async(block:Block)=>{state().load({...emptyDoc(),blocks:[block,{...createBlock('heading'),id:'untouched'}]});await act(async()=>root.render(<Live/>))}
beforeEach(()=>{vi.useFakeTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.spyOn(api,'assets').mockResolvedValue([{id:'asset',file:'new.png',name:'New',width:10,height:10,size:10,createdAt:0}])})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks()})
for(const type of BLOCK_TYPES.filter(t=>t!=='html'))it(`edits actual ${type} fields and variants without changing sibling blocks`,async()=>{
 const block=createBlock(type);await mount(block);const sibling=state().doc.blocks[1]
 const fields=[...host.querySelectorAll('input:not([type="color"]),textarea')]
 for(let i=0;i<fields.length;i++)await input(fields[i],type==='table'?'One | Two\nA | B':`Edited ${i}`)
 const options=[...host.querySelectorAll('.seg button')];for(const option of options)await click(option)
 expect(state().doc.blocks[1]).toBe(sibling);expect(state().doc.blocks[0].type).toBe(type)
 if(fields.length||options.length)expect(state().doc.blocks[0].props).not.toEqual(block.props)
 await act(async()=>state().undo());expect(state().doc.blocks[1]).toBe(sibling)
})
it('gallery and timeline reorder/remove/add actions preserve the surviving content',async()=>{
 await mount(createBlock('gallery',{images:[{src:'/media/a.png'},{src:'https://example.test/b.png'}]}))
 await click(host.querySelectorAll('.g-item')[1].querySelector('button'));expect((state().doc.blocks[0].props as any).images[0].src).toContain('b.png')
 await click(host.querySelector('.g-item button:last-child'));expect((state().doc.blocks[0].props as any).images).toHaveLength(1)
 await mount(createBlock('timeline'));const n=(state().doc.blocks[0].props as any).items.length
 await click(host.querySelector('.row-edit button'));expect((state().doc.blocks[0].props as any).items).toHaveLength(n-1)
 await click(button('＋ 添加节点'));expect((state().doc.blocks[0].props as any).items).toHaveLength(n)
})
it('image and carousel actions clear images without silently losing captions',async()=>{
 await mount(createBlock('image',{image:{src:'/media/a.png'},caption:'Keep'}));await click(button('移除'));expect((state().doc.blocks[0].props as any).image).toBeUndefined();expect((state().doc.blocks[0].props as any).caption).toBe('Keep')
 await mount(createBlock('carousel',{pics:[{image:{src:'/media/a.png'},caption:'A'},{image:{src:'https://example.test/b.png'},caption:'B'}]}))
 await click(host.querySelectorAll('.pic-row')[1].querySelector('[title="前移"]'));expect((state().doc.blocks[0].props as any).pics[0].caption).toBe('B')
 await click(host.querySelector('[title="清空图片（保留图片位）"]'));expect((state().doc.blocks[0].props as any).pics[0]).toMatchObject({caption:'B',image:undefined})
 await click(host.querySelector('[title="删除这个图片位"]'));await click(button('＋ 添加图片位'));expect((state().doc.blocks[0].props as any).pics).toHaveLength(2)
})
it('HTML slot edits, alignment, source sanitization and undo use real document updates',async()=>{
 await mount(createBlock('html',{html:'<h2 style="color:#ff0000">Title</h2><p>Body</p>',label:'HTML'}))
 await input(host.querySelector('[data-testid="slot-t1"] textarea'),'');expect((state().doc.blocks[0].props as any).html).toContain('Body')
 await input(host.querySelector('[data-testid="slot-t1"] textarea'),'Updated body');await click(host.querySelector('[data-testid="align-t1-center"]'));expect((state().doc.blocks[0].props as any).html).toContain('center')
 await input(host.querySelector('input[type="color"]'),'#00aa00');expect((state().doc.blocks[0].props as any).html).toContain('#00aa00')
 await click(host.querySelector('[data-testid="match-colors"]'));expect(state().toast).not.toBeNull()
 await click(button('编辑 HTML 源码'));await input(host.querySelector('textarea.code'),'<p>Safe</p><script>evil()</script>');await click(button('应用（自动清洗不安全内容）'));expect((state().doc.blocks[0].props as any).html).toContain('Safe');expect((state().doc.blocks[0].props as any).html).not.toContain('<script')
 await act(async()=>state().undo());expect((host.querySelector('textarea.code') as HTMLTextAreaElement).value).not.toContain('evil()');await click(button('收起源码'))
})
it('HTML image and background pickers replace and remove real image slots',async()=>{
 await mount(createBlock('html',{html:'<p>Text</p><img src="/media/old.png"><section style="background-image:url(https://example.test/bg.jpg);height:100px"></section>',label:'HTML'}))
 await click(host.querySelector('.gallery-edit .image-choice'));await click(host.querySelector('.picker .asset'));expect((state().doc.blocks[0].props as any).html).toContain('/media/new.png')
 await click(host.querySelector('[data-testid="remove-image-0"]'));expect((state().doc.blocks[0].props as any).html).not.toContain('<img')
 await click(host.querySelector('[data-testid="bg-photo-0"]'));await click(host.querySelector('[data-testid="bg-asset"]'));expect((state().doc.blocks[0].props as any).html).toContain('/media/new.png')
 await click(host.querySelector('[data-testid="remove-bg-photos"]'));expect((state().doc.blocks[0].props as any).html).not.toContain('background-image')
})
it('empty or failing asset lists keep a usable picker instead of claiming a replacement',async()=>{
 vi.mocked(api.assets).mockRejectedValue(new Error('offline'));await mount(createBlock('html',{html:'<img src="/media/a.png">',label:'HTML'}));await click(host.querySelector('.image-choice'));expect(host.textContent).toContain('素材库为空');expect((state().doc.blocks[0].props as any).html).toContain('/media/a.png');await click(host.querySelector('.image-choice'));expect(host.querySelector('.picker')).toBeNull()
})

it('remote images and repeated background photos remain explicit when the library is empty',async()=>{
 await mount(createBlock('image',{image:{src:'https://example.test/image.jpg'}}));expect(host.querySelector('.img-field img')?.getAttribute('src')).toBe('https://example.test/image.jpg')
 vi.mocked(api.assets).mockResolvedValue([])
 await mount(createBlock('html',{label:'Photos',html:'<p>'+('Long body text. '.repeat(30))+'</p><img src="https://example.test/image.jpg"><section style="background-image:url(https://example.test/bg.jpg)"></section><section style="background-image:url(https://example.test/bg.jpg)"></section>'}))
 expect(host.querySelector('.g-count')?.textContent).toContain('2');await click(host.querySelector('[data-testid="bg-photo-0"]'));expect(host.querySelector('.picker .empty')).not.toBeNull();await click(host.querySelector('[data-testid="bg-photo-0"]'));expect(host.querySelector('.picker')).toBeNull()
 await input(host.querySelector('[data-testid="slot-t0"] textarea'),'Updated long body');expect((state().doc.blocks[0].props as any).html).toContain('Updated long body')
})

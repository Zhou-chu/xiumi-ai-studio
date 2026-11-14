// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { PropsForm } from '../../src/editor/PropsForm'
import { ComponentLibrary } from '../../src/editor/ComponentLibrary'
import { createBlock } from '../../src/core/blocks'
import { makeDraft } from '../../src/core/components'
import { api } from '../../src/editor/api'
import { setup, cleanup, mount, host, click, state } from './libraryToolbarHarness'
beforeEach(setup);afterEach(cleanup)
it('offers named native image and asset controls without nesting delete buttons',async()=>{
 const block=createBlock('html',{html:'<p style="color:#ff0000">Text</p><img src="/media/a.png">',label:'Original'})
 state().load({...state().doc,blocks:[block]});await mount(<PropsForm block={block}/>);
 const choose=host.querySelector('button[aria-label="替换第 1 张图片"]');expect(choose).not.toBeNull();await click(choose)
 expect(host.querySelector('button button')).toBeNull();const asset=host.querySelector('button.asset');expect(asset?.getAttribute('aria-label')).toBe('使用素材：Photo');await click(asset)
 expect((state().doc.blocks[0].props as {html:string}).html).toContain('/media/asset.png');expect(host.querySelector('input[type="color"]')?.getAttribute('aria-label')).toContain('#ff0000')
})
it('offers explicit native component insertion beside draggable preview',async()=>{
 const c={...makeDraft({name:'Saved',block:createBlock('heading'),source:{kind:'original',title:'Source',url:'',account:''},via:'block',attested:true}),id:'saved',schema:1 as const,rev:1,createdAt:1,updatedAt:1};vi.mocked(api.components).mockResolvedValue([c]);
 await mount(<ComponentLibrary templates={[]}/>);const b=host.querySelector('button[aria-label="插入组件：Saved"]');expect(b).not.toBeNull();const n=state().doc.blocks.length;await click(b);expect(state().doc.blocks).toHaveLength(n+1)
 expect(host.querySelector('[data-testid="component-insert"]')?.getAttribute('role')).toBe('group');expect(host.querySelector('[data-testid="component-insert"]')?.hasAttribute('tabindex')).toBe(false)
})

it('background replacement remains a named native control with selected state',async()=>{
 const block=createBlock('html',{html:'<section style="background-image:url(https://example.test/a.jpg);height:100px"></section>',label:'Background'});state().load({...state().doc,blocks:[block]});await mount(<PropsForm block={block}/>);
 const choose=host.querySelector('button[data-testid="bg-photo-0"]');expect(choose?.getAttribute('aria-label')).toBe('替换第 1 张背景图');await click(choose);expect(choose?.getAttribute('aria-pressed')).toBe('true');
 const asset=host.querySelector('button[data-testid="bg-asset"]');expect(asset?.getAttribute('aria-label')).toBe('使用背景素材：Photo');await click(asset);expect((state().doc.blocks[0].props as {html:string}).html).toContain('/media/asset.png')
})

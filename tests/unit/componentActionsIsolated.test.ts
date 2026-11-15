// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Block } from '../../src/core/types'

const h=vi.hoisted(()=>{
 const unexpected=()=>{throw Error('unexpected component command adapter')}
 const deny=()=>vi.fn<(...args: unknown[]) => unknown>(unexpected)
 return {unexpected,compile:deny(),block:deny(),colors:deny(),main:deny(),harmonize:deny(),recolor:deny(),theme:deny(),guess:deny(),store:deny(),insert:deny(),notify:vi.fn()}
})
vi.mock('../../src/core/compiler',()=>({compileBlock:h.compile}))
vi.mock('../../src/core/components',()=>({componentBlock:h.block}))
vi.mock('../../src/core/recolor',()=>({collectColors:h.colors,docMainColors:h.main,harmonize:h.harmonize,recolorHtml:h.recolor}))
vi.mock('../../src/core/roles',()=>({guessRole:h.guess}))
vi.mock('../../src/core/themes',()=>({resolveTheme:h.theme}))
vi.mock('../../src/editor/store',()=>({useStore:{getState:h.store}}))
import { componentRole, insertComponent, openCollect, parseDoc, setInlineTarget } from '../../src/editor/componentActions'

const old:Block<'html'>={id:'input',type:'html',props:{label:'Card',html:'<p>Original</p>'}}
const clean:Block<'html'>={...old,id:'new',props:{...old.props,html:'<p>Clean</p>'}}
const heading:Block<'heading'>={id:'heading',type:'heading',props:{title:'A heading',index:'',subtitle:'',variant:'auto'}}
const doc={id:'fixture-doc',blocks:[old]}
const state=(extra:Partial<{matching:boolean;editingId:string|null}>={})=>{
 h.store.mockReturnValue({doc,matchColors:extra.matching??false,editingId:extra.editingId??null,insertBlock:h.insert,notify:h.notify})
 h.block.mockReturnValueOnce(clean)
}
beforeEach(()=>{
 for(const fn of [h.compile,h.block,h.colors,h.main,h.harmonize,h.recolor,h.theme,h.guess,h.store,h.insert]) fn.mockReset().mockImplementation(h.unexpected)
 h.notify.mockReset()
 vi.stubGlobal('fetch',vi.fn(h.unexpected))
 setInlineTarget(null)
})
afterEach(()=>{setInlineTarget(null);vi.unstubAllGlobals()})

it('returns the recorded role or classifies an old component using its own name and parse adapter',()=>{
 expect(componentRole({name:'Saved',role:'body',block:old})).toBe('body')
 expect(h.guess).not.toHaveBeenCalled()
 h.guess.mockReturnValueOnce('intro')
 expect(componentRole({name:'Legacy',block:old})).toBe('intro')
 expect(h.guess).toHaveBeenCalledExactlyOnceWith(old,{parse:parseDoc,label:'Legacy'})
 expect(parseDoc('<p>Observed text</p>').body.textContent).toBe('Observed text')
})

it('keeps explicit index zero and parent identity when matched HTML is inserted structurally',()=>{
 state({matching:true,editingId:'editing'})
 const inline=vi.fn(h.unexpected);setInlineTarget(inline)
 const palette=[{color:'#123455'}],context=[{color:'#887755'}],theme={id:'fixture'},mapping={'#123455':'#887755'}
 h.colors.mockReturnValueOnce(palette);h.theme.mockReturnValueOnce(theme);h.main.mockReturnValueOnce(context)
 h.harmonize.mockReturnValueOnce(mapping);h.recolor.mockReturnValueOnce('<p>Matched</p>');h.insert.mockReturnValueOnce(undefined)
 insertComponent(old,{index:0,parentId:'parent',missing:['one','two']})
 expect(h.block).toHaveBeenCalledExactlyOnceWith(old,parseDoc)
 expect(h.colors).toHaveBeenCalledExactlyOnceWith(clean.props.html,parseDoc)
 expect(h.main).toHaveBeenCalledExactlyOnceWith(doc.blocks,theme,parseDoc)
 expect(h.harmonize).toHaveBeenCalledExactlyOnceWith(palette,context)
 expect(h.recolor).toHaveBeenCalledExactlyOnceWith(clean.props.html,mapping,parseDoc)
 expect(h.insert).toHaveBeenCalledExactlyOnceWith({...clean,props:{...clean.props,html:'<p>Matched</p>'}},0,'parent')
 expect(h.notify).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('2 张图片已从素材库删除'),'error')
 expect(inline).not.toHaveBeenCalled();expect(old.props.html).toBe('<p>Original</p>')
})

it('inserts uncompiled HTML at the active caret even if a prior inline registration cleans up',()=>{
 state({editingId:'active'})
 const stale=vi.fn(h.unexpected),active=vi.fn(()=>true)
 const cleanStale=setInlineTarget(stale);const cleanActive=setInlineTarget(active)
 cleanStale()
 insertComponent(old)
 expect(active).toHaveBeenCalledExactlyOnceWith(clean.props.html)
 expect(stale).not.toHaveBeenCalled();expect(h.insert).not.toHaveBeenCalled();expect(h.compile).not.toHaveBeenCalled()
 expect(h.notify).toHaveBeenCalledExactlyOnceWith('已插入到光标所在段落后面，可撤销')
 cleanActive()
 h.block.mockReturnValueOnce(clean);h.insert.mockReturnValueOnce(undefined)
 insertComponent(old)
 expect(h.insert).toHaveBeenCalledExactlyOnceWith(clean,undefined,undefined)
 expect(active).toHaveBeenCalledOnce()
})

it('uses the compiler for a non-HTML inline candidate and appends when the caret refuses it',()=>{
 state({matching:true,editingId:'active'})
 h.block.mockReset().mockReturnValueOnce(heading)
 const active=vi.fn(()=>false);setInlineTarget(active)
 const theme={id:'fixture'};h.theme.mockReturnValueOnce(theme);h.compile.mockReturnValueOnce('<h2>compiled</h2>');h.insert.mockReturnValueOnce(undefined)
 insertComponent(heading,{parentId:null})
 expect(h.colors).not.toHaveBeenCalled()
 expect(h.compile).toHaveBeenCalledExactlyOnceWith(heading,theme)
 expect(active).toHaveBeenCalledExactlyOnceWith('<h2>compiled</h2>')
 expect(h.notify).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('没找到光标位置'))
 expect(h.insert).toHaveBeenCalledExactlyOnceWith(heading,undefined,null)
})

it('dispatches only the explicit collect modal intent without reading any persistence adapter',()=>{
 const received=vi.fn();window.addEventListener('open-collect',received)
 const detail={block:old,fragment:'<p>Fragment</p>',via:'fragment' as const}
 try {
  openCollect(detail)
  expect(received).toHaveBeenCalledOnce()
  expect((received.mock.calls[0][0] as CustomEvent).detail).toBe(detail)
  expect(h.store).not.toHaveBeenCalled()
 } finally {window.removeEventListener('open-collect',received)}
})

// @vitest-environment jsdom
import {it,expect} from 'vitest'
import {aiContext} from '../../src/core/quickActions'
import {textToRich} from '../../src/core/richtext'
import {createBlock} from '../../src/core/blocks'
import type {Doc} from '../../src/core/types'
const child={...createBlock('paragraph',{content:textToRich('Selected child')}),id:'child'}
const sibling={...createBlock('paragraph',{content:textToRich('PRIVATE SIBLING')}),id:'sibling'}
const box={...createBlock('box',{children:[child,sibling]}),id:'box'}
const top={...createBlock('paragraph',{content:textToRich('PRIVATE OTHER TOP')}),id:'top'}
const doc={id:'doc',title:'Test',themeId:'tsinghua-purple',blocks:[box,top],createdAt:1,updatedAt:1} as Doc
it('single nested selection sends only the exact selected module, not parent, sibling or other summaries',()=>{
 const ctx=aiContext(doc,'child');expect(ctx.blocks.map(b=>b.id)).toEqual(['child']);expect(ctx.focus).toEqual({id:'child',type:'paragraph'});expect(JSON.stringify(ctx)).not.toContain('PRIVATE');expect(JSON.stringify(ctx)).not.toContain('"id":"box"')
})
it('single top-level selection omits every other block',()=>{expect(aiContext(doc,'top').blocks.map(b=>b.id)).toEqual(['top'])})
it('invalid explicit selection fails closed instead of reverting to the complete document',()=>{
 for(const scope of ['missing','',[],['child','missing']])expect(()=>aiContext(doc,scope)).toThrow()
})
it('multiple selection remains explicit and deduplicated; unselected mode preserves the whole document',()=>{
 const ctx=aiContext(doc,['child','top','child']);expect(ctx.blocks.map(b=>b.id)).toEqual(['child','top']);expect(JSON.stringify(ctx)).not.toContain('PRIVATE SIBLING')
 expect(aiContext(doc).blocks.map(b=>b.id)).toEqual(['box','top']);expect(aiContext(doc,null).blocks.map(b=>b.id)).toEqual(['box','top']);expect(JSON.stringify(aiContext(doc))).toContain('PRIVATE SIBLING')
})

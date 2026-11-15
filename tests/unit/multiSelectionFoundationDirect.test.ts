import { expect, it } from 'vitest'
import { limitToSelection } from '../../src/core/ops'
import { resolveEditSelection, prepareEdit } from '../../server/aiEdit'
import { createBlock } from '../../src/core/blocks'
import { aiContext } from '../../src/core/quickActions'
import type { Doc } from '../../src/core/types'

const p=(id:string)=>({...createBlock('paragraph'),id})
const doc=():Doc=>({
 id:'selection-fixture',title:'未命名推文',author:'',digest:'',themeId:'tsinghua-purple',createdAt:0,updatedAt:0,
 blocks:[{...createBlock('box'),id:'box',props:{...createBlock('box').props,children:[p('child')]}},p('b'),p('c')],
})

it('filter unions selected subtrees without admitting unselected siblings or metadata',()=>{
 const ops=[{op:'update',id:'child',props:{content:'x'}},{op:'remove',id:'b'},{op:'update',id:'c'},{op:'setTheme',themeId:'x'}]
 expect(limitToSelection(doc(),['box','b'] as any,ops,'filter')).toEqual({ops:ops.slice(0,2),dropped:ops.slice(2)})
})
it('strict remains atomic update-only across all selected subtrees',()=>{
 const ops=[{op:'update',id:'child'},{op:'update',id:'b'}]
 expect(limitToSelection(doc(),['box','b'] as any,ops,'strict').ops).toEqual(ops)
 expect(limitToSelection(doc(),['box','b'] as any,[...ops,{op:'remove',id:'b'}],'strict').ops).toEqual([])
})
it('shared gap picks document-first anchor regardless of click order and honors a valid explicit alternative',()=>{
 const op={op:'insert',index:'1',block:p('new')}
 for(const ids of [['box','b'],['b','box']]) expect(limitToSelection(doc(),ids as any,[op],'filter').ops[0]).toMatchObject({index:1,anchor:{id:'box',side:'after'}})
 expect(limitToSelection(doc(),['box','b'] as any,[{...op,anchor:{id:'b',side:'before'}}],'filter').ops).toHaveLength(1)
 expect(limitToSelection(doc(),['box','b'] as any,[{...op,anchor:{id:'c',side:'before'}}],'filter').ops).toEqual([])
})
it.each([[],['b','b'],['missing'],['b','missing']].map(ids=>[ids]))('invalid selected list %j never grants document scope', ids=>{
 const ops=[{op:'setTheme',themeId:'x'}]
 expect(limitToSelection(doc(),ids as any,ops,'filter')).toEqual({ops:[],dropped:ops})
 expect(()=> (resolveEditSelection as any)(doc(),undefined,ids)).toThrow()
})
it('duplicate selected identities fail closed while unrelated duplicate IDs do not invalidate selection',()=>{
 const d=doc();d.blocks.push(p('b'));expect(()=> (resolveEditSelection as any)(d,undefined,['box','b'])).toThrow()
 expect((resolveEditSelection as any)(d,undefined,['box','c'])).toEqual(['box','c'])
})
it('request ids, primary and focus must agree; old single focus still resolves',()=>{
 const d={...doc(),focus:{ids:['b','box'],id:'b'}}
 expect((resolveEditSelection as any)(d,'b',['box','b'])).toEqual(['box','b'])
 expect(()=> (resolveEditSelection as any)(d,'c',['box','b'])).toThrow()
 expect(()=> (resolveEditSelection as any)({...d,focus:{ids:['b','c']}},undefined,['box','b'])).toThrow()
 expect(resolveEditSelection({...doc(),focus:{id:'b'}},'b')).toBe('b')
})
it('server retains filter count and strict failure for the multi request',()=>{
 const filter=(prepareEdit as any)(doc(),undefined,'filter',['box','b'])
 const ops=[{op:'remove',id:'b'},{op:'update',id:'c'}]
 expect(filter.result({ops,selectionPolicy:'strict',ignoredOps:999})).toMatchObject({ops:[ops[0]],ignoredOps:1,selectionPolicy:'filter'})
 expect(filter.prompt('edit')).toContain('box');expect(filter.prompt('edit')).toContain('b')
 expect(()=>(prepareEdit as any)(doc(),undefined,'strict',['box','b']).result({ops})).toThrow()
})
it('context keeps original top indices and full selected ancestors with summary neighbors',()=>{
 const c=aiContext(doc(),['child','b'] as any)
 expect(c.focus).toMatchObject({ids:['child','b']})
 expect(c.blocks.map(b=>b.index)).toEqual([0,1,2]);expect(c.blocks[0]).toHaveProperty('props.children');expect(c.blocks[1]).toHaveProperty('props');expect(c.blocks[2]).toHaveProperty('summary')
})
it('does not widen a legacy single focus into a larger explicit selected array',()=>{
 expect(()=>resolveEditSelection({...doc(),focus:{id:'b'}},'b',['box','b'])).toThrow()
 expect(resolveEditSelection({...doc(),focus:{id:'b'}},'b',['b'])).toEqual(['b'])
})
it('context refuses ambiguous selected IDs before serializing anything',()=>{
 const d=doc();d.blocks.push(p('b'));expect(()=>aiContext(d,['b','c'])).toThrow()
 expect(()=>aiContext(d,[])).toThrow()
})
it('overlapping parent and child scope is a union, excludes sibling of child-only selection',()=>{
 const d=doc();(d.blocks[0].props as any).children.push(p('sibling'))
 const ops=[{op:'update',id:'child'},{op:'update',id:'sibling'}]
 expect(limitToSelection(d,['box','child'],ops,'strict').ops).toEqual(ops)
 expect(limitToSelection(d,['child','b'],ops,'filter')).toEqual({ops:[ops[0]],dropped:[ops[1]]})
})
it('context does not treat an explicit empty scalar selection as whole document',()=>{
 expect(()=>aiContext(doc(),'')).toThrow()
 expect(aiContext(doc(),undefined).blocks.every(b=>'props' in b)).toBe(true)
 expect(aiContext(doc(),null).blocks.every(b=>'props' in b)).toBe(true)
})

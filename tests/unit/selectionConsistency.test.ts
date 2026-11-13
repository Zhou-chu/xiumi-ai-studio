// @vitest-environment jsdom
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import { useStore,emptyDoc,selectedBlock } from '../../src/editor/store'
import { createBlock } from '../../src/core/blocks'
const state=()=>useStore.getState()
beforeEach(()=>{vi.useFakeTimers();state().load({...emptyDoc(),blocks:[{...createBlock('heading'),id:'a'},{...createBlock('heading'),id:'b'}]})})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})
it('undo insertion clears selection and picking IDs which no longer exist',()=>{
 const id=state().insertBlock('paragraph');state().setPicking(id);state().undo()
 expect(state().selectedId).toBeNull();expect(state().pickingId).toBeNull();expect(selectedBlock(state())).toBeNull()
})
it('removing a parent clears descendant selection and editing state',()=>{
 const child={...createBlock('heading'),id:'child'},box=createBlock('box');box.id='box';box.props.children=[child]
 state().load({...emptyDoc(),blocks:[box]});state().setEditing('child');state().removeBlock('box')
 expect(state().selectedId).toBeNull();expect(state().editingId).toBeNull()
})
it('redo clears a selected block removed by restored history',()=>{
 state().removeBlock('a');state().undo();state().select('a');state().redo()
 expect(state().selectedId).toBeNull()
})
it('preserves valid selection through updates and history and refuses invalid selection',()=>{
 state().select('a');state().updateProps('a',{title:'Updated'});state().undo();expect(state().selectedId).toBe('a')
 state().redo();expect(selectedBlock(state())?.props).toMatchObject({title:'Updated'})
 state().select('missing');expect(state().selectedId).toBeNull()
})

it('modifier selection toggles membership and ordinary selection replaces it',()=>{
 state().select('a');state().select('b',{toggle:true});expect(state().selectedIds).toEqual(['a','b']);expect(state().selectedId).toBe('b')
 state().select('b',{toggle:true});expect(state().selectedIds).toEqual(['a']);expect(state().selectedId).toBe('a')
 state().select('b');expect(state().selectedIds).toEqual(['b']);state().select(null);expect(state().selectedIds).toEqual([])
})
it('batch deletion is one undo transaction and leaves no orphaned selection',()=>{
 state().select('a');state().select('b',{toggle:true});state().removeSelected()
 expect(state().doc.blocks).toEqual([]);expect(state().selectedIds).toEqual([]);expect(state().past).toHaveLength(1)
 state().undo();expect(state().doc.blocks.map(b=>b.id)).toEqual(['a','b']);expect(state().selectedIds).toEqual([])
 state().redo();expect(state().doc.blocks).toEqual([])
})
it('batch deletion with parent and child removes each subtree safely',()=>{
 const box=createBlock('box');box.id='box';box.props.children=[{...createBlock('heading'),id:'child'}]
 state().load({...emptyDoc(),blocks:[box,{...createBlock('heading'),id:'keep'}]})
 state().select('box');state().select('child',{toggle:true});state().removeSelected()
 expect(state().doc.blocks.map(b=>b.id)).toEqual(['keep']);expect(state().past).toHaveLength(1)
})

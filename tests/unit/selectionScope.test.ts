// @vitest-environment jsdom
import { act,createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach,afterEach,it,expect } from 'vitest'
import { selectionIdentity, useSelectionScope } from '../../src/editor/useSelectionScope'
let root:Root, host:HTMLDivElement, current:ReturnType<typeof useSelectionScope>
function Probe({docId,selectedId}:{docId:string;selectedId?:string|string[]}) { current=useSelectionScope(docId,selectedId);return createElement('span',null,current.scope) }
const show=(selectedId?:string|string[],docId='doc')=>act(()=>root.render(createElement(Probe,{docId,selectedId})))
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove()})
it('resets a per-selection full-document override when selection changes or clears',()=>{
 show('a');expect(current.scope).toBe('selection');act(()=>current.setScope('document'));expect(current.scope).toBe('document')
 show('b');expect(current.scope).toBe('selection');show();expect(current.scope).toBe('document');show('a');expect(current.scope).toBe('selection')
})
it('keeps the current override during ordinary rerenders but not a document switch',()=>{
 show('a');act(()=>current.setScope('document'));show('a');expect(current.scope).toBe('document')
 show('a','other');expect(current.scope).toBe('selection')
})

it('multi-selection membership resets the override but order alone does not',()=>{
 show(['a','b']);act(()=>current.setScope('document'));show(['b','a']);expect(current.scope).toBe('document')
 show(['a','b','c']);expect(current.scope).toBe('selection');show([]);expect(current.scope).toBe('document')
})

it('cannot force selection scope when no module exists',()=>{
 show([]);act(()=>current.setScope('selection'));expect(current.scope).toBe('document')
})

it('uses deterministic code-unit identity without mutating selection order',()=>{
 const ids=['2','a','10','A','a']
 expect(selectionIdentity(ids)).toBe('["10","2","A","a","a"]')
 expect(ids).toEqual(['2','a','10','A','a'])
 expect(selectionIdentity([...ids].reverse())).toBe(selectionIdentity(ids))
 expect(selectionIdentity([])).toBe('[]')
})

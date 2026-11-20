import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { findBlock } from '../core/tree'
import { useStore } from './store'
type Scope = 'selection' | 'document'
/** Code-unit order is deliberate: identity must not vary with browser locale. */
export const selectionIdentity = (ids: readonly string[]) => JSON.stringify([...ids].sort((a, b) => a < b ? -1 : a > b ? 1 : 0))
/** A manual full-document override lasts only for this document and selection. */
export function useSelectionScope(docId:string,selectedId?:string|string[],epoch=0) {
 const ids=Array.isArray(selectedId)?selectedId:selectedId?[selectedId]:[]
 const key=JSON.stringify([docId,selectionIdentity(ids),epoch])
 const automatic:Scope=ids.length?'selection':'document'
 const [choice,setChoice]=useState({key,scope:automatic})
 // Reset during render, before children or handlers can observe the previous selection's scope.
 if(choice.key!==key)setChoice({key,scope:automatic})
 const scope=choice.key===key?choice.scope:automatic
 const setScope=(next:Scope)=>setChoice({key,scope:ids.length?next:'document'})
 return {scope,setScope}
}


/** An observed A → B → A invalidates requests even when React renders only the second A. */
export function useSelectionLifetime() {
  const [tracker] = useState(() => {
    let value = 0, active = false
    let previous = useStore.getState()
    const identify = ({ doc, selectedIds }: typeof previous) => {
      const typedIds = selectedIds.map(id => JSON.stringify([id, findBlock(doc.blocks, id)?.block.type]))
      return JSON.stringify([doc.id, selectionIdentity(typedIds)])
    }
    let key = identify(previous)
    const snapshot = () => {
      const next = useStore.getState()
      if (next.doc.id !== previous.doc.id || next.doc.blocks !== previous.doc.blocks || next.selectedIds !== previous.selectedIds) {
        const nextKey = identify(next)
        if (nextKey !== key) { key = nextKey; value++ }
      }
      previous = next
      return value
    }
    return {
      snapshot,
      subscribe: (notify: () => void) => useStore.subscribe(() => {
        const before = value
        if (snapshot() !== before) notify()
      }),
      owns: (epoch: number) => active && snapshot() === epoch,
      start: () => { active = true },
      stop: () => { active = false; value++ },
    }
  })
  const epoch = useSyncExternalStore(tracker.subscribe, tracker.snapshot, tracker.snapshot)
  useLayoutEffect(() => { tracker.start(); return tracker.stop }, [tracker])
  return { epoch, owns: tracker.owns }
}

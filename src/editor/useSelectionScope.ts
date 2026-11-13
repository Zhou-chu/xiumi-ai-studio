import { useState } from 'react'
type Scope = 'selection' | 'document'
/** Code-unit order is deliberate: identity must not vary with browser locale. */
export const selectionIdentity = (ids: readonly string[]) => JSON.stringify([...ids].sort((a, b) => a < b ? -1 : a > b ? 1 : 0))
/** A manual full-document override lasts only for this document and selection. */
export function useSelectionScope(docId:string,selectedId?:string|string[]) {
 const ids=Array.isArray(selectedId)?selectedId:selectedId?[selectedId]:[]
 const key=JSON.stringify([docId,selectionIdentity(ids)])
 const automatic:Scope=ids.length?'selection':'document'
 const [choice,setChoice]=useState({key,scope:automatic})
 // Reset during render, before children or handlers can observe the previous selection's scope.
 if(choice.key!==key)setChoice({key,scope:automatic})
 const scope=choice.key===key?choice.scope:automatic
 const setScope=(next:Scope)=>setChoice({key,scope:ids.length?next:'document'})
 return {scope,setScope}
}

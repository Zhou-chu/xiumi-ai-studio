import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
import { SuggestionQueue } from '../../src/editor/suggestionQueue'
afterEach(() => vi.unstubAllGlobals())
it('passes the UI signal to browser fetch',async()=>{
 const ctrl=new AbortController();const fetch=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response('{"suggestion":"x"}'));vi.stubGlobal('fetch',fetch)
 await api.aiSuggestInstruction({},'test',undefined,ctrl.signal)
 expect(fetch.mock.calls[0][1]!.signal).toBe(ctrl.signal)
})
it('does not cache aborted failures or late stale results, allowing a fresh request for the same context',async()=>{
 const queue=new SuggestionQueue(0);const ctrl=new AbortController();let finish!:(x:{suggestion:string})=>void
 const first=queue.get('same',()=>new Promise(r=>finish=r),ctrl.signal);ctrl.abort();finish({suggestion:'stale'});await first
 const fresh=vi.fn(async()=>({suggestion:'fresh'}));expect(await queue.get('same',fresh,new AbortController().signal)).toBe('fresh')
 const stop=new AbortController();const bad=queue.get('other',async()=>{stop.abort();throw new DOMException('Cancelled','AbortError')},stop.signal);await expect(bad).rejects.toThrow()
 expect(await queue.get('other',fresh,new AbortController().signal)).toBe('fresh')
})
it('serializes multi-selection separately from legacy primary id without losing suggestion abort signal',async()=>{
 const ctrl=new AbortController();const fetch=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response('{}'));vi.stubGlobal('fetch',fetch)
 await api.aiEdit({},'edit',undefined,'b',['a','b'])
 expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({selectedId:'b',selectedIds:['a','b']})
 await api.aiSuggestInstruction({},undefined,'b',ctrl.signal,['a','b'])
 expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toMatchObject({selectedId:'b',selectedIds:['a','b']});expect(fetch.mock.calls[1][1]!.signal).toBe(ctrl.signal)
})

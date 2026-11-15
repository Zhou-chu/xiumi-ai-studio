import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chatText } from '../../server/ai'
const boundary = vi.hoisted(() => ({
  read: vi.fn(async () => { throw new Error('Unexpected real settings read in isolated provider test') }),
  write: vi.fn(async () => { throw new Error('Unexpected settings write in isolated provider test') }),
  fetch: vi.fn(async () => { throw new Error('Unexpected transport in isolated provider test') }),
}))
vi.mock('../../server/store', () => ({
  DATA: 'unused-mocked-settings',
  readJson: boundary.read,
  writeJson: boundary.write,
}))
beforeEach(() => {
  for (const guard of Object.values(boundary)) guard.mockClear()
  vi.stubGlobal('fetch', boundary.fetch)
})
afterEach(() => {
  for (const guard of Object.values(boundary)) expect(guard).not.toHaveBeenCalled()
})
const profile = { id:'test',name:'Test',provider:'openai',baseUrl:'https://example.test/v1',apiKey:'fixture',model:'test',reasoningEffort:'low',jsonMode:false } as const
afterEach(() => vi.unstubAllGlobals())
it('retains rejected configured effort and tells the user exactly how to clear it', async () => {
 const fetch = vi.fn(async (_url:unknown, _init?:RequestInit) => new Response(JSON.stringify({error:{message:'Unsupported parameter reasoning_effort'}}),{status:400}))
 vi.stubGlobal('fetch',fetch)
 await expect(chatText('s','u',{profile})).rejects.toThrow('请在 AI 模型设置中清空“思考强度”')
 expect(fetch).toHaveBeenCalledTimes(1)
 expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).reasoning_effort).toBe('low')
 expect(profile.reasoningEffort).toBe('low')
})
it('does not mislabel unrelated bad credentials as unsupported effort',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('invalid API key',{status:401})))
 await expect(chatText('s','u',{profile})).rejects.not.toThrow('清空')
})
it('propagates already aborted callers without sending and preserves caller cancellation',async()=>{
 const ctrl=new AbortController();ctrl.abort();const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 await expect(chatText('s','u',{profile,signal:ctrl.signal})).rejects.toMatchObject({name:'AbortError'})
 expect(fetch).not.toHaveBeenCalled()
})
it('cancels an already sent model request, not reporting it as the 180-second deadline',async()=>{
 const ctrl=new AbortController();let sent!:()=>void;const started=new Promise<void>(r=>sent=r)
 vi.stubGlobal('fetch',vi.fn((_u,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});sent()})))
 const pending=chatText('s','u',{profile,signal:ctrl.signal});const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});await started;ctrl.abort();await rejected
})
it('retains the model timeout when no caller cancellation happened',async()=>{
 vi.stubGlobal('fetch',vi.fn((_u,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})})))
 await expect(chatText('s','u',{profile,timeoutMs:5})).rejects.toMatchObject({status:504})
})
it('does not return a late response after a caller cancellation',async()=>{
 const ctrl=new AbortController()
 vi.stubGlobal('fetch',vi.fn(async()=>{ctrl.abort();return new Response(JSON.stringify({choices:[{message:{content:'late'}}]}))}))
 await expect(chatText('s','u',{profile,signal:ctrl.signal})).rejects.toMatchObject({name:'AbortError'})
})

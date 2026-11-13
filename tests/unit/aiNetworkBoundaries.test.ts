import { afterEach, expect, it, vi } from 'vitest'
import { aiStatus, chatJson, chatText, discoverModels, testConnection } from '../../server/ai'
import type { AiProfile } from '../../server/settings'
vi.mock('../../server/settings', () => ({ getProfile: vi.fn() }))
vi.mock('../../server/aiModels', () => ({ fetchModels: vi.fn() }))
import { getProfile } from '../../server/settings'
import { fetchModels } from '../../server/aiModels'
const profile = (over: Partial<AiProfile> = {}): AiProfile => ({ id:'p', name:'Test', provider:'openai', model:'m', baseUrl:'https://example.test/v1/', apiKey:'fake-test-only', jsonMode:false, ...over })
const ok = (content = '{}') => Response.json({choices:[{message:{content}}]})
const respond = (response: () => Response) => vi.stubGlobal('fetch', vi.fn(async () => response()))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetAllMocks() })
it.each([undefined, profile({baseUrl:''}), profile({model:''})])('rejects missing configuration before networking', async p => {
 vi.mocked(getProfile).mockResolvedValue(p ?? null)
 const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher)
 await expect(chatText('s','u')).rejects.toMatchObject({status:503}); expect(fetcher).not.toHaveBeenCalled()
})
it('reports saved profile status without requiring a local key', async()=>{
 for(const [p,enabled] of [[undefined,false],[profile({apiKey:''}),false],[profile({apiKey:'',baseUrl:'http://localhost:11434/v1'}),true],[profile(),true]] as const){
  vi.mocked(getProfile).mockResolvedValue(p ?? null); expect((await aiStatus('p')).enabled).toBe(enabled)
 }
})
it('maps discovered models with and without effort metadata',async()=>{
 vi.mocked(fetchModels).mockResolvedValue([{id:'a'},{id:'b',efforts:['high']}])
 expect(await discoverModels(profile())).toEqual([{id:'a'},{id:'b',efforts:['high'],reasoningEfforts:['high']}])
})
it.each(['```json\n{"ok":true}\n```','prefix {"ok":true} suffix','[1,2]'])('parses JSON wrappers %s',async text=>{
 respond(()=>ok(text)); expect(await chatJson('s','u',{profile:profile()})).toEqual(text==='[1,2]'?[1,2]:{ok:true})
})
it.each(['not json','}oops{','{broken}'])('rejects malformed JSON %s',async text=>{
 respond(()=>ok(text)); await expect(chatJson('s','u',{profile:profile()})).rejects.toThrow()
})
it.each(['openai','anthropic'] as const)('handles absent content and partial allowed %s responses',async provider=>{
 respond(()=>Response.json({})); expect(await chatText('s','u',{profile:profile({provider})})).toBe('')
 respond(()=>Response.json(provider==='openai'?{choices:[{finish_reason:'length',message:{content:'partial'}}]}:{stop_reason:'max_tokens',content:[{type:'thinking'},{text:'partial'}]}))
 expect(await chatText('s','u',{profile:profile({provider}),allowTruncated:true})).toBe('partial')
})
it.each([Response.json({message:'denied'},{status:401}),Response.json({other:true},{status:503}),new Response('plain failure',{status:500})])('surfaces non-retryable upstream errors',async response=>{
 const f=vi.fn(async()=>response);vi.stubGlobal('fetch',f)
 await expect(chatText('s','u',{profile:profile()})).rejects.toMatchObject({status:502});expect(f).toHaveBeenCalledTimes(1)
})
it('caps adaptive retries at six attempts with success-independent budget',async()=>{
 let n=7000; const f=vi.fn(async()=>Response.json({error:{message:`max_tokens maximum ${n-=100}`}},{status:422}));vi.stubGlobal('fetch',f)
 await expect(chatText('s','u',{profile:profile()})).rejects.toMatchObject({status:502});expect(f).toHaveBeenCalledTimes(6)
})
it('retries unsupported temperature and token field, retaining the real messages',async()=>{
 const bodies:Record<string,unknown>[]=[]
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
  bodies.push(JSON.parse(String(init.body)))
  return bodies.length===1?Response.json({message:'use max_completion_tokens'},{status:400}):bodies.length===2?Response.json({message:'temperature unsupported'},{status:422}):ok()
 }))
 await chatText('system','user',{profile:profile({apiKey:''}),temperature:0})
 expect(bodies[0].temperature).toBe(0); expect(bodies[2].temperature).toBeUndefined(); expect(bodies[2].max_completion_tokens).toBe(8000)
 expect(bodies[2].messages).toEqual([{role:'system',content:'system'},{role:'user',content:'user'}])
})
it('aborts generation at its deadline and clears the timer',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))))
 const assertion=expect(chatText('s','u',{profile:profile()})).rejects.toMatchObject({status:504})
 await vi.advanceTimersByTimeAsync(180000);await assertion;expect(vi.getTimerCount()).toBe(0)
})
it('does not swallow network failures and always clears its timer',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline')}))
 await expect(chatText('s','u',{profile:profile()})).rejects.toThrow('offline');expect(vi.getTimerCount()).toBe(0)
})
it.each([undefined,{completion_tokens:-1,completion_tokens_details:{reasoning_tokens:'secret'}},{completion_tokens:0,completion_tokens_details:{reasoning_tokens:0}}])('handles missing or invalid numeric usage without leaking response data',async usage=>{
 respond(()=>Response.json({choices:[{finish_reason:'length',message:{content:'private'}}],usage}))
 await expect(chatText('s','u',{profile:profile()})).rejects.not.toThrow(/private|secret|NaN/)
})
it.each(['openai','anthropic'] as const)('validates response shape and JSON for %s probes',async provider=>{
 const p=profile({provider,reasoningEffort:'high',extraBody:'{"n":8}',maxOutputTokens:32})
 for(const [data,stage] of [[null,'response'],[{},'response'],[provider==='openai'?{choices:[{message:{content:'bad'}}]}:{content:[{type:'thinking'},{text:'bad'}]},'format_warning'],[provider==='openai'?{choices:[{message:{content:'{"ok":true}'}}]}:{content:[{text:'{"ok":true}'}]},'complete']] as const){
  respond(()=>Response.json(data)); expect(await testConnection(p)).toMatchObject({stage,budgetTokens:32})
 }
})
it.each([401,403,404,400,422,429,500])('classifies probe HTTP %s without retry when JSON is disabled',async status=>{
 respond(()=>new Response('failure',{status}));const stage=status===401||status===403?'authentication':status===404?'model_or_endpoint':status===400||status===422?'request':'service'
 expect(await testConnection(profile())).toMatchObject({ok:false,stage,httpStatus:status})
})
it.each(['bad-url','ftp://example.test',''])('rejects invalid probe URLs %s',async baseUrl=>{
 expect(await testConnection(profile({baseUrl}))).toMatchObject({ok:false,stage:'configuration'})
})
it('rejects a missing probe model and malformed JSON body',async()=>{
 expect(await testConnection(profile({model:''}))).toMatchObject({stage:'configuration'})
 respond(()=>new Response('not-json'));expect(await testConnection(profile())).toMatchObject({stage:'response'})
})
it('limits probe retries and retains explicit reasoning',async()=>{
 const f=vi.fn(async()=>Response.json({error:{message:'unsupported response_format'}},{status:400}));vi.stubGlobal('fetch',f)
 expect(await testConnection(profile({jsonMode:true,reasoningEffort:'high'}))).toMatchObject({stage:'request'});expect(f).toHaveBeenCalledTimes(2)
})
it('distinguishes probe timeout and transport failure',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new Error('closed'))))))
 const result=testConnection(profile());await vi.advanceTimersByTimeAsync(20000);expect(await result).toMatchObject({stage:'timeout'});expect(vi.getTimerCount()).toBe(0)
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline')}));expect(await testConnection(profile())).toMatchObject({stage:'transport'});expect(vi.getTimerCount()).toBe(0)
})


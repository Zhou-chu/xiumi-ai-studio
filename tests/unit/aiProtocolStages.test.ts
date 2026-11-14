import { afterEach, expect, it, vi } from 'vitest'
import { chatText, testConnection } from '../../server/ai'
import type { AiProfile } from '../../server/settings'
const profile = (provider: AiProfile['provider']): AiProfile => ({id:'p',name:'Test',provider,baseUrl:'https://example.test/v1/',model:'m',apiKey:'fake-key',jsonMode:true})
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it.each(['openai','anthropic'] as const)('preserves %s request credentials, budget and redirect boundaries',async provider=>{
 let request:RequestInit|undefined;let endpoint=''
 vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{request=init;endpoint=url;return Response.json(provider==='anthropic'?{content:[{text:'answer'}]}:{choices:[{message:{content:'answer'}}]})})
 const p={...profile(provider),maxOutputTokens:2048,reasoningEffort:'high',extraBody:JSON.stringify({model:'evil',messages:[],max_tokens:99999,custom:true})}
 expect(await chatText('system','user',{profile:p,maxTokens:4096})).toBe('answer')
 expect(endpoint).toBe(`https://example.test/v1/${provider==='anthropic'?'messages':'chat/completions'}`)
 expect(request?.redirect).toBe('error')
 const headers=request?.headers as Record<string,string>;expect(headers[provider==='anthropic'?'x-api-key':'authorization']).toBe(provider==='anthropic'?'fake-key':'Bearer fake-key')
 expect(headers[provider==='anthropic'?'authorization':'x-api-key']).toBeUndefined()
 const body=JSON.parse(String(request?.body));expect(body.model).toBe('m');expect(body.custom).toBe(true);expect(body[provider==='anthropic'?'max_tokens':'max_completion_tokens']).toBe(2048);expect(body.temperature).toBeUndefined()
 expect(body.messages.at(-1)).toEqual({role:'user',content:'user'})
})
it.each([[401,'authentication'],[403,'authentication'],[404,'model_or_endpoint'],[429,'service'],[500,'service']] as const)('keeps probe HTTP %s classified without leaking details',async(status,stage)=>{
 let calls=0;vi.stubGlobal('fetch',async()=>{calls++;return Response.json({error:{message:'private-secret'}},{status})})
 const result=await testConnection(profile('openai'));expect(result).toMatchObject({ok:false,stage,httpStatus:status,budgetTokens:128,probeOnly:true});expect(JSON.stringify(result)).not.toContain('private-secret');expect(calls).toBe(1)
})
it.each(['openai','anthropic'] as const)('retains default 180-second generation deadline and cleanup (%s)',async provider=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined
 vi.stubGlobal('fetch',(_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>{signal=init.signal as AbortSignal;signal.addEventListener('abort',()=>reject(Object.assign(new Error('stopped'),{name:'AbortError'}))) }))
 const result=chatText('s','u',{profile:profile(provider)});const check=expect(result).rejects.toMatchObject({status:504})
 await vi.advanceTimersByTimeAsync(179999);expect(signal?.aborted).toBe(false)
 await vi.advanceTimersByTimeAsync(1);await check;expect(signal?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0)
})
it.each(['openai','anthropic'] as const)('keeps capability probing bounded to two attempts (%s)',async provider=>{
 const bodies:any[]=[];vi.stubGlobal('fetch',async(_url:string,init:RequestInit)=>{bodies.push(JSON.parse(String(init.body)));return Response.json({error:{message:'rejected'}},{status:400})})
 const result=await testConnection({...profile(provider),extraBody:'{"n":8,"max_tokens":9000}'});expect(result.ok).toBe(false);expect(result.stage).toBe('request');expect(bodies.length).toBeLessThanOrEqual(2)
 for(const body of bodies){expect(body.max_tokens).toBe(128);expect(body.n).toBe(provider==='openai'?1:undefined)}
})

import { afterEach, expect, it, vi } from 'vitest'
import { testConnection } from '../../server/ai'
import type { AiProfile } from '../../server/settings'
const profile: AiProfile={id:'test',name:'test',provider:'openai',baseUrl:'https://api.deepseek.com/v1',apiKey:'fake-unit-key',model:'deepseek-flash',jsonMode:true}
afterEach(()=>vi.unstubAllGlobals())
it('uses a small non-thinking DeepSeek-only probe without changing the profile',async()=>{
  const p={...profile,reasoningEffort:'high',extraBody:'{"thinking":{"type":"enabled"},"max_tokens":99999}'}
  const original=JSON.stringify(p)
  const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body))
    expect(body.thinking).toEqual({type:'disabled'})
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.max_tokens).toBeLessThanOrEqual(128)
    expect(init.redirect).toBe('error')
    return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]})
  })
  vi.stubGlobal('fetch',fetcher)
  expect(await testConnection(p)).toMatchObject({ok:true,stage:'complete'})
  expect(JSON.stringify(p)).toBe(original)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('distinguishes accepted but truncated reasoning from failed connectivity',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({choices:[{finish_reason:'length',message:{content:'',reasoning_content:'private reasoning'}}]})))
  const result=await testConnection({...profile,baseUrl:'https://another.example/v1'})
  expect(result).toMatchObject({ok:true,stage:'budget_limited'})
  expect(JSON.stringify(result)).not.toContain('private reasoning')
})
it.each([401,403,404,429])('classifies HTTP %i without retrying',async status=>{
  const fetcher=vi.fn(async()=>Response.json({error:{message:'rejected'}},{status}))
  vi.stubGlobal('fetch',fetcher)
  expect(await testConnection(profile)).toMatchObject({ok:false,stage:status===401||status===403?'authentication':status===404?'model_or_endpoint':'service',httpStatus:status})
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('does not label incompatible envelopes or formatting as full success',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'hello'}}]})))
  expect(await testConnection(profile)).toMatchObject({ok:true,stage:'format_warning'})
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({html:'gateway'})))
  expect(await testConnection(profile)).toMatchObject({ok:false,stage:'response'})
})
it('keeps compatibility retries bounded and reports transport failures',async()=>{
  const fetcher=vi.fn(async()=>Response.json({error:{message:'response_format unsupported'}},{status:400}))
  vi.stubGlobal('fetch',fetcher)
  expect(await testConnection(profile)).toMatchObject({ok:false,stage:'request'})
  expect(fetcher).toHaveBeenCalledTimes(2)
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('network down')}))
  expect(await testConnection(profile)).toMatchObject({ok:false,stage:'transport'})
})

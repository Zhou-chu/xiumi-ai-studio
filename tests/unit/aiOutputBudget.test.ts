import { afterEach, expect, it, vi } from 'vitest'
import { chatText, testConnection } from '../../server/ai'
import type { AiProfile } from '../../server/settings'
const p: AiProfile = {id:'p',name:'P',provider:'openai',baseUrl:'https://api.example/v1',apiKey:'test',model:'m',jsonMode:true,maxOutputTokens:393216}
afterEach(() => vi.unstubAllGlobals())
it('uses the configured generation budget rather than a task fallback', async () => {
  let body: any
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {body=JSON.parse(String(init.body)); return Response.json({choices:[{message:{content:'{}'}}]})})
  await chatText('s','u',{profile:p,defaultMaxTokens:6000})
  expect(body.max_tokens).toBe(393216)
})
it('keeps an explicit capability probe bounded', async () => {
  let body: any
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {body=JSON.parse(String(init.body)); return Response.json({choices:[{message:{content:'{}'}}]})})
  await chatText('s','u',{profile:p,maxTokens:64})
  expect(body.max_tokens).toBe(64)
  await testConnection(p)
  expect(body.max_tokens).toBe(128)
})
it.each(['openai','anthropic'] as const)('uses configured caps for %s and reports actual adapted caps', async(provider) => {
 let body: any; let n=0
 vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {body=JSON.parse(String(init.body));n++; if(n===1)return Response.json({error:{message:'max_tokens maximum 32768'}},{status:400});return Response.json(provider==='anthropic'?{stop_reason:'max_tokens',content:[],usage:{output_tokens:32768}}:{choices:[{finish_reason:'length',message:{content:''}}],usage:{completion_tokens:32768,completion_tokens_details:{reasoning_tokens:30000}}})})
 await expect(chatText('s','u',{profile:{...p,provider},defaultMaxTokens:6000})).rejects.toThrow(/32768.*393216/)
 expect(body.max_tokens).toBe(32768)
})
it.each([0,undefined])('uses fallback only for an unconfigured model (%s)',async(maxOutputTokens)=>{
 let body:any
 vi.stubGlobal('fetch',async(_u:string,init:RequestInit)=>{body=JSON.parse(String(init.body));return Response.json({choices:[{message:{content:'{}'}}]})})
 await chatText('s','u',{profile:{...p,maxOutputTokens},defaultMaxTokens:3000});expect(body.max_tokens).toBe(3000)
})
it('preserves reasoning choice with a large configured output budget',async()=>{
 let body:any
 vi.stubGlobal('fetch',async(_u:string,init:RequestInit)=>{body=JSON.parse(String(init.body));return Response.json({choices:[{message:{content:'{}'}}]})})
 await chatText('s','u',{profile:{...p,reasoningEffort:'high'},defaultMaxTokens:6000})
 expect(body.max_completion_tokens).toBe(393216);expect(body.reasoning_effort).toBe('high');expect(body.thinking).toBeUndefined()
})
import { readFileSync } from 'node:fs'
it('all generation routes use fallback budgets, never fixed probe caps',()=>{
 const source=readFileSync(new URL('../../server/app.ts',import.meta.url),'utf8')
 expect(source.match(/defaultMaxTokens:/g)).toHaveLength(7)
 expect(source).not.toMatch(/chatJson\([^\n]*\{ maxTokens:/)
})

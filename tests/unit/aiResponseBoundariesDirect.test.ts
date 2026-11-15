import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AiProfile } from '../../server/settings'
const h=vi.hoisted(()=>{
 const deny=()=>{throw Error('unexpected AI boundary')}
 return {deny,profile:vi.fn<(id?:string)=>Promise<AiProfile|undefined>>(deny),fetch:vi.fn<typeof fetch>(deny),models:vi.fn(deny)}
})
vi.mock('../../server/settings',()=>({getProfile:h.profile}))
vi.mock('../../server/aiModels',()=>({fetchModels:h.models}))
import { aiStatus, chatJson, chatText } from '../../server/ai'
const config=(p:Partial<AiProfile>={}):AiProfile=>({id:'fixture',name:'Demo',provider:'openai',baseUrl:'https://fixture.invalid/v1',apiKey:'synthetic-token',model:'test',jsonMode:true,...p})
const openai=(content:string,finish_reason='stop')=>Response.json({choices:[{finish_reason,message:{content}}]})
const body=(index:number)=>JSON.parse(String(h.fetch.mock.calls[index][1]?.body))
beforeEach(()=>{
 h.profile.mockReset().mockImplementation(h.deny);h.fetch.mockReset().mockImplementation(h.deny)
 vi.stubGlobal('fetch',h.fetch)
})
afterEach(()=>vi.unstubAllGlobals())

it('reports absent and incomplete profiles without attempting transport',async()=>{
 h.profile.mockResolvedValueOnce(undefined).mockResolvedValueOnce(config({model:''})).mockResolvedValueOnce(config({baseUrl:''}))
 expect(await aiStatus('not-configured')).toEqual({enabled:false,model:'',provider:'',name:'',profileId:''})
 expect(await aiStatus()).toMatchObject({enabled:false,model:''})
 expect(await aiStatus()).toMatchObject({enabled:false,profileId:'fixture'})
 expect(h.profile).toHaveBeenNthCalledWith(1,'not-configured')
 expect(h.fetch).not.toHaveBeenCalled()
})

it('reports key-bearing profiles and keyless local settings without starting model IO',async()=>{
 h.profile.mockResolvedValueOnce(config()).mockResolvedValueOnce(config({baseUrl:'http://localhost:11434/v1',apiKey:''})).mockResolvedValueOnce(config({apiKey:''}))
 expect(await aiStatus()).toEqual({enabled:true,model:'test',provider:'openai',name:'Demo',profileId:'fixture'})
 expect(await aiStatus()).toMatchObject({enabled:true});expect(await aiStatus()).toMatchObject({enabled:false})
 expect(h.fetch).not.toHaveBeenCalled()
})

it('rejects missing resolved profiles with a true unconfigured status before calling fetch',async()=>{
 h.profile.mockResolvedValueOnce(undefined)
 await expect(chatText('system','fixture',{profileId:'not-configured'})).rejects.toMatchObject({status:503})
 expect(h.profile).toHaveBeenCalledExactlyOnceWith('not-configured')
 expect(h.fetch).not.toHaveBeenCalled()
})

it('parses a JSON fence before surrounding prose, handles raw arrays and rejects text with no JSON',async()=>{
 const profile=config()
 h.fetch.mockResolvedValueOnce(openai('notes [old]\n```json\n{"answer":1}\n```\nnotes'))
  .mockResolvedValueOnce(openai('outside [1,2] done')).mockResolvedValueOnce(openai('No JSON in the response'))
 expect(await chatJson('system','fixture',{profile})).toEqual({answer:1})
 expect(await chatJson('system','fixture',{profile})).toEqual([1,2])
 await expect(chatJson('system','fixture',{profile})).rejects.toThrow('AI 没有返回 JSON')
 expect(h.fetch).toHaveBeenCalledTimes(3)
})

it('handles missing Anthropic text blocks and applies an explicit wire temperature when effort is unset',async()=>{
 const profile=config({provider:'anthropic',baseUrl:'https://fixture.invalid/v1/',apiKey:'synthetic-only',jsonMode:false})
 h.fetch.mockResolvedValueOnce(Response.json({content:[{}, {text:'kept'}, {text:' text'}]})).mockResolvedValueOnce(Response.json({}))
 expect(await chatText('system','fixture',{profile,temperature:.15})).toBe('kept text')
 expect(await chatText('system','second',{profile})).toBe('')
 expect(h.fetch.mock.calls[0][0]).toBe('https://fixture.invalid/v1/messages')
 expect(body(0)).toMatchObject({temperature:.15,max_tokens:8000,system:'system'})
 expect(body(0)).not.toHaveProperty('output_config')
 expect(body(1)).toMatchObject({temperature:.4})
})

it('permits an explicitly truncated OpenAI probe and does not add an authorization header to keyless local settings',async()=>{
 const profile=config({baseUrl:'http://127.0.0.1:11434/v1/',apiKey:''})
 h.fetch.mockResolvedValueOnce(openai('partial','length')).mockResolvedValueOnce(Response.json({choices:[]}))
 expect(await chatText('system','fixture',{profile,allowTruncated:true})).toBe('partial')
 expect(await chatText('system','fixture',{profile})).toBe('')
 expect(h.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/chat/completions')
 expect(h.fetch.mock.calls[0][1]?.headers).toEqual({'content-type':'application/json'})
})

it('bounds six distinct compatible output-budget adjustments if every receipt asks for fewer tokens',async()=>{
 const budgets=[4096,3072,2048,1024,768,512]
 for(const limit of budgets) h.fetch.mockResolvedValueOnce(Response.json({error:{message:`maximum output tokens allowed ${limit}`}},{status:400}))
 await expect(chatText('system','fixture',{profile:config(),maxTokens:4500})).rejects.toMatchObject({status:502,message:'AI 请求失败：参数被服务反复拒绝'})
 expect(h.fetch).toHaveBeenCalledTimes(6)
 expect(h.fetch.mock.calls.map((_spec,i)=>body(i).max_tokens)).toEqual([4500,4096,3072,2048,1024,768])
 expect(h.fetch.mock.calls.every(([,opts])=>opts?.redirect==='error')).toBe(true)
})

it.each([null,{message:'simple upstream notice'},'plain upstream notice'])('reports only a bounded upstream error receipt for %j',async receipt=>{
 const serialized=typeof receipt==='string'?receipt:JSON.stringify(receipt)
 h.fetch.mockResolvedValueOnce(new Response(serialized,{status:503}))
 const expected=receipt&&typeof receipt==='object'?receipt.message:serialized
 await expect(chatText('system','fixture',{profile:config()})).rejects.toMatchObject({status:502,message:expect.stringContaining(expected)})
 expect(h.fetch).toHaveBeenCalledOnce()
})

it.each(['https://remote.invalid/localhost/v1','https://localhost.remote.invalid/v1'])('does not classify a remote keyless profile as local merely because its URL contains localhost: %s',async baseUrl=>{
 h.profile.mockResolvedValueOnce(config({baseUrl,apiKey:''}))
 expect(await aiStatus()).toMatchObject({enabled:false})
 expect(h.fetch).not.toHaveBeenCalled()
})

it('recognizes exact localhost/IPv4 over HTTP(S), not malformed input or unsupported schemes',async()=>{
 h.profile.mockResolvedValueOnce(config({baseUrl:'http://127.0.0.1:11434/v1',apiKey:''}))
  .mockResolvedValueOnce(config({baseUrl:'https://localhost:443/v1',apiKey:''}))
  .mockResolvedValueOnce(config({baseUrl:'ftp://localhost/v1',apiKey:''}))
  .mockResolvedValueOnce(config({baseUrl:'unparseable localhost',apiKey:''}))
  .mockResolvedValueOnce(config({baseUrl:'https://remote.invalid/v1',apiKey:'synthetic-key'}))
 for(const enabled of [true,true,false,false,true]) expect(await aiStatus()).toMatchObject({enabled})
 expect(h.fetch).not.toHaveBeenCalled()
})

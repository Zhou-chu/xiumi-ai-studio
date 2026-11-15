import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { testConnection } from '../../server/ai'
import type { AiProfile } from '../../server/settings'
const profile: AiProfile={id:'test',name:'test',provider:'openai',baseUrl:'https://api.deepseek.com/v1',apiKey:'fake-unit-key',model:'deepseek-flash',jsonMode:true}
const boundary = vi.hoisted(() => ({
  read: vi.fn(async () => { throw Error('Unexpected settings read') }),
  write: vi.fn(async () => { throw Error('Unexpected settings write') }),
  fetch: vi.fn(async () => { throw Error('Unexpected transport') }),
}))
vi.mock('../../server/store', () => ({ DATA: 'unused-connection-probe-unit', readJson: boundary.read, writeJson: boundary.write }))
beforeEach(() => {
  for (const guard of Object.values(boundary)) guard.mockClear()
  vi.stubGlobal('fetch', boundary.fetch)
})
afterEach(() => {
  for (const guard of Object.values(boundary)) expect(guard).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
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
it('keeps a local keyless probe keyless and below the selected cap', async () => {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions')
    expect(new Headers(init.headers).has('authorization')).toBe(false)
    expect(new Headers(init.headers).has('x-api-key')).toBe(false)
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ max_tokens: 32, n: 1 })
    expect(body).not.toHaveProperty('thinking')
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await testConnection({ ...profile, baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', maxOutputTokens: 32 })).toMatchObject({ ok: true, stage: 'complete', budgetTokens: 32 })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('does not override the thinking setting for a nonstandard DeepSeek origin', async () => {
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 128, reasoning_effort: 'high', thinking: { type: 'enabled' } })
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await testConnection({ ...profile, baseUrl: 'https://api.deepseek.com:8443/v1', reasoningEffort: 'high', extraBody: '{"thinking":{"type":"enabled"}}' })).toMatchObject({ ok: true, thinkingDisabled: false })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('parses the Anthropic envelope, omits private blocks and uses its own authentication header', async () => {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://api.example/v1/messages')
    const headers = new Headers(init.headers)
    expect(headers.get('x-api-key')).toBe('fake-unit-key')
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(headers.has('authorization')).toBe(false)
    expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 128, output_config: { effort: 'high' } })
    return Response.json({ content: [null, { type: 'thinking', thinking: 'private-block' }, { type: 'text', text: '{"ok":true}' }] })
  })
  vi.stubGlobal('fetch', fetcher)
  const result = await testConnection({ ...profile, provider: 'anthropic', baseUrl: 'https://api.example/v1', reasoningEffort: 'high' })
  expect(result).toMatchObject({ ok: true, stage: 'complete' })
  expect(JSON.stringify(result)).not.toContain('private-block')
})
it('stops at one timeout without a retry and does not reflect transport messages', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('private transport message', 'AbortError')), { once: true })
  }))
  vi.stubGlobal('fetch', fetcher)
  const result = testConnection(profile)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(await result).toMatchObject({ ok: false, stage: 'timeout' })
  expect(JSON.stringify(await result)).not.toContain('private transport message')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(['not-a-url', 'file:///v1', 'https://api.example/v1'])('does not call transport for an unusable configuration: %s', async baseUrl => {
  expect(await testConnection({ ...profile, baseUrl, model: baseUrl.startsWith('https:') ? '' : 'm' })).toMatchObject({ ok: false, stage: 'configuration' })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatJson, discoverModels } from '../../server/ai'
import type { AiProfile } from '../../server/settings'
const profile: AiProfile = { id: 'a', name: 'custom', provider: 'openai', baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'custom-model', jsonMode: true }
afterEach(() => vi.unstubAllGlobals())
describe('model discovery and reasoning', () => {
  it('reads upstream IDs and optional metadata without inventing missing capabilities', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ data: [{ id: 'custom', context_length: 12345, reasoning_efforts: ['low', 'high'] }, { id: 'plain' }, { name: 'invalid' }] }))
    expect(await discoverModels(profile)).toEqual([{ id: 'custom', contextWindow: 12345, reasoningEfforts: ['low', 'high'] }, { id: 'plain' }])
  })
  it('uses the Anthropic models path once when base already ends in v1', async () => {
    let url = ''
    vi.stubGlobal('fetch', async (input: string) => { url = input; return Response.json({ data: [{ id: 'claude' }] }) })
    await discoverModels({ ...profile, provider: 'anthropic' })
    expect(url).toBe('https://example.com/v1/models')
  })
  it('sends explicit custom reasoning effort and omits incompatible temperature', async () => {
    let body: any
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }) })
    await chatJson('system', 'user', { profile: { ...profile, reasoningEffort: 'xhigh' } })
    expect(body.reasoning_effort).toBe('xhigh')
    expect(body.max_completion_tokens).toBe(8000)
    expect(body.max_tokens).toBeUndefined()
    expect(body.temperature).toBeUndefined()
  })
  it('sends Anthropic effort using its native output config', async () => {
    let body: any
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return Response.json({ content: [{ type: 'text', text: '{}' }] }) })
    await chatJson('s', 'u', { profile: { ...profile, provider: 'anthropic', reasoningEffort: 'high' } })
    expect(body.output_config).toEqual({ effort: 'high' })
    expect(body.reasoning_effort).toBeUndefined()
  })
  it('leaves provider defaults alone when no reasoning effort is configured', async () => {
    let body: any
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return Response.json({ choices: [{ message: { content: '{}' } }] }) })
    await chatJson('s', 'u', { profile })
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.temperature).toBe(0.4)
  })
})

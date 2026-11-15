import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { chatText } from '../../server/ai'
import type { AiProfile } from '../../server/settings'

const boundary = vi.hoisted(() => ({
  read: vi.fn(async () => { throw Error('Unexpected settings read') }),
  write: vi.fn(async () => { throw Error('Unexpected settings write') }),
  fetch: vi.fn(async () => { throw Error('Unexpected transport') }),
}))
vi.mock('../../server/store', () => ({ DATA: 'unused-output-budget-unit', readJson: boundary.read, writeJson: boundary.write }))
beforeEach(() => {
  for (const guard of Object.values(boundary)) guard.mockClear()
  vi.stubGlobal('fetch', boundary.fetch)
})
afterEach(() => {
  for (const guard of Object.values(boundary)) expect(guard).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

const profile: AiProfile = { id: 'p', name: 'P', provider: 'openai', baseUrl: 'https://api.example/v1', apiKey: 'fake-test-key', model: 'm', jsonMode: true, maxOutputTokens: 393216 }
const openAIResponse = () => Response.json({ choices: [{ message: { content: '{}' } }] })
function capture(reply: (index: number) => Response) {
  const requests: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    expect(init.redirect).toBe('error')
    requests.push(JSON.parse(String(init.body)))
    return reply(requests.length)
  })
  return requests
}

it('uses the configured generation budget rather than a task fallback or extra-body override', async () => {
  const requests = capture(openAIResponse)
  await chatText('s', 'u', { profile: { ...profile, extraBody: '{"max_tokens":12,"max_completion_tokens":13}' }, defaultMaxTokens: 6000 })
  expect(requests[0]).toMatchObject({ max_tokens: 393216 })
  expect(requests[0]).not.toHaveProperty('max_completion_tokens')
})
it('keeps an explicit capability-probe limit bounded by the profile', async () => {
  const requests = capture(openAIResponse)
  await chatText('s', 'u', { profile, maxTokens: 64 })
  await chatText('s', 'u', { profile: { ...profile, maxOutputTokens: 32 }, maxTokens: 64 })
  expect(requests.map(x => x.max_tokens)).toEqual([64, 32])
})
it.each([0, undefined])('uses the task fallback only when no profile limit is configured (%s)', async (maxOutputTokens) => {
  const requests = capture(openAIResponse)
  await chatText('s', 'u', { profile: { ...profile, maxOutputTokens }, defaultMaxTokens: 3000 })
  await chatText('s', 'u', { profile: { ...profile, maxOutputTokens } })
  expect(requests.map(x => x.max_tokens)).toEqual([3000, 8000])
})
it.each(['openai', 'anthropic'] as const)('reports actual adapted and configured caps for %s without exposing provider material', async (provider) => {
  const sensitive = 'synthetic-private-response'
  const requests = capture(index => index === 1
    ? Response.json({ error: { message: 'max_tokens maximum 32768' } }, { status: 400 })
    : Response.json(provider === 'anthropic'
      ? { stop_reason: 'max_tokens', content: [{ text: sensitive }], usage: { output_tokens: 32768, reasoning: sensitive } }
      : { choices: [{ finish_reason: 'length', message: { content: sensitive } }], usage: { completion_tokens: 32768, completion_tokens_details: { reasoning_tokens: 30000, reasoning: sensitive } } }))
  const pending = chatText('s', 'u', { profile: { ...profile, provider }, defaultMaxTokens: 6000 })
  await expect(pending).rejects.toThrow(/本次请求 32768 tokens，模型设置 393216.*服务返回输出用量 32768/)
  await expect(pending).rejects.not.toThrow(sensitive)
  if (provider === 'openai') await expect(pending).rejects.toThrow(/其中推理 30000/)
  expect(requests.map(x => x.max_tokens)).toEqual([393216, 32768])
})
it('preserves explicit reasoning and keeps each provider’s existing token field', async () => {
  const requests = capture(openAIResponse)
  await chatText('s', 'u', { profile: { ...profile, reasoningEffort: 'high' }, defaultMaxTokens: 6000 })
  await chatText('s', 'u', { profile: { ...profile, baseUrl: 'https://api.openai.com/v1', reasoningEffort: 'high' }, defaultMaxTokens: 6000 })
  expect(requests[0]).toMatchObject({ max_tokens: 393216, reasoning_effort: 'high' })
  expect(requests[0]).not.toHaveProperty('max_completion_tokens')
  expect(requests[1]).toMatchObject({ max_completion_tokens: 393216, reasoning_effort: 'high' })
  expect(requests[1]).not.toHaveProperty('max_tokens')
})
it('does not reflect nonnumeric usage and explains the unconfigured fallback', async () => {
  const requests = capture(() => Response.json({ choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { completion_tokens: 'provider-message', completion_tokens_details: { reasoning_tokens: -1 } } }))
  const pending = chatText('s', 'u', { profile: { ...profile, maxOutputTokens: undefined }, defaultMaxTokens: 6000 })
  await expect(pending).rejects.toThrow(/本次请求 6000 tokens（模型未配置，使用任务默认值）/)
  await expect(pending).rejects.not.toThrow(/provider-message|其中推理/)
  expect(requests[0]?.max_tokens).toBe(6000)
})

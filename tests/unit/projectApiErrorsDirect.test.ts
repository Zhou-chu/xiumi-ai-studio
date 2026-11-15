import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
const deny=()=>{throw Error('Unexpected project API transport')}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(deny)))
afterEach(()=>vi.unstubAllGlobals())
it('rejects malformed successful JSON rather than synthesizing an empty object', async () => {
  const error = new SyntaxError('incomplete JSON')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw error } })))
  await expect(api.projects()).rejects.toBe(error)
})
it.each([{ error: 'specific failure' }, null])('preserves non-success HTTP error handling %j', async data => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, statusText: 'Unavailable', json: async () => { if (data === null) throw new SyntaxError('not JSON'); return data } })))
  await expect(api.projects()).rejects.toThrow(data?.error ?? '503 Unavailable')
})
it.each([204, 205])('preserves explicit %s no-content compatibility', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status, json: async () => { throw new SyntaxError('empty') } })))
  await expect(api.deleteProject('sample')).resolves.toEqual({})
})

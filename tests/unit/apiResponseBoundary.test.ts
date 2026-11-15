import { afterEach, expect, it, vi } from 'vitest'
import { api, ApiError } from '../../src/editor/api'
afterEach(() => vi.unstubAllGlobals())
it.each([new DOMException('body cancelled', 'AbortError'), new SyntaxError('incomplete JSON')])('preserves successful response body failure: %s', async error => {
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => { throw error } }))
  await expect(api.projects()).rejects.toBe(error)
})
it.each([204, 205])('supports bodyless success %s without parsing JSON', async status => {
  const json = vi.fn(async () => { throw new SyntaxError('no body') })
  vi.stubGlobal('fetch', async () => ({ ok: true, status, json }))
  expect(await api.deleteProject('fixture')).toEqual({})
  expect(json).not.toHaveBeenCalled()
})
it.each([null, 'not-json', { error: 'conflict' }])('retains status-based HTTP failure for %j', async body => {
  vi.stubGlobal('fetch', async () => new Response(body === 'not-json' ? body : JSON.stringify(body), { status: 409, statusText: 'Conflict' }))
  await expect(api.projects()).rejects.toMatchObject({ status: 409, message: typeof body === 'object' && body ? 'conflict' : '409 Conflict' })
  await expect(api.projects()).rejects.toBeInstanceOf(ApiError)
})

it('rejects malformed resource identifiers before issuing requests', async () => {
  const fetch = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  const id = 'invalid resource id'
  const doc = { id } as import('../../src/core/types').Doc
  const calls = [
    () => api.cropAsset(id, { x: 0, y: 0, width: 1, height: 1 }), () => api.deleteAsset(id),
    () => api.project(id), () => api.saveProject(doc), () => api.deleteProject(id), () => api.versions(id),
    () => api.saveVersion(doc, 'fixture'), () => api.version(id, 'v'), () => api.version('p', id),
    () => api.deleteTemplate(id), () => api.updateTemplate(id, {}), () => api.updateComponent(id, {}),
    () => api.deleteComponent(id), () => api.deleteTheme(id), () => api.restoreApply(id),
  ]
  for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 400 })
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps accepted project IDs and restore receipts in the expected route', async () => {
  const fetch = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  await api.project('Doc-1_ok')
  await api.restoreApply('backup_fixture-123')
  expect(fetch.mock.calls).toEqual([
    ['/api/projects/Doc-1_ok', { method: 'GET' }],
    ['/api/data/restore/backup_fixture-123/apply', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }],
  ])
})

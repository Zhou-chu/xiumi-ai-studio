// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
import { emptyDoc } from '../../src/editor/store'
beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })))
afterEach(() => vi.unstubAllGlobals())
it.each(['../settings/ai', '..', '.', '%2e%2e', 'a/b', 'a?query', 'a#fragment', 'a\\b', '//evil.test', '', 'a'.repeat(65)])('rejects unsafe resource identifier %j before requesting any endpoint', async id => {
  const doc = { ...emptyDoc(), id }
  const calls = [() => api.cropAsset(id, { x: 0, y: 0, width: 1, height: 1 }), () => api.deleteAsset(id), () => api.project(id), () => api.saveProject(doc), () => api.deleteProject(id), () => api.versions(id), () => api.saveVersion(doc, 'saved'), () => api.version(id, 'v'), () => api.version('p', id), () => api.deleteTemplate(id), () => api.updateTemplate(id, {}), () => api.updateComponent(id, {}), () => api.deleteComponent(id), () => api.deleteTheme(id)]
  for (const call of calls) await expect(call()).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
it('retains the server resource ID grammar for normal requests', async () => {
  await api.project('Doc-1_ok')
  expect(fetch).toHaveBeenCalledWith('/api/projects/Doc-1_ok', { method: 'GET' })
})

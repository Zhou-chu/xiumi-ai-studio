import { expect, it, vi } from 'vitest'
import { seedProject, type FixtureRequest, type FixtureResponse } from '../shell/projectFixture'
function response(status: number, body: unknown): FixtureResponse {
  return { ok: () => status >= 200 && status < 300, status: () => status, json: async () => body }
}
it('repeated seeds and authored-content replacement use each latest revision', async () => {
  let stored: Record<string, unknown> | undefined
  let version = 0
  const request: FixtureRequest = {
    get: vi.fn(async () => response(stored ? 200 : 404, stored)),
    put: vi.fn(async (_url, { data }) => {
      const doc = data as Record<string, unknown>
      if (stored && doc.revision !== stored.revision) return response(409, {})
      stored = { ...doc, revision: `r${++version}` }
      return response(200, { revision: stored.revision })
    }),
  }
  await seedProject(request, { id: 'editorial-shell-fixture', title: 'first' })
  await seedProject(request, { id: 'editorial-shell-fixture', title: 'first' })
  await seedProject(request, { id: 'editorial-shell-fixture', title: 'special', blocks: ['authored HTML'] })
  expect(stored).toEqual({ id: 'editorial-shell-fixture', title: 'special', blocks: ['authored HTML'], revision: 'r3' })
})
it.each([403, 500])('GET %s does not become a create', async status => {
  const request = { get: vi.fn(async () => response(status, {})), put: vi.fn(async () => response(200, {})) }
  await expect(seedProject(request, { id: 'editorial-shell-fixture' })).rejects.toThrow(`GET failed: ${status}`)
  expect(request.put).not.toHaveBeenCalled()
})
it('propagates JSON and network failures without writing', async () => {
  const error = new SyntaxError('body interrupted')
  const request = { get: vi.fn(async () => ({ ...response(200, {}), json: async () => { throw error } })), put: vi.fn(async () => response(200, {})) }
  await expect(seedProject(request, { id: 'editorial-shell-fixture' })).rejects.toBe(error)
  request.get.mockRejectedValueOnce(error)
  await expect(seedProject(request, { id: 'editorial-shell-fixture' })).rejects.toBe(error)
  expect(request.put).not.toHaveBeenCalled()
})
it('reports a concurrent PUT conflict without retrying or deleting', async () => {
  const request = { get: vi.fn(async () => response(200, { id: 'editorial-shell-fixture', revision: 'r1' })), put: vi.fn(async () => response(409, {})) }
  await expect(seedProject(request, { id: 'editorial-shell-fixture' })).rejects.toThrow('PUT failed: 409')
  expect(request.put).toHaveBeenCalledTimes(1)
})
it.each([null, {}, { id: 'different', revision: 'r1' }, { id: 'editorial-shell-fixture' }])('rejects malformed existing fixture %j', async body => {
  const request = { get: vi.fn(async () => response(200, body)), put: vi.fn(async () => response(200, {})) }
  await expect(seedProject(request, { id: 'editorial-shell-fixture' })).rejects.toThrow('Invalid existing fixture')
  expect(request.put).not.toHaveBeenCalled()
})

it('refuses any non-shell project ID before network access', async () => {
  const request = { get: vi.fn(), put: vi.fn() }
  await expect(seedProject(request, { id: 'user-project' })).rejects.toThrow('not allowlisted')
  expect(request.get).not.toHaveBeenCalled()
  expect(request.put).not.toHaveBeenCalled()
})

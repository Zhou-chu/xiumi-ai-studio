import { EventEmitter } from 'node:events'
import type { Server } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const h = vi.hoisted(() => {
  const deny = () => { throw Error('Unexpected launcher adapter side effect') }
  return { read: vi.fn<(path: string, encoding: string) => string>(deny), spawn: vi.fn<(...args: unknown[]) => { unref: () => void }>(deny), fetch: vi.fn<typeof fetch>(deny), deny }
})
vi.mock('node:child_process', () => ({ spawn: h.spawn }))
vi.mock('node:fs', () => ({
  readFileSync: h.read, accessSync: h.deny, mkdirSync: h.deny, rmSync: h.deny, writeFileSync: h.deny,
  constants: { W_OK: 2 },
}))
vi.mock('../../server/paths', () => ({
  APP_ID: 'synthetic-xiumi', DATA: '/virtual-data', LOG_DIR: '/virtual-log', TMP_DIR: '/virtual-temp',
}))
vi.mock('../../server/log', () => ({ addSecret: h.deny, teeConsoleToFile: h.deny }))

const loadAdapters = async () => {
  const orig = process.on.bind(process)
  const skipHooks = vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    if (event === 'uncaughtException' || event === 'unhandledRejection') return process
    return orig(event, listener)
  })
  vi.stubEnv('XIUMI_PACKAGED', undefined)
  try { return await import('../../server/launcher') }
  finally { skipHooks.mockRestore(); vi.unstubAllEnvs() }
}
const { probe, findRunning, listenOnFreePort, openBrowser } = await loadAdapters()
beforeEach(() => {
  h.read.mockReset(); h.spawn.mockReset(); h.fetch.mockReset()
  vi.stubGlobal('fetch', h.fetch); vi.stubEnv('XIUMI_NO_BROWSER', undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('probes only the app-info endpoint with abort signal and accepts the recognized identity', async () => {
  const info = { app: 'synthetic-xiumi', dataDir: '/Different-Data', pid: 111 }
  h.fetch.mockReturnValueOnce(Promise.resolve(Response.json(info)))
  expect(await probe(5279, 999)).toEqual(info)
  expect(h.fetch.mock.calls).toEqual([['http://127.0.0.1:5279/api/app/info', { signal: expect.any(AbortSignal) }]])
})
it('treats wrong application, non-OK, invalid JSON and other probe failures as no running app', async () => {
  h.fetch
    .mockReturnValueOnce(Promise.resolve(Response.json({ app: 'unrelated' })))
    .mockReturnValueOnce(Promise.resolve(new Response(null, { status: 502 })))
    .mockReturnValueOnce(Promise.resolve(new Response('not json')))
    .mockImplementationOnce(() => { throw Error('synthetic unreachable') })
  for (let i = 0; i < 4; i++) await expect(probe(5279)).resolves.toBeNull()
  expect(h.fetch).toHaveBeenCalledTimes(4)
})
it('checks a remembered port first but accepts a probed app only for the same data directory', async () => {
  h.read.mockReturnValueOnce('{"port":6002}')
  const ask = vi.fn<typeof probe>()
    .mockResolvedValueOnce({ app: 'synthetic-xiumi', dataDir: '/other' })
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ app: 'synthetic-xiumi', dataDir: '/FIXTURE' })
  expect(await findRunning('/fixture', [5174, 5175, 5176], ask)).toBe(5175)
  expect(h.read).toHaveBeenCalledExactlyOnceWith(join('/fixture', 'runtime.json'), 'utf8')
  expect(ask.mock.calls).toEqual([[6002, 600], [5174, 600], [5175, 600]])
})
it('tolerates corrupt runtime notes without duplicate probing and does not open a different profile', async () => {
  h.read.mockReturnValueOnce('not json').mockReturnValueOnce('{"port":5174}')
  const ask = vi.fn<typeof probe>().mockResolvedValue({ app: 'synthetic-xiumi' })
  expect(await findRunning('/fixture', [5174], ask)).toBeNull()
  expect(await findRunning('/fixture', [5174], ask)).toBeNull()
  expect(ask.mock.calls).toEqual([[5174, 600], [5174, 600]])
})

function fakeServer(outcomes: (string | undefined)[]) {
  const emitter = new EventEmitter()
  const listen = vi.fn((_port: number, _host: string) => {
    if (!outcomes.length) throw Error('Unscripted virtual listen')
    const error = outcomes.shift()
    queueMicrotask(() => {
      if (error) emitter.emit('error', Object.assign(Error('synthetic bind'), { code: error }))
      else emitter.emit('listening')
    })
  })
  return { listen, emitter, server: Object.assign(emitter, { listen }) as unknown as Server }
}
it('skips occupied or inaccessible listener ports, binds loopback only, and removes temporary listeners', async () => {
  const { server, listen, emitter } = fakeServer(['EADDRINUSE', 'EACCES', undefined])
  expect(await listenOnFreePort(server, [5174, 5175, 5176])).toBe(5176)
  expect(listen.mock.calls).toEqual([[5174, '127.0.0.1'], [5175, '127.0.0.1'], [5176, '127.0.0.1']])
  expect(emitter.eventNames()).toEqual([])
})
it('distinguishes exhausted candidates from unexpected listener errors without trying later ports', async () => {
  const full = fakeServer(['EADDRINUSE', 'EADDRINUSE'])
  await expect(listenOnFreePort(full.server, [5174, 5175])).rejects.toMatchObject({ code: 'NO_PORT', message: expect.stringContaining('5174–5175') })
  const unexpected = fakeServer(['EIO', undefined])
  await expect(listenOnFreePort(unexpected.server, [5174, 5175])).rejects.toMatchObject({ code: 'EIO' })
  expect(unexpected.listen).toHaveBeenCalledExactlyOnceWith(5174, '127.0.0.1')
  expect(full.emitter.eventNames()).toEqual([])
  expect(unexpected.emitter.eventNames()).toEqual([])
})
it('honors no-browser mode and otherwise forwards one literal URL to the OS adapter without a shell', () => {
  const url = 'http://127.0.0.1:5253/?q=synthetic%20fixture'
  vi.stubEnv('XIUMI_NO_BROWSER', '1')
  openBrowser(url)
  expect(h.spawn).not.toHaveBeenCalled()
  const unref = vi.fn()
  h.spawn.mockReturnValueOnce({ unref })
  vi.stubEnv('XIUMI_NO_BROWSER', undefined)
  openBrowser(url)
  expect(h.spawn.mock.calls).toEqual([['rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }]])
  expect(unref).toHaveBeenCalledOnce()
})

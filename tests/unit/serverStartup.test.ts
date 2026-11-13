import { afterEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ listen: vi.fn(), createApp: vi.fn(), aiStatus: vi.fn(), wechatStatus: vi.fn(), ready: Promise.resolve() }))
vi.mock('../../server/app', () => ({ createApp: mock.createApp }))
vi.mock('../../server/store', () => ({ ROOT: '/isolated-unit-root' }))
vi.mock('../../server/ai', () => ({ aiStatus: mock.aiStatus }))
vi.mock('../../server/wechat', () => ({ wechatStatus: mock.wechatStatus }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('server startup wiring', () => {
  it.each([true, false])('preserves loopback binding and status logging (configured=%s)', async configured => {
    vi.resetModules(); vi.clearAllMocks()
    const load=vi.spyOn(process,'loadEnvFile').mockImplementation(() => { if(!configured) throw Error('missing') })
    const log=vi.spyOn(console,'log').mockImplementation(()=>{})
    if(configured) vi.stubEnv('API_PORT','6543'); else vi.stubEnv('API_PORT',undefined)
    mock.aiStatus.mockResolvedValue({enabled:configured,name:'fake profile',model:'fake model'})
    mock.wechatStatus.mockReturnValue({configured})
    mock.listen.mockImplementation((_port,_host,callback)=>{mock.ready=callback();return {}})
    mock.createApp.mockReturnValue({listen:mock.listen})
    await import('../../server/index');await mock.ready
    expect(load).toHaveBeenCalledTimes(1)
    expect(mock.listen).toHaveBeenCalledWith(configured?6543:5174,'127.0.0.1',expect.any(Function))
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`http://127.0.0.1:${configured?6543:5174}`))
    if(configured) expect(log).toHaveBeenCalledWith(expect.stringContaining('fake profile / fake model'))
  })
})

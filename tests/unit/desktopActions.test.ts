import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDesktopActions } from '../../server/desktopActions'

const origin = 'http://127.0.0.1:5174'
const dataDir = resolve('test-owned/xiumi data')
const logDir = resolve('test-owned/xiumi logs')
const getHeaders = { host: '127.0.0.1:5174', 'sec-fetch-site': 'same-origin' }
const postHeaders = { ...getHeaders, origin }

function setup(logs: string | undefined = logDir) {
  const openFolder = vi.fn(async (_folder: string) => {})
  return {
    openFolder,
    actions: createDesktopActions({ origin, dataDir, logDir: logs, openFolder }),
  }
}

describe('owned desktop folder actions', () => {
  it('returns only configured folder actions to same-origin browser requests', () => {
    const { actions } = setup()
    expect(actions.info(getHeaders)).toEqual({ dataDir, logDir, canOpenFolder: true })
    for (const headers of [
      { host: '127.0.0.1:5174' },
      { ...getHeaders, host: '127.0.0.1:9184' },
      { ...getHeaders, 'sec-fetch-site': 'cross-site' },
      { ...getHeaders, origin: 'http://127.0.0.1:9184' },
    ]) expect(() => actions.info(headers)).toThrow(expect.objectContaining({ status: 403 }))
  })

  it('opens exactly the fixed folder supplied by the application', async () => {
    const { actions, openFolder } = setup()
    await expect(actions.open(postHeaders, 'data')).resolves.toEqual({ opened: true, path: dataDir })
    await expect(actions.open(postHeaders, 'logs')).resolves.toEqual({ opened: true, path: logDir })
    expect(openFolder.mock.calls).toEqual([[dataDir], [logDir]])
    for (const target of [undefined, {}, '/other/folder', 'env']) {
      await expect(actions.open(postHeaders, target)).rejects.toMatchObject({ status: 400 })
    }
    expect(openFolder).toHaveBeenCalledTimes(2)
  })

  it('does not open anything if the origin is missing or from another local app', async () => {
    const { actions, openFolder } = setup()
    for (const headers of [getHeaders, { ...postHeaders, origin: 'http://127.0.0.1:9184' }]) {
      await expect(actions.open(headers, 'data')).rejects.toMatchObject({ status: 403 })
    }
    expect(openFolder).not.toHaveBeenCalled()
  })

  it('does not offer non-existent capabilities or path guessing', async () => {
    const openFolder = vi.fn(async (_folder: string) => {})
    const actions = createDesktopActions({ origin, dataDir, openFolder })
    expect(actions.info(getHeaders)).toEqual({ dataDir, logDir: null, canOpenFolder: true })
    await expect(actions.open(postHeaders, 'logs')).rejects.toMatchObject({ status: 404 })
    expect(openFolder).not.toHaveBeenCalled()
    const disabled = createDesktopActions({ origin, dataDir })
    expect(disabled.info(getHeaders).canOpenFolder).toBe(false)
    await expect(disabled.open(postHeaders, 'data')).rejects.toMatchObject({ status: 404 })
  })

  it('requires a directly bound loopback origin and absolute configured folders', () => {
    for (const badOrigin of ['https://example.com', 'http://127.0.0.1', origin + '/folder']) {
      expect(() => createDesktopActions({ origin: badOrigin, dataDir })).toThrow()
    }
    expect(() => createDesktopActions({ origin, dataDir: 'relative/data' })).toThrow()
  })
})

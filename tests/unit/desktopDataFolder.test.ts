// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DesktopDataFolder } from '../../src/editor/DesktopDataFolder'

let root: Root
let host: HTMLDivElement
const reportFailure = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  reportFailure.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function mount() {
  await act(async () => {
    root.render(createElement(DesktopDataFolder, { reportFailure }))
  })
}

it.each([
  () => new Response('', { status: 404 }),
  () => Response.json({ canOpenFolder: false }),
  () => Response.json({ canOpenFolder: 'true' }),
])('never offers a desktop action without positive platform capability', async response => {
  const fetcher = vi.fn(async () => response())
  vi.stubGlobal('fetch', fetcher)
  await mount()
  expect(host.querySelector('button')).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith('/api/app/info', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(reportFailure).not.toHaveBeenCalled()
})

it('offers the owned data folder action and submits only the fixed target on click', async () => {
  const fetcher = vi.fn(async (path: string) => path.endsWith('/info')
    ? Response.json({ canOpenFolder: true })
    : Response.json({ opened: true }))
  vi.stubGlobal('fetch', fetcher)
  await mount()
  const action = host.querySelector('button')
  expect(action?.textContent).toBe('打开数据目录')
  await act(async () => action?.click())
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher).toHaveBeenNthCalledWith(2, '/api/app/open', expect.objectContaining({
    method: 'POST',
    body: '{"target":"data"}',
  }))
  expect(reportFailure).not.toHaveBeenCalled()
})

it('reports a failed open, then allows an explicit retry', async () => {
  const fetcher = vi.fn(async (path: string) => path.endsWith('/info')
    ? Response.json({ canOpenFolder: true })
    : new Response('', { status: 500 }))
  vi.stubGlobal('fetch', fetcher)
  await mount()
  const action = host.querySelector('button')
  await act(async () => action?.click())
  expect(reportFailure).toHaveBeenCalledWith('无法打开数据目录，请检查当前安装后重试。')
  expect(action?.disabled).toBe(false)
  await act(async () => action?.click())
  expect(fetcher).toHaveBeenCalledTimes(3)
})

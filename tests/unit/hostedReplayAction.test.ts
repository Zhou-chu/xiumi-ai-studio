// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { defaultReplay, makeItem, makeScene } from '../../src/core/replay/schema'
import type { Doc } from '../../src/core/types'
import { useHostedReplayAction } from '../../src/editor/useHostedReplayAction'

const token = 'a'.repeat(64)
const media = '/media/fixture.png'
const png = { id: 'fixture', file: 'fixture.png' }
const rootPath = '/api/replay/hosted-xiumi/'
const reply = (value: unknown) => new Response(JSON.stringify(value))
const raster = defaultReplay()
raster.scenes = [makeScene([ makeItem('image', { image: { src: media, assetId: png.id } }) ])]
const doc: Doc = {
  id: 'witness', title: 'Synthetic witness', author: '', digest: '', createdAt: 1, updatedAt: 1, themeId: 'tsinghua-purple',
  blocks: [{ id: 'replay', type: 'replay', props: raster }],
}

it('mounts quietly, then makes only approved stage transitions and keeps the final download separate', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/assets') return reply([png])
    if (url === rootPath + 'prepare') return reply({ token, images: JSON.parse(init!.body as string).sources.length })
    if (url === rootPath + 'cancel') return new Response(null, { status: 204 })
    if (url === rootPath + 'transfer') return reply({ mapping: { [media + '?w=1500']: 'https://mmbiz.qpic.cn/mock/p/0' } })
    throw new Error('Unexpected request ' + url)
  })
  vi.stubGlobal('fetch', fetch)
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(false)
  vi.stubGlobal('confirm', confirm)
  const notify = vi.fn()
  const root = createRoot(document.createElement('div'))
  let use: ReturnType<typeof useHostedReplayAction>
  function Harness({ enabled }: { enabled: boolean }) {
    use = useHostedReplayAction({ doc, safeName: 'fixture', notify, enabled })
    return createElement('span', {}, use[0])
  }
  try {
    await act(async () => root.render(createElement(Harness, { enabled: false })))
    await act(async () => use[1]())
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => root.render(createElement(Harness, { enabled: true })))
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => use[1]())
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/assets', rootPath + 'prepare', rootPath + 'cancel'])
    expect(confirm.mock.calls[0][0]).toContain('微信公众平台图床')
    await act(async () => use[1]())
    expect(fetch.mock.calls.slice(-3).map(([url]) => url)).toEqual(['/api/assets', rootPath + 'prepare', rootPath + 'transfer'])
    expect(confirm.mock.calls[2][0]).toContain('实际分包为 1 份')
    expect(notify).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})

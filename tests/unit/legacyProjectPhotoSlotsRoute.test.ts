import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { docToMarkdown } from '../../src/core/exporters'
import { variantUrl } from '../../src/core/managedMediaUrl'
import type { Block, Doc } from '../../src/core/types'

async function withLibrary<T>(run: (base: string, data: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-project-photos-'))
  const data = join(dir, 'data')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: dir })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback port')
    return await run('http://127.0.0.1:' + address.port, data)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  }
}

const json = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

it('restores an edited native photo manuscript and a history-only managed raster from its real ZIP', async () => {
  const { archive, live, earlier, file, source, version } = await withLibrary(async (base, data) => {
    const { emptyDoc, useStore, saveNow } = await import('../../src/editor/store')
    const { api, assetRef } = await import('../../src/editor/api')
    const request = globalThis.fetch
    const client = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      request(typeof input === 'string' && input.startsWith('/') ? base + input : input, init))
    let result
    try {
      const colours = ['#4485c5', '#de6025']
      const files = await Promise.all(colours.map(async (background, i) => {
        const bytes = await sharp({ create: { width: 10, height: 9, channels: 3, background } }).png().toBuffer()
        return new File([new Uint8Array(bytes)], 'article-slot-' + i + '.png', { type: 'image/png' })
      }))
      const assets = await api.uploadAssets(files)
      const [live, earlier] = assets.map(assetRef)
      const block: Block<'photos'> = { id: 'article-photos', type: 'photos', props: {
        count: 3, ratio: '1:1', layout: 'even',
        pics: [{ image: live, caption: 'First <em>& [text]*' }, { caption: 'Empty middle' }, { caption: 'Last empty' }],
      } }
      const source = { ...emptyDoc(), id: 'photo-article', title: 'Photo article edited', blocks: [block] }
      useStore.getState().load(source)
      expect(await saveNow()).toBe(true)
      const history: Block<'photos'> = { ...block, props: { ...block.props, pics: [{ caption: 'Historical empty' }, { image: earlier, caption: 'Historical only' }, { caption: 'Last empty' }] } }
      const versionResponse = await fetch(base + '/api/projects/' + source.id + '/versions', {
        method: 'POST', ...json({ label: 'Before photo edit', doc: { ...source, blocks: [history] } }),
      })
      expect(versionResponse.status).toBe(200)
      const version = await versionResponse.json()
      const empty = { ...source, id: 'photo-empty', blocks: [{ ...block, props: { ...block.props, pics: [{ caption: 'First placeholder' }, { caption: '' }, { caption: '' }] } }] }
      const malformed = { ...empty, id: 'photo-invalid', blocks: [{ ...block, props: { ...block.props, pics: [{ image: null, caption: 'Invalid slot' }, { caption: '' }, { caption: '' }] } }] }
      const starter = emptyDoc()
      const control = { ...starter, id: 'heading-control', blocks: [starter.blocks[1]] }
      for (const item of [empty, malformed, control]) expect((await fetch(base + '/api/projects/' + item.id, { method: 'PUT', ...json(item) })).ok).toBe(true)
      const response = await fetch(base + '/api/data/backup')
      expect(response.status).toBe(200)
      result = { archive: await response.blob(), live, earlier, file: await Promise.all(assets.map(asset => readFile(join(data, 'assets', asset.file)))), source, version }
    } finally {
      client.mockRestore()
    }
    return result
  })
  await withLibrary(async (base, data) => {
    const route = base + '/api/data/restore'
    const form = new FormData()
    form.append('file', archive, 'project-photos-library.zip')
    const response = await fetch(route + '?indexedImages=1', { method: 'POST', body: form })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual([])
    expect([...plan.projects.add].sort()).toEqual(['heading-control', 'photo-article', 'photo-empty'])
    expect(plan.projects.unsupported).toEqual(['photo-invalid'])
    expect([...plan.assets.add].sort()).toEqual([live.assetId, earlier.assetId].sort())
    const applied = await fetch(route + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
    })
    expect(applied.status).toBe(200)
    const restored = await applied.json()
    expect(restored.versions.restored).toEqual([source.id + '/' + version.id])
    const project = base + '/api/projects/' + source.id
    const opened: Doc = await (await fetch(project)).json()
    const history: { doc: Doc } = await (await fetch(project + '/versions/' + version.id)).json()
    for (const [i, doc] of [opened, history.doc].entries()) {
      const block = doc.blocks[0] as Block<'photos'>
      expect(block.props.pics.map(pic => pic.caption)).toEqual(i === 0 ? ['First <em>& [text]*', 'Empty middle', 'Last empty'] : ['Historical empty', 'Historical only', 'Last empty'])
      const img = block.props.pics[i].image!
      expect(img.assetId).toBe(i === 0 ? live.assetId : earlier.assetId)
      expect(img.src).toMatch(/\?gen=[a-f0-9]{64}$/)
      expect(Buffer.from(await (await fetch(base + variantUrl(img.src, undefined, 2400))).arrayBuffer())).toEqual(file[i])
      if (i === 0) {
        expect(compileDoc(doc).html).toContain('First &lt;em&gt;&amp; [text]*')
        const markdown = docToMarkdown(doc)
        expect(markdown).not.toContain('<em>')
        expect(markdown).toContain('First &lt;em&gt;&amp;')
      } else expect(compileDoc(doc).html).toContain(block.props.pics[i].caption)
    }
  })
}, 20_000)

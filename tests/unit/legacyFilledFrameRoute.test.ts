import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { docToMarkdown } from '../../src/core/exporters'
import { variantUrl } from '../../src/core/managedMediaUrl'
import type { Block, Doc } from '../../src/core/types'

it('restores a genuine image frame ZIP including its distinct history-only asset', async () => {
  const bytes = await readFile(new URL('../fixtures/legacy-backup/upstream-filled-frame.zip', import.meta.url))
  const archive = unzipSync(new Uint8Array(bytes))
  const projectId = 'native-upstream-frame'
  const [historyPath] = Object.keys(archive).filter(path => path.startsWith('versions/' + projectId + '/'))
  const historyId = historyPath.split('/').at(-1)!.slice(0, -5)
  const archived: Doc = JSON.parse(Buffer.from(archive['projects/' + projectId + '.json']).toString('utf8'))
  const historical: { doc: Doc } = JSON.parse(Buffer.from(archive[historyPath]).toString('utf8'))
  const scratch = await mkdtemp(join(tmpdir(), 'xiumi-project-frame-'))
  const data = join(scratch, 'data')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: scratch })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback port')
    const base = 'http://127.0.0.1:' + address.port
    const route = base + '/api/data/restore'
    const preview = (query = '', cookie = '') => {
      const form = new FormData()
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), 'upstream-filled-frame.zip')
      return fetch(route + query, { method: 'POST', headers: { Cookie: cookie }, body: form })
    }
    const noImages = await preview()
    expect(noImages.status).toBe(200)
    expect((await noImages.json()).plan.projects.unsupported).toEqual([projectId])
    const response = await preview('?indexedImages=1', noImages.headers.get('set-cookie')!.split(';', 1)[0])
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual([])
    const frames = [archived, historical.doc].map(doc => doc.blocks[0] as Block<'frame'>)
    expect(plan.projects.add).toEqual([projectId])
    expect(plan.projects.unsupported).toEqual([])
    expect(plan.versions.add).toEqual([projectId + '/' + historyId])
    expect(plan.assets.add.sort()).toEqual(frames.map(frame => frame.props.image!.assetId).sort())
    const applied = await fetch(route + '/' + token + '/apply', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ confirm: true }) })
    expect(applied.status).toBe(200)
    const result = await applied.json()
    expect(result.projects.restored).toEqual([projectId])
    expect(result.versions.restored).toEqual([projectId + '/' + historyId])
    const projectRoute = base + '/api/projects/' + projectId
    const current = await fetch(projectRoute)
    const prior = await fetch(projectRoute + '/versions/' + historyId)
    expect(current.ok && prior.ok).toBe(true)
    const restored: Doc[] = [await current.json(), (await prior.json()).doc]
    for (const [i, doc] of restored.entries()) {
      const expected = frames[i]
      const frame = doc.blocks[0] as Block<'frame'>
      expect(frame.type).toBe('frame')
      const { image, ...layout } = frame.props
      const { image: originalImage, ...originalLayout } = expected.props
      expect(frame.id).toBe(expected.id)
      expect(layout).toEqual(originalLayout)
      const file = originalImage!.src.slice('/media/'.length)
      expect(image!.src).toMatch(/\?gen=[a-f0-9]{64}$/)
      expect({ ...image, src: image!.src.split('?')[0] }).toEqual(originalImage)
      const served = await fetch(base + variantUrl(image!.src, undefined, 2400))
      expect(served.ok).toBe(true)
      expect(Buffer.from(await served.arrayBuffer())).toEqual(Buffer.from(archive['assets/' + file]))
      if (i === 0) expect(docToMarkdown(doc)).toContain(String.raw`Current ticket caption \[archived\]`)
      const rendered = compileDoc(doc).html
      expect(rendered).toContain(layout.caption)
      expect(rendered).toContain(layout.label)
      expect(rendered).toContain(image!.src.split('?')[0])
      expect(rendered).toContain(image!.src.split('?')[1])
      expect(rendered).toContain(i === 0 ? 'TSINGHUA EEA' : 'border-top:2px solid')
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(scratch, { recursive: true, force: true })
  }
}, 20_000)

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileDoc, compileReplay } from '../../src/core/compiler'
import type { Block, Doc } from '../../src/core/types'

async function library<T>(work:(url:string,data:string)=>Promise<T>) {
  const dir=await mkdtemp(join(tmpdir(),'replay-restore-isolated-'))
  const data=join(dir,'data')
  vi.stubEnv('DATA_DIR',data)
  vi.resetModules()
  const {createApp}=await import('../../server/app')
  const server=createServer(createApp({restoreTempRoot:dir})).listen(0,'127.0.0.1')
  try {
    await once(server,'listening')
    const address=server.address()
    if (!address || typeof address==='string') throw new Error('address')
    return await work('http://127.0.0.1:'+address.port,data)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(r=>server.close(()=>r()))
    vi.unstubAllEnvs()
    await rm(dir,{recursive:true,force:true})
  }
}

it('round-trips an editable native replay and skips unsupported replay shapes in a genuine backup', async () => {
  const { archive, docs, rejected } = await library(async base => {
    const { emptyDoc, useStore, saveNow } = await import('../../src/editor/store')
    const original = globalThis.fetch
    const client = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      original(typeof input === 'string' && input.startsWith('/') ? base + input : input, init))
    try {
      const replay = createBlock('replay')
      const edited = structuredClone(replay)
      edited.props.scenes[0].items[1].content = 'Archive & edit'
      edited.props.theme.accent = '#a0b1c2'
      // The pinned upstream editor defaults to image; preserve the original mode in project data.
      edited.props.textMode = 'image'
      const docs: Doc[] = [
        { ...emptyDoc(), id: 'audit-replay-starter', blocks: [replay] },
        { ...emptyDoc(), id: 'audit-replay-edited', blocks: [edited] },
        { ...emptyDoc(), id: 'audit-replay-control', blocks: [createBlock('heading')] },
      ]
      for (const doc of docs) {
        useStore.getState().load(doc)
        expect(await saveNow()).toBe(true)
      }
      const modified = (change: (block: Block<'replay'>) => unknown) => change(structuredClone(replay))
      const negative = {
        'audit-replay-media': [modified(b => ({ ...b, props: { ...b.props,
          canvas: { ...b.props.canvas, background: { type: 'image', value: '#071226', image: { src: '/media/fixture.png' } } } } }))],
        'audit-replay-trigger': [modified(b => ({ ...b, props: { ...b.props,
          playback: { ...b.props.playback, trigger: 'tap', triggerId: 'article-start' } } }))],
        'audit-replay-glyphs': [modified(b => ({ ...b, props: { ...b.props, glyphs: { demo: { A: { d: 'M0 0 L1 1', adv: 1 } } } } }))],
        'audit-replay-extra': [modified(b => ({ ...b, props: { ...b.props, extra: 'not part of the schema' } }))],
        'audit-replay-duplicate': [modified(b => {
          b.props.scenes[0].items[1].id = b.props.scenes[0].items[0].id
          return b
        })],
        'audit-replay-long': [modified(b => {
          b.props.scenes[0].items[1].content = 'x'.repeat(2001)
          return b
        })],
        'audit-replay-duplicate-scenes': [modified(b => {
          b.props.scenes.push(structuredClone(b.props.scenes[0]))
          return b
        })],
        'audit-replay-many-scenes': [modified(b => {
          // Seven items fit the aggregate budget, so only the scene cap excludes this.
          const scene = (id: string) => ({ ...b.props.scenes[0], id, items: [b.props.scenes[0].items[0]] })
          b.props.scenes.push(scene('second'), scene('third'), scene('fourth'))
          return b
        })],
        'audit-replay-many-items': [modified(b => {
          const scene = structuredClone(b.props.scenes[0])
          scene.id = 'second'
          scene.items.push({ ...scene.items[0], id: 'extra' })
          b.props.scenes.push(scene)
          return b
        })],
        'audit-replay-three-many-items': [modified(b => {
          const scene = (id: string, count: number) => ({ ...b.props.scenes[0], id, items: b.props.scenes[0].items.slice(0, count) })
          b.props.scenes.push(scene('second', 3), scene('third', 2))
          return b
        })],
        'audit-replay-later-scene-image': [modified(b => {
          b.props.scenes.push({ ...b.props.scenes[0], id: 'second', items: [{ id: 'later-image', type: 'image', content: '' }] })
          return b
        })],
        'audit-replay-count': [replay, { ...edited, id: 'second-replay' }],
      }
      for (const [id, blocks] of Object.entries(negative)) {
        const saved = await fetch(base + '/api/projects/' + id, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...docs[0], id, blocks }),
        })
        expect(saved.status).toBe(200)
      }
      const backup = await fetch(base + '/api/data/backup')
      expect(backup.ok).toBe(true)
      return { archive: await backup.blob(), docs, rejected: Object.keys(negative).sort() }
    } finally { client.mockRestore() }
  })
  await library(async (base, data) => {
    const route = base + '/api/data/restore'
    const form = new FormData()
    form.append('file', archive, 'native-replay.zip')
    const response = await fetch(route, { method: 'POST', body: form })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect([...plan.projects.add].sort()).toEqual(docs.map(doc => doc.id).sort())
    expect([...plan.projects.unsupported].sort()).toEqual(rejected)
    const applied = await fetch(route + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
    })
    expect(applied.status).toBe(200)
    expect((await applied.json()).projects.restored.sort()).toEqual(docs.map(doc => doc.id).sort())
    for (const source of docs) {
      const opened = await fetch(base + '/api/projects/' + source.id)
      expect(opened.status).toBe(200)
      const actual: Doc = await opened.json()
      expect(actual.blocks).toEqual(source.blocks)
      expect(compileDoc(actual).html).toBe(compileDoc(source).html)
      if (source.id === 'audit-replay-control') continue
      const html = compileDoc(actual).html
      expect(html).toContain('<svg')
      expect(html).toContain('<animate')
      expect(html).not.toContain('<image')
    }
  })
}, 20_000)

it('restores both ordered text scenes from the pinned upstream writer without changing compiled output', async () => {
  const archive = await readFile(new URL('../fixtures/legacy-backup/upstream-two-scene-replay.zip', import.meta.url))
  const digest = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')
  expect(digest(archive)).toBe('7ad51f2d433aa242e8f3d9eea88d5ea2e908a24fd15a6f616e0d5f8f9a43b4fb')
  const projectId = 'upstream-two-scene-replay'
  const project = JSON.parse(new TextDecoder().decode(unzipSync(archive)['projects/' + projectId + '.json'])) as Doc
  await library(async (base, data) => {
    const route = base + '/api/data/restore'
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(archive)]), 'upstream-two-scene-replay.zip')
    const response = await fetch(route, { method: 'POST', body: form })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(plan.projects.add).toEqual([projectId])
    expect(plan.projects.unsupported).toEqual([])
    const applied = await fetch(route + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
    })
    expect(applied.status).toBe(200)
    expect((await applied.json()).projects.restored).toEqual([projectId])
    const opened = await fetch(base + '/api/projects/' + projectId)
    expect(opened.status).toBe(200)
    const actual: Doc = await opened.json()
    expect(actual.blocks).toEqual(project.blocks)
    const replay = actual.blocks[0] as Block<'replay'>
    expect(replay.props.scenes.map(scene => scene.id)).toEqual(['opening', 'closing'])
    const html = compileDoc(actual).html
    expect(html.match(/<svg\b/g)).toHaveLength(2)
    expect(digest(html)).toBe('86632a3462d300129140cd08597ea888f584778a6717222b149f4f4bc1739e96')
  })
}, 20_000)


it('restores three native automatic scenes in order with identical HTML and independent clocks', async () => {
  const file = 'upstream-three-scene-replay.zip'
  const archive = await readFile(new URL('../fixtures/legacy-backup/' + file, import.meta.url))
  const digest = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')
  expect(digest(archive)).toBe('cf3a84108c0c9ba367fa15e32cbdf9cb6643780ef775b13aa43363c6f397e763')
  const projectId = 'upstream-three-scene-replay'
  const project = JSON.parse(new TextDecoder().decode(unzipSync(archive)['projects/' + projectId + '.json'])) as Doc
  await library(async (base, data) => {
    const route = base + '/api/data/restore'
    const projectUrl = base + '/api/projects/' + projectId
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(archive)]), file)
    const response = await fetch(route, { method: 'POST', body: form })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual([])
    expect((await fetch(projectUrl)).status).toBe(404)
    expect(plan.projects.add).toEqual([projectId])
    expect(plan.projects.unsupported).toEqual([])
    const applied = await fetch(route + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
    })
    expect(applied.status).toBe(200)
    expect((await applied.json()).projects.restored).toEqual([projectId])
    const opened = await fetch(projectUrl)
    expect(opened.status).toBe(200)
    const actual: Doc = await opened.json()
    expect(actual.blocks).toEqual(project.blocks)
    const replay = actual.blocks[0] as Block<'replay'>
    expect(replay.props.scenes.map(scene => scene.id)).toEqual(['opening', 'middle', 'closing'])
    expect(replay.props.scenes.flatMap(scene => scene.items)).toHaveLength(8)
    const output = compileReplay(replay)
    expect(output.errors).toEqual([])
    expect(output.scenes.map(scene => scene.timeline.items[0].tStart)).toEqual([0.3, 0.3, 0.3])
    expect(output.scenes.map(scene => scene.bytes).every(bytes => bytes <= 80 * 1024)).toBe(true)
    expect(output.scenes.reduce((sum, scene) => sum + scene.bytes, 0)).toBeLessThanOrEqual(400 * 1024)
    const html = compileDoc(actual).html
    expect(html.match(/<svg\b/g)).toHaveLength(3)
    expect(digest(html)).toBe('bc7a4dd8c49916c7f2c33fb86efd681d0054ed2c460a26185fc460dc118040dc')
  })
}, 20_000)

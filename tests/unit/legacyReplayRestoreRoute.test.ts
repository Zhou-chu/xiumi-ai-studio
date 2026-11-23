import { once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
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

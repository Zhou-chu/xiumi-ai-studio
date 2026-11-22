import { once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { docToMarkdown } from '../../src/core/exporters'
import type { Doc } from '../../src/core/types'

async function library<T>(work:(url:string,data:string)=>Promise<T>) {
  const dir=await mkdtemp(join(tmpdir(),'matrix-isolated-'))
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

it('round-trips blank native image and frame with no media', async () => {
  const { archive, docs } = await library(async (base) => {
    const { emptyDoc, useStore, saveNow } = await import('../../src/editor/store')
    const original = globalThis.fetch
    const client = vi.spyOn(globalThis, 'fetch').mockImplementation((input,init) =>
      original(typeof input === 'string' && input.startsWith('/') ? base + input : input, init))
    try {
      const image = createBlock('image', { caption: '<em>& [text]*' })
      const frame = createBlock('frame', { caption: '<em>& [label]*', label: 'FRAME & [label]' })
      const docs: Doc[] = [
        { ...emptyDoc(), id: 'audit-image', blocks: [image] },
        { ...emptyDoc(), id: 'audit-frame', blocks: [frame] },
        { ...emptyDoc(), id: 'audit-heading', blocks: [createBlock('heading')] },
      ]
      for (const doc of docs) {
        useStore.getState().load(doc)
        expect(await saveNow()).toBe(true)
      }
      const negatives = [
        { ...docs[0], id: 'audit-image-null', blocks: [{ ...image, props: { ...image.props, image: null } }] },
        { ...docs[1], id: 'audit-frame-null', blocks: [{ ...frame, props: { ...frame.props, image: null } }] },
        { ...docs[0], id: 'audit-image-long', blocks: [{ ...image, props: { ...image.props, caption: 'x'.repeat(2001) } }] },
        { ...docs[1], id: 'audit-frame-variant', blocks: [{ ...frame, props: { ...frame.props, variant: 'unsupported' } }] },
      ]
      for (const doc of negatives) {
        expect((await fetch(base + '/api/projects/' + doc.id, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
        })).ok).toBe(true)
      }
      const backup = await fetch(base + '/api/data/backup')
      expect(backup.ok).toBe(true)
      return { archive: await backup.blob(), docs }
    } finally { client.mockRestore() }
  })
  await library(async (base, data) => {
    const route = base + '/api/data/restore'
    const form = new FormData()
    form.append('file', archive, 'blank-media-layouts.zip')
    const response = await fetch(route, { method: 'POST', body: form })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect([...plan.projects.add].sort()).toEqual(['audit-frame', 'audit-heading', 'audit-image'])
    expect([...plan.projects.unsupported].sort()).toEqual(['audit-frame-null', 'audit-frame-variant', 'audit-image-long', 'audit-image-null'])
    const applied = await fetch(route + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
    })
    expect(applied.status).toBe(200)
    for (const source of docs) {
      const opened = await fetch(base + '/api/projects/' + source.id)
      expect(opened.status).toBe(200)
      const actual: Doc = await opened.json()
      expect(actual.blocks).toEqual(source.blocks)
      expect(compileDoc(actual).html).toBe(compileDoc(source).html)
      if (source.id === 'audit-heading') continue
      expect(compileDoc(actual).html).not.toContain('<img')
      expect(docToMarkdown(actual)).not.toContain('<em>')
      expect(docToMarkdown(actual)).toContain('&lt;em&gt;&amp;')
    }
  })
}, 20_000)

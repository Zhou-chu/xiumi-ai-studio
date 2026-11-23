import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { textToRich } from '../../src/core/richtext'
import { docToMarkdown } from '../../src/core/exporters'
import type { Block, Doc } from '../../src/core/types'

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

it('restores native text boxes and blank picture collections, rejecting unsupported children or images', async () => {
  const { archive, docs } = await library(async (base) => {
    const { emptyDoc, useStore, saveNow } = await import('../../src/editor/store')
    const original = globalThis.fetch
    const client = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      original(typeof input === 'string' && input.startsWith('/') ? base + input : input, init))
    try {
      const box = createBlock('box', { title: '<em>& [text]*', label: 'REPORT' }) as Block<'box'>
      box.props.children.push(createBlock('paragraph', { content: textToRich('<strong>& [child]*') }))
      const gallery = createBlock('gallery', { caption: '<em>& [text]*' }) as Block<'gallery'>
      const carousel = createBlock('carousel') as Block<'carousel'>
      const docs: Doc[] = [
        { ...emptyDoc(), id: 'audit-box', blocks: [box] },
        { ...emptyDoc(), id: 'audit-gallery', blocks: [gallery] },
        { ...emptyDoc(), id: 'audit-carousel', blocks: [carousel] },
      ]
      for (const doc of docs) {
        useStore.getState().load(doc)
        expect(await saveNow()).toBe(true)
      }
      const child = box.props.children[0]
      const linkedChild = createBlock('paragraph', { content: { type: 'doc', content: [{
        type: 'paragraph', content: [{ type: 'text', text: 'Nested source', marks: [
          { type: 'link', attrs: { href: 'https://example.org/reference' } },
        ] }],
      }] } })
      const heading = createBlock('heading')
      const negatives = [
        { ...docs[0], id: 'bad-box-heading-variant', blocks: [{ ...box, props: { ...box.props, children: [{ ...heading, props: { ...heading.props, variant: 'custom' } }] } }] },
        { ...docs[0], id: 'bad-box-heading-extra', blocks: [{ ...box, props: { ...box.props, children: [{ ...heading, props: { ...heading.props, image: { src: '/media/unused.png' } } }] } }] },
        { ...docs[0], id: 'bad-box-heading-long', blocks: [{ ...box, props: { ...box.props, children: [{ ...heading, props: { ...heading.props, title: 'x'.repeat(2001) } }] } }] },
        { ...docs[0], id: 'bad-box-heading-duplicate', blocks: [{ ...box, props: { ...box.props, children: [heading] } }, heading] },
        { ...docs[0], id: 'bad-box-link', blocks: [{ ...box, props: { ...box.props, children: [linkedChild] } }] },
        { ...docs[0], id: 'bad-box-nested', blocks: [{ ...box, props: { ...box.props, children: [box] } }] },
        { ...docs[0], id: 'bad-box-duplicate', blocks: [box, child] },
        { ...docs[0], id: 'bad-box-content', blocks: [{ ...box, props: { ...box.props, children: [createBlock('html')] } }] },
        { ...docs[1], id: 'bad-gallery-media', blocks: [{ ...gallery, props: { ...gallery.props, images: [{ src: 'https://example.com/img.png' }] } }] },
        { ...docs[2], id: 'bad-carousel-media', blocks: [{ ...carousel, props: { ...carousel.props, pics: [{ caption: '', image: null }] } }] },
        { ...docs[2], id: 'bad-carousel-many', blocks: [{ ...carousel, props: { ...carousel.props, pics: Array.from({ length: 31 }, () => ({ caption: '' })) } }] },
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
    form.append('file', archive, 'blank-collections.zip')
    const response = await fetch(route, { method: 'POST', body: form })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect([...plan.projects.add].sort()).toEqual(['audit-box', 'audit-carousel', 'audit-gallery'])
    expect([...plan.projects.unsupported].sort()).toEqual([
      'bad-box-content', 'bad-box-duplicate', 'bad-box-heading-duplicate', 'bad-box-heading-extra',
      'bad-box-heading-long', 'bad-box-heading-variant', 'bad-box-link', 'bad-box-nested', 'bad-carousel-many', 'bad-carousel-media', 'bad-gallery-media',
    ])
    const applied = await fetch(route + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
    })
    expect(applied.status).toBe(200)
    for (const source of docs) {
      const opened = await fetch(base + '/api/projects/' + source.id)
      expect(opened.status).toBe(200)
      const actual: Doc = await opened.json()
      expect(actual.blocks).toEqual(source.blocks)
      const rendered = compileDoc(actual)
      expect(rendered).toEqual(compileDoc(source))
      expect(rendered.html).not.toContain('<img')
      if (source.id === 'audit-box') {
        expect(docToMarkdown(actual)).toContain('&lt;strong&gt;&amp;')
        expect(docToMarkdown(actual)).not.toContain('<strong>')
      }
      if (source.id !== 'audit-carousel') {
        expect(docToMarkdown(actual)).toContain('&lt;em&gt;&amp;')
        expect(docToMarkdown(actual)).not.toContain('<em>')
      }
    }
  })
}, 20_000)


it('restores the pinned upstream heading and paragraph box without changing its rendering', async () => {
  const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
  const archive = await readFile(new URL('../fixtures/legacy-backup/upstream-heading-box.zip', import.meta.url))
  expect(hash(archive)).toBe('553b317880c9ef8dee41a8249c38b17c8e2e0ce0026b68204c51430b72cfc5d0')
  const source: Doc = JSON.parse(Buffer.from(unzipSync(archive)['projects/upstream-heading-box.json']).toString('utf8'))
  await library(async (base, data) => {
    const route = base + '/api/data/restore'
    const body = new FormData()
    body.append('file', new Blob([new Uint8Array(archive)]), 'upstream-heading-box.zip')
    const response = await fetch(route, { method: 'POST', body })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    await expect(readdir(join(data, 'projects'))).resolves.toEqual([])
    await expect(readdir(join(data, 'assets'))).resolves.toEqual([])
    expect(plan.projects.add).toEqual([source.id])
    expect(plan.projects.unsupported).toEqual([])
    const applied = await fetch(route + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
    })
    expect(applied.status).toBe(200)
    const opened = await fetch(base + '/api/projects/' + source.id)
    expect(opened.status).toBe(200)
    const actual: Doc = await opened.json()
    expect(actual.blocks).toEqual(source.blocks)
    const { html } = compileDoc(actual)
    expect(hash(html)).toBe('b29f601db8314e587af7428ae1c9513a79a1fb4abc1a765d3d316b877009cb57')
    expect(html).not.toContain('<em>')
    const markdown = docToMarkdown(actual)
    expect(markdown).toContain('Heading &lt;em&gt;&amp;')
    expect(markdown).toContain('Subtitle &lt;u&gt;&amp;')
    expect(markdown).not.toMatch(/<(?:em|u|strong)>/)
  })
}, 20_000)

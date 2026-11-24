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

it('round-trips bounded native paragraph links through the real library backup and restore', async () => {
  const https = 'https://example.org/research?topic=paper&mode=summary'
  const mail = 'mailto:editor@example.org'
  const label = 'Read [notes] & <draft>'
  const make = (id: string, value: string, href: string, target = '_blank'): Doc => ({
    id, title: id, author: '', digest: '', themeId: 'tech-blue', createdAt: 1, updatedAt: 1,
    blocks: [createBlock('paragraph', { align: 'left', content: { type: 'doc', content: [{
      type: 'paragraph', content: [{ type: 'text', text: value, marks: [
        { type: 'bold' }, { type: 'link', attrs: { href, target, rel: 'noopener noreferrer nofollow', class: null, title: null } },
      ] }],
    }] } })],
  })
  const docs = [make('audit-https', label, https), make('audit-email', 'Contact the author', mail)]
  const archive = await library(async base => {
    const negative = [make('audit-relative', label, '/docs'), make('audit-target', label, https, 'other-frame')]
    for (const doc of [...docs, ...negative]) {
      const saved = await fetch(base + '/api/projects/' + doc.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
      })
      expect(saved.status).toBe(200)
    }
    const backup = await fetch(base + '/api/data/backup')
    expect(backup.ok).toBe(true)
    return backup.blob()
  })
  await library(async (base, data) => {
    const route = base + '/api/data/restore'
    const form = new FormData()
    form.append('file', archive, 'native-paragraph-links.zip')
    const response = await fetch(route, { method: 'POST', body: form })
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]
    const { token, plan } = await response.json()
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect([...plan.projects.add].sort()).toEqual(['audit-email', 'audit-https'])
    expect([...plan.projects.unsupported].sort()).toEqual(['audit-relative', 'audit-target'])
    const applied = await fetch(route + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}',
    })
    expect(applied.status).toBe(200)
    expect((await readdir(join(data, 'projects'))).sort()).toEqual(['audit-email.json', 'audit-https.json'])
    for (const original of docs) {
      const reopened = await fetch(base + '/api/projects/' + original.id)
      expect(reopened.ok).toBe(true)
      const actual: Doc = await reopened.json()
      expect(actual.blocks).toEqual(original.blocks)
      expect(compileDoc(actual, { externalLinks: 'keep' }).html).toBe(compileDoc(original, { externalLinks: 'keep' }).html)
      expect(compileDoc(actual).html).not.toContain('<a ')
      const markdown = docToMarkdown(actual)
      const { marked } = await import('marked')
      const { JSDOM } = await import('jsdom')
      const parsed = new JSDOM(await marked.parse(markdown)).window.document
      expect(parsed.querySelector('a')?.getAttribute('href')).toBe(original.id === 'audit-https' ? https : mail)
      expect(parsed.querySelector('a strong')?.textContent).toBe(original.id === 'audit-https' ? label : 'Contact the author')
    }
  })
}, 20_000)

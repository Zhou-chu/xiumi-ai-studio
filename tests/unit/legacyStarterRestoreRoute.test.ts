import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { docToMarkdown } from '../../src/core/exporters'
import type { Doc } from '../../src/core/types'

async function withLibrary<T>(run: (base: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-starter-restore-'))
  vi.stubEnv('DATA_DIR', join(dir, 'data'))
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: dir })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback port')
    return await run('http://127.0.0.1:' + address.port)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  }
}

const json = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
async function readDoc(base: string, id: string): Promise<Doc> {
  const response = await fetch(base + '/api/projects/' + id)
  expect(response.status).toBe(200)
  return response.json()
}

it('round-trips a saved default starter in a real library ZIP and preserves its text-only cover and ending', async () => {
  const { archive, saved, control, rejected } = await withLibrary(async base => {
    const { emptyDoc, useStore, saveNow } = await import('../../src/editor/store')
    const original = emptyDoc()
    expect(original.blocks.map(block => block.type)).toEqual(['cover', 'heading', 'paragraph', 'ending'])
    const store = useStore.getState()
    store.load(original)
    store.setDocFields({ title: 'Starter restored & ready' })
    store.updateProps(original.blocks[0].id, { title: 'Cover & lead', titleAlign: 'right', meta: '<em>metadata</em> & [notes]' })
    store.updateProps(original.blocks[3].id, { note: 'Ending & credits', author: '<em>editor</em> & *credits*' })
    const request = globalThis.fetch
    const client = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      request(typeof input === 'string' && input.startsWith('/') ? base + input : input, init))
    try {
      expect(await saveNow()).toBe(true)
    } finally {
      client.mockRestore()
    }
    const saved = await readDoc(base, original.id)
    const [cover, heading, , ending] = saved.blocks
    const control = { ...saved, id: 'control-heading', blocks: [heading] }
    const rejected = [
      { ...saved, id: 'reject-cover-image', blocks: [{ ...cover, props: { ...cover.props, image: null } }] },
      { ...saved, id: 'reject-cover-align', blocks: [{ ...cover, props: { ...cover.props, titleAlign: 'invalid' } }] },
      { ...saved, id: 'reject-ending-image', blocks: [{ ...ending, props: { ...ending.props, image: null } }] },
      { ...saved, id: 'reject-ending-text', blocks: [{ ...ending, props: { ...ending.props, text: 'x'.repeat(20_001) } }] },
    ]
    for (const item of [control, ...rejected]) {
      expect((await fetch(base + '/api/projects/' + item.id, { method: 'PUT', ...json({ ...item, revision: undefined }) })).ok).toBe(true)
    }
    const response = await fetch(base + '/api/data/backup')
    expect(response.status).toBe(200)
    return { archive: await response.blob(), saved, control, rejected: rejected.map(item => item.id).sort() }
  })

  await withLibrary(async base => {
    const route = base + '/api/data/restore'
    const form = new FormData()
    form.append('file', archive, 'starter-library.zip')
    const preview = await fetch(route, { method: 'POST', body: form })
    expect(preview.status).toBe(200)
    const { token, plan } = await preview.json()
    expect((await (await fetch(base + '/api/projects')).json())).toEqual([])
    const expected = [control.id, saved.id].sort()
    expect([...plan.projects.add].sort()).toEqual(expected)
    expect([...plan.projects.unsupported].sort()).toEqual(rejected)
    const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
    const response = await fetch(route + '/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect([...result.projects.restored].sort()).toEqual(expected)
    const restored = await readDoc(base, saved.id)
    expect(restored.title).toBe('Starter restored & ready')
    expect(restored.blocks).toEqual(saved.blocks)
    expect((await readDoc(base, control.id)).blocks).toEqual(control.blocks)
    expect(compileDoc(restored).html).toBe(compileDoc(saved).html)
    expect(compileDoc(restored).html).toContain('Cover &amp; lead')
    expect(compileDoc(restored).html).toContain('Ending &amp; credits')
    expect(compileDoc(restored).html).not.toContain('<img')
    const markdown = docToMarkdown(restored)
    expect(markdown).toContain('&lt;em&gt;metadata&lt;/em&gt; &amp; ' + String.raw`\[notes\]`)
    expect(markdown).toContain('&lt;em&gt;editor&lt;/em&gt; &amp; ' + String.raw`\*credits\*`)
    expect(markdown).not.toContain('<em>')
    for (const id of rejected) expect((await fetch(base + '/api/projects/' + id)).status).toBe(404)
  })
}, 20_000)

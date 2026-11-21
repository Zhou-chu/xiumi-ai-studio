import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'

const fixture = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-library.zip', import.meta.url))
it('binds a read-only staged preview to its owner and confirms once without overwriting newer projects', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'xiumi-restore-route-'))
  const data = join(temp, 'data')
  const scratch = join(temp, 'scratch')
  await mkdir(scratch)
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: scratch })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const base = `http://127.0.0.1:${address.port}`
    const url = base + '/api/data/restore'
    const file = await readFile(fixture)
    const upload = async (bytes: Buffer, headers?: HeadersInit) => {
      const body = new FormData()
      body.append('file', new Blob([new Uint8Array(bytes)]), 'untrusted-display-name.zip')
      return fetch(url, { method: 'POST', body, headers })
    }

    const denied = await upload(file, { Origin: 'https://example.invalid', 'Sec-Fetch-Site': 'cross-site' })
    expect(denied.status).toBe(403)
    await denied.text()
    const invalid = await upload(Buffer.from('Not a backup'))
    expect(invalid.status).toBe(400)
    await invalid.text()
    await expect(readdir(scratch)).resolves.toEqual([])
    await expect(readdir(join(data, 'projects'))).resolves.toEqual([])

    const preview = await upload(file)
    expect(preview.status).toBe(200)
    const cookieHeader = preview.headers.get('set-cookie') ?? ''
    expect(cookieHeader).toContain('HttpOnly')
    expect(cookieHeader).toContain('SameSite=Strict')
    const cookie = cookieHeader.split(';', 1)[0]
    const { token, plan } = await preview.json()
    expect(plan).toMatchObject({
      projects: { add: ['corrupt', 'edited'], skip: [], unsupported: ['archived'] },
      unsupported: ['assets/_index.json', 'assets/fixture-image.png', 'settings.json', 'templates/fixture-template.json'],
    })
    await expect(readdir(scratch)).resolves.toEqual([])
    await expect(readdir(join(data, 'projects'))).resolves.toEqual([])
    const concurrent = await upload(file)
    expect(concurrent.status).toBe(429)
    await concurrent.text()
    const apply = (headers: Record<string, string>, confirm = true) =>
      fetch(`${url}/${token}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ confirm }) })
    const outsider = await apply({})
    expect(outsider.status).toBe(404)
    await outsider.text()
    const wrongSite = await apply({ Cookie: cookie, Origin: 'http://localhost:1111' })
    expect(wrongSite.status).toBe(403)
    await wrongSite.text()
    const unconfirmed = await apply({ Cookie: cookie }, false)
    expect(unconfirmed.status).toBe(400)
    await unconfirmed.text()

    const local = join(data, 'projects', 'edited.json')
    await writeFile(local, 'local document from after preview')
    const confirmed = await apply({ Cookie: cookie })
    expect(confirmed.status).toBe(200)
    expect(await confirmed.json()).toMatchObject({
      projects: { restored: ['corrupt'], skipped: ['edited'], unsupported: ['archived'], failed: [] },
    })
    await expect(readFile(local, 'utf8')).resolves.toBe('local document from after preview')
    await expect(readdir(join(data, 'projects'))).resolves.toEqual(['corrupt.json', 'edited.json'])
    const opened = await fetch(base + '/api/projects/corrupt')
    expect(opened.status).toBe(200)
    const doc = await opened.json()
    expect(doc).toMatchObject({
      id: 'corrupt', title: 'Backup corrupt', author: '', digest: '', themeId: 'tsinghua-purple',
      createdAt: 1, updatedAt: 1, revision: expect.any(String),
    })
    expect(doc.revision).not.toBe('fixture-old-revision')
    const { useStore, saveNow } = await import('../../src/editor/store')
    useStore.getState().load(doc)
    expect(useStore.getState().saveStatus).toBe('saved')
    const { compileForWechat } = await import('../../src/editor/wechatOutput')
    const output = await compileForWechat(useStore.getState().doc, 'embed', () => {})
    expect(output.html).toContain('Restored legacy heading')
    expect(output.html).toContain('Restored paragraph')
    expect(output.html).toContain('<strong')
    expect(output.html).toContain('<em')
    expect(output.html).toContain('Restored card')
    expect(output.html).toContain('#ffcc00')
    expect(output.warnings.some(warning => warning.includes('数据异常'))).toBe(false)
    const { getSchema } = await import('@tiptap/react')
    const { default: StarterKit } = await import('@tiptap/starter-kit')
    const { default: Highlight } = await import('@tiptap/extension-highlight')
    const { default: TextAlign } = await import('@tiptap/extension-text-align')
    const { Color, FontFamily, FontSize, TextStyle } = await import('@tiptap/extension-text-style')
    const { EditorState } = await import('@tiptap/pm/state')
    const schema = getSchema([
      StarterKit.configure({ heading: { levels: [3] }, codeBlock: false, code: false, horizontalRule: false, link: { openOnClick: false } }),
      TextStyle, FontFamily, FontSize, Color, Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
    ])
    for (const block of useStore.getState().doc.blocks) {
      if (block.type === 'paragraph' || block.type === 'card') schema.nodeFromJSON(block.props.content).check()
    }
    const paragraph = useStore.getState().doc.blocks.find(block => block.id === 'legacy-paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('No restored paragraph')
    const editor = EditorState.create({ doc: schema.nodeFromJSON(paragraph.props.content) })
    const edited = editor.apply(editor.tr.insertText(' / roundtrip edit', editor.doc.content.size - 1))
    const request = globalThis.fetch
    const localFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      request(typeof input === 'string' && input.startsWith('/') ? base + input : input, init))
    try {
      useStore.getState().updateProps(paragraph.id, { content: edited.doc.toJSON() })
      expect(await saveNow()).toBe(true)
    } finally {
      localFetch.mockRestore()
    }
    const reopened = await fetch(base + '/api/projects/corrupt')
    useStore.getState().load(await reopened.json())
    const editedOutput = await compileForWechat(useStore.getState().doc, 'embed')
    expect(editedOutput.html).toContain('second paragraph / roundtrip edit')
    expect(editedOutput.html).toContain('marked words')
    expect(editedOutput.html).toContain('#ffcc00')

    const again = await apply({ Cookie: cookie })
    expect(again.status).toBe(404)
    await again.text()

    const augmented = await JSZip.loadAsync(file)
    const opaque = { id: 'opaque-extra', title: 'Unsupported property', blocks: [], unsupported: { child: { note: 'fixture' } } }
    const forged = { id: 'opaque-block', title: 'Unsupported props', blocks: [{ id: 'block', type: 'divider', props: { variant: 'line', hidden: { note: 'fixture' } } }] }
    augmented.file('projects/opaque-extra.json', JSON.stringify(opaque))
    augmented.file('projects/opaque-block.json', JSON.stringify(forged))
    const rich = (id: string, inline: unknown) => ({
      id, title: id, blocks: [{ id: 'p', type: 'paragraph', props: {
        align: 'left', content: { type: 'doc', content: [{ type: 'paragraph', content: [inline] }] },
      } }],
    })
    augmented.file('projects/rich-link.json', JSON.stringify(rich('rich-link', {
      type: 'text', text: 'An archived link', marks: [{ type: 'link', attrs: { href: 'https://example.invalid' } }],
    })))
    augmented.file('projects/rich-nested.json', JSON.stringify(rich('rich-nested', {
      type: 'paragraph', content: [{ type: 'text', text: 'An invalid nested paragraph' }],
    })))
    const editedSource = JSON.parse(await augmented.file('projects/edited.json')!.async('string'))
    augmented.file('projects/meaningful-copy.json', JSON.stringify({ ...editedSource, id: 'meaningful-copy' }))
    const additional = await upload(await augmented.generateAsync({ type: 'nodebuffer' }))
    expect(additional.status).toBe(200)
    const extraOwner = additional.headers.get('set-cookie')!.split(';', 1)[0]
    const extraPlan = await additional.json()
    expect(extraPlan).toMatchObject({
      plan: { projects: { add: ['meaningful-copy'], skip: ['corrupt', 'edited'], unsupported: ['archived', 'opaque-block', 'opaque-extra', 'rich-link', 'rich-nested'] } },
    })
    await expect(readdir(join(data, 'projects'))).resolves.toEqual(['corrupt.json', 'edited.json'])
    const second = await fetch(`${url}/${extraPlan.token}/apply`, {
      method: 'POST', headers: { Cookie: extraOwner, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    })
    expect((await second.json()).projects.restored).toEqual(['meaningful-copy'])
    const preserved = await fetch(base + '/api/projects/meaningful-copy')
    expect(await preserved.json()).toMatchObject({
      id: 'meaningful-copy', title: 'Backup edited', author: 'Original author', digest: 'Original summary',
      themeId: 'minimal-magazine', createdAt: 48, updatedAt: 72,
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(temp, { recursive: true, force: true })
  }
})

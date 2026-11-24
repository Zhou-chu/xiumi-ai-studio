// @vitest-environment jsdom
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'

const fixture = join(process.cwd(), 'tests/fixtures/legacy-backup/upstream-linked-component.zip')
const componentId = '0uKb2D0X9a'
const expectedLinks = [
  ['https://example.invalid/docs?page=2&mode=reader#intro', 'Documentation'],
  ['http://example.invalid/archive', 'archive'],
]

it('restores upstream saved links and preserves them when inserting and exporting the component', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-linked-component-'))
  const data = join(root, 'library')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: root })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address')
    const base = 'http://127.0.0.1:' + address.port
    const endpoint = base + '/api/data/restore'
    const boundary = 'xiumi-linked-archive-fixture'
    const body = Buffer.concat([
      Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="upstream-linked-component.zip"\r\nContent-Type: application/zip\r\n\r\n'),
      await readFile(fixture),
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ])
    const preview = await fetch(endpoint + '?components=1', {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary }, body,
    })
    expect(preview.status).toBe(200)
    const { token, plan } = await preview.json()
    expect(plan.components).toEqual({ add: [componentId], conflicts: [], alreadyPresent: [], unresolved: [] })
    expect(plan.unsupported).not.toContain('components/' + componentId + '.json')
    await expect(readdir(join(data, 'components'))).resolves.toEqual([])

    const apply = await fetch(endpoint + '/' + token + '/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: preview.headers.get('set-cookie')!.split(';', 1)[0] },
      body: '{"confirm":true}',
    })
    expect(apply.status).toBe(200)
    expect((await apply.json()).components.restored).toEqual([componentId])

    const [component] = await (await fetch(base + '/api/components')).json()
    expect(component).toMatchObject({ id: componentId, missing: [], origin: { attested: false, redistributable: false } })
    const { emptyDoc, useStore } = await import('../../src/editor/store')
    const { insertComponent, parseDoc } = await import('../../src/editor/componentActions')
    useStore.getState().load({ ...emptyDoc(), blocks: [] })
    insertComponent(component.block, { index: 0 })
    const doc = useStore.getState().doc
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0]).toMatchObject({ type: 'html' })
    expect(doc.blocks[0].id).not.toBe(component.block.id)
    const exported = compileDoc(doc).html
    const links = Array.from(parseDoc(exported).querySelectorAll('a'), a => [a.getAttribute('href'), a.textContent])
    expect(links).toEqual(expectedLinks)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})

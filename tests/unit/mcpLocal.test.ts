import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createBlock } from '../../src/core/blocks'
import { describe, expect, it, vi } from 'vitest'
import { createLocalMcp, loopbackApi } from '../../server/mcp/tools'
import { createMcpHttp, dispatchMcp, serveMcpStdio } from '../../server/mcp/transport'
import { Readable, Writable } from 'node:stream'

const makeImage = async () => (await sharp({ create: { width: 3, height: 3, channels: 4, background: '#440066' } }).png().toBuffer()).toString('base64')
const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, params })
async function listener<T>(server: ReturnType<typeof createServer>, work: (url: string) => Promise<T>) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('no isolated port')
  try { return await work('http://127.0.0.1:' + address.port) }
  finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

describe('local Xiumi MCP', () => {
  it('edits only the requested revision, writes a version and exports in a real isolated library', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xiumi-mcp-test-'))
    vi.stubEnv('DATA_DIR', dir)
    vi.resetModules()
    try {
      const { createApp } = await import('../../server/app')
      await listener(createServer(createApp()), async url => {
        const mcp = createLocalMcp(url)
        const invoke = async (name: string, args?: unknown) => {
          const result = await mcp.invoke(name, args)
          expect(result.isError, result.content[0].text).not.toBe(true)
          return JSON.parse(result.content[0].text)
        }
        expect((await invoke('xiumi_status')).publishAllowedByMcp).toBe(false)
        const notification = { jsonrpc: '2.0', method: 'tools/call', params: { name: 'xiumi_create_project', arguments: { title: 'Must not save' } } }
        expect(await dispatchMcp(mcp, notification)).toBeNull()
        expect(await invoke('xiumi_list_projects')).toEqual([])
        const { created } = await invoke('xiumi_create_project', { title: 'Controlled draft' })
        const id = created.id
        expect((await invoke('xiumi_list_projects')).map((x: { id: string }) => x.id)).toEqual([id])
        expect((await invoke('xiumi_get_project', { id })).title).toBe('Controlled draft')
        const full = await invoke('xiumi_get_project', { id, full: true })
        expect((await invoke('xiumi_get_block', { project_id: id, block_id: full.blocks[0].id })).type).toBe('cover')
        expect((await invoke('xiumi_list_themes')).length).toBeGreaterThan(0)
        expect(await invoke('xiumi_list_assets')).toEqual([])
        expect(await invoke('xiumi_list_templates')).toEqual([])
        expect(await invoke('xiumi_list_components')).toEqual([])
        const edit = { project_id: id, revision: created.revision, ops: [{ op: 'setMeta', title: 'New draft' }, { op: 'update', id: full.blocks[0].id, props: { title: 'New cover' } }, { op: 'bogus' }] }
        const preview = await invoke('xiumi_apply_ops', edit)
        expect(preview.preview.title).toBe('New draft')
        expect(preview.rejected).toHaveLength(1)
        expect((await invoke('xiumi_get_project', { id })).revision).toBe(created.revision)
        const saved = await invoke('xiumi_apply_ops', { ...edit, dry_run: false })
        expect(saved.project.revision).not.toBe(created.revision)
        expect((await mcp.invoke('xiumi_apply_ops', edit)).isError).toBe(true)
        const remove = { project_id: id, revision: saved.project.revision, ops: [{ op: 'remove', id: full.blocks[0].id }] }
        expect((await invoke('xiumi_apply_ops', remove)).preview.blockCount).toBe(full.blocks.length - 1)
        const blocked = await invoke('xiumi_apply_ops', { ...remove, dry_run: false })
        expect(blocked.applied).toBe(0)
        expect(blocked.rejected).toHaveLength(1)
        expect((await invoke('xiumi_get_project', { id })).blockCount).toBe(full.blocks.length)
        await invoke('xiumi_save_version', { project_id: id, label: 'First checkpoint' })
        expect((await invoke('xiumi_list_versions', { project_id: id }))[0].label).toBe('First checkpoint')
        expect((await invoke('xiumi_compile', { project_id: id })).html).toContain('<section')
        expect(await invoke('xiumi_compile', { project_id: id, include_html: false })).not.toHaveProperty('html')
        expect((await invoke('xiumi_export_markdown', { project_id: id })).markdown).toContain('# New cover')
        expect((await mcp.invoke('xiumi_compile', { project_id: id, save_to: 'unused.html' })).isError).toBe(true)
        expect((await mcp.invoke('xiumi_create_project', { use_ai: true })).isError).toBe(true)
        expect((await mcp.invoke('xiumi_wechat_push_draft', { project_id: id, confirm: true })).isError).toBe(true)
        expect((await mcp.invoke('xiumi_upload_asset', { filename: 'pixel.png', base64: 'bad' })).isError).toBe(true)
        const [asset] = await invoke('xiumi_upload_asset', { filename: 'pixel.png', base64: await makeImage() })
        expect(await invoke('xiumi_list_assets')).toHaveLength(1)
        const local = await invoke('xiumi_create_project', { text: '# Local layout\n\n## Section\n\nMCP preview', image_asset_ids: [asset.id] })
        expect((await invoke('xiumi_export_markdown', { project_id: local.created.id })).markdown).toContain('MCP preview')
        expect((await invoke('xiumi_compile', { project_id: local.created.id, images: 'local' })).html).toContain(url + '/media/')
        expect((await invoke('xiumi_compile', { project_id: local.created.id, images: 'embed' })).html).toMatch(/data:image\/(?:png|jpeg);base64,/)
        expect((await mcp.invoke('xiumi_get_block', { project_id: id, block_id: 'missing' })).isError).toBe(true)
        expect((await mcp.invoke('xiumi_get_project', { id: 'missing' })).isError).toBe(true)
        const change = (title: string) => mcp.invoke('xiumi_apply_ops', {
          project_id: id, revision: saved.project.revision, dry_run: false, ops: [{ op: 'setMeta', title }],
        })
        const concurrent = await Promise.all([change('One'), change('Two')])
        expect(concurrent.filter(item => item.isError)).toHaveLength(1)
        expect(['One', 'Two']).toContain((await invoke('xiumi_get_project', { id })).title)
      })
    } finally { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }) }
  }, 20_000)

  it('limits cumulative embedded output even when repeated local images are downloaded only once', async () => {
    const image = await sharp({ create: { width: 650, height: 650, channels: 3, background: '#440066' } })
      .png({ compressionLevel: 0 }).toBuffer()
    const title = 'Repeated image'
    const blocks = Array.from({ length: 9 }, () => createBlock('image', {
      image: { src: '/media/photo.png', width: 650, height: 650, alt: 'fixture' },
    }))
    const doc = { id: 'repeated', title, author: '', digest: '', themeId: 'tsinghua-purple', createdAt: 1, updatedAt: 1, blocks }
    let gets = 0
    await listener(createServer((req, res) => {
      if (req.url?.startsWith('/media/photo.png')) {
        gets++
        res.setHeader('content-type', 'image/png')
        return res.end(image)
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(doc))
    }), async url => {
      const mcp = createLocalMcp(url)
      const local = await mcp.invoke('xiumi_compile', { project_id: 'repeated' })
      expect(local.isError).not.toBe(true)
      expect(JSON.parse(local.content[0].text).html).toContain(url + '/media/photo.png')
      expect(gets).toBe(0)
      const embedded = await mcp.invoke('xiumi_compile', { project_id: 'repeated', images: 'embed' })
      expect(embedded.isError).toBe(true)
      expect(embedded.content[0].text).toContain('输出内嵌图片累计容量超限')
      expect(gets).toBe(1)
    })
  })

  it('provides token-protected loopback discovery, calls and JSON-RPC', async () => {
    const mcp = createLocalMcp('http://localhost:5174')
    const token = 'local-test-token-1234567890'
    expect(() => createMcpHttp(mcp, '')).toThrow(/TOKEN/)
    expect(() => loopbackApi('https://example.org')).toThrow(/XIUMI_API/)
    await listener(createMcpHttp(mcp, token), async url => {
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
      const post = (path: string, data: unknown) => fetch(url + path, { method: 'POST', headers, body: JSON.stringify(data) })
      expect((await fetch(url + '/tools')).status).toBe(401)
      expect((await fetch(url + '/tools', { headers: { ...headers, Origin: 'http://localhost:9999' } })).status).toBe(403)
      const catalog = await (await fetch(url + '/tools', { headers })).json()
      expect(catalog.map((x: { name: string }) => x.name)).toContain('xiumi_get_project')
      const init = await (await post('/mcp', rpc('initialize', { protocolVersion: '2025-06-18' }))).json()
      expect(init.result.serverInfo.name).toBe('xiumi-ai-studio')
      expect((await post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
      expect((await post('/mcp', rpc('tools/call', { name: 'xiumi_get_project' }))).status).toBe(200)
      expect((await post('/call/xiumi_get_project', { id: false })).status).toBe(400)
      expect((await post('/other', {})).status).toBe(404)
      expect((await fetch(url + '/mcp', { method: 'POST', headers, body: '{' })).status).toBe(400)
      expect((await fetch(url + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' })).status).toBe(415)
      const oversized = await fetch(url + '/mcp', { method: 'POST', headers, body: 'x'.repeat(5_000_001) })
      expect(oversized.status).toBe(413)
    })
  })

  it('serves bounded newline-delimited stdio with parse errors and silent notifications', async () => {
    const mcp = createLocalMcp('http://127.0.0.1:5174')
    const msgs = [rpc('ping'), rpc('resources/list'), rpc('prompts/list'), rpc('unknown'), { jsonrpc: '2.0', method: 'notifications/initialized' }]
    const input = Readable.from(['bad JSON\n', JSON.stringify(msgs.slice(0, 4)) + '\n', JSON.stringify(msgs.at(-1)) + '\n', JSON.stringify(rpc('tools/list')) + '\n'])
    const out: string[] = []
    const output = new Writable({ write(chunk, _encoding, cb) { out.push(chunk.toString()); cb() } })
    await serveMcpStdio(mcp, input, output)
    const lines = out.join('').trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toHaveLength(3)
    expect(lines[0].error.code).toBe(-32700)
    expect(lines[1][3].error.code).toBe(-32601)
    expect(lines[2].result.tools).toHaveLength(15)
    expect(await dispatchMcp(mcp, [])).toMatchObject({ error: { code: -32600 } })
  })
})

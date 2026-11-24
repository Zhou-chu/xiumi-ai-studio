import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'
import { renderLocalSvgInteraction } from '../../src/core/localSvgInteraction'
import { independentSvgBackup, nativeSvgFixture, nativeSvgProjectId as id } from '../fixtures/legacy-native-svg'

it('explicitly rejects the upstream cross-fragment project, then uses preview and confirm for its independent blocks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-svg-'))
  const scratch = join(dir, 'uploads')
  const data = join(dir, 'data')
  await mkdir(scratch)
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: scratch })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('Expected loopback server')
    const origin = `http://127.0.0.1:${address.port}`
    const url = origin + '/api/data/restore'
    const project = origin + '/api/projects/' + id
    const preview = async (bytes: Buffer, cookie?: string) => {
      const body = new FormData()
      body.set('file', new Blob([new Uint8Array(bytes)]), 'native-svg.zip')
      const res = await fetch(url, { method: 'POST', body, headers: cookie ? { Cookie: cookie } : undefined })
      expect(res.status).toBe(200)
      return { cookie: res.headers.get('set-cookie')!.split(';', 1)[0], ...(await res.json()) }
    }
    const upstream = await preview(await readFile(nativeSvgFixture))
    expect(upstream.plan.projects).toMatchObject({ add: [], unsupported: [id] })
    const { doc, bytes } = await independentSvgBackup()
    const local = await preview(bytes, upstream.cookie)
    expect(local.plan.projects).toMatchObject({ add: [id], unsupported: [] })
    expect((await fetch(project)).status).toBe(404)
    const apply = await fetch(`${url}/${local.token}/apply`, {
      method: 'POST', headers: { Cookie: local.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    })
    expect(apply.status).toBe(200)
    expect((await apply.json()).projects.restored).toEqual([id])
    const restored = await (await fetch(project)).json()
    expect(restored.blocks).toEqual(doc.blocks)
    const changed = 'SVG article after ordinary save'
    const save = await fetch(project, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...restored, title: changed }),
    })
    expect(save.status).toBe(200)
    const reopened = await (await fetch(project)).json()
    expect(reopened).toMatchObject({ title: changed, blocks: doc.blocks })
    expect(reopened.revision).not.toBe(restored.revision)
    const html = compileDoc(reopened).html
    expect(html).toContain('attributeName="visibility" to="hidden" begin="click"')
    expect(html).toContain('attributeName="opacity" to="0.2" begin="touchstart"')
    expect(html).toContain('values="visible;hidden;collapse" calcMode="discrete"')
    expect(html).not.toMatch(/\bid=|\bhref=|<script|foreignObject/i)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  }
})

const local = '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#ccc"><set attributeName="visibility" to="hidden" begin="click" fill="freeze"/></rect></svg>'
it.each([
  ['not SVG', '<p>an ordinary paragraph</p>'],
  ['attr mismatch', local.replace(' width="100"', ' data-label="draft"')],
  ['duplicate attr', local.replace(' to="hidden"', ' to="visible" to="hidden"')],
  ['invalid value for chosen attribute', local.replace('to="hidden"', 'to="1"')],
  ['cross-fragment trigger', local.replace('begin="click"', 'begin="another.click"')],
  ['cross-fragment target', local.replace('<set ', '<set href="#other" ')],
  ['trailing unknown content', local + '<p>more content</p>'],
  ['unclosed input', local.slice(0, -6)],
  ['too much input', local + ' '.repeat(1024)],
])('rejects the whole bounded fragment for %s', (_desc, fragment) => {
  expect(renderLocalSvgInteraction(fragment)).toBeNull()
})

it('serializes literal marked SVG syntax and normalizes only viewBox whitespace', () => {
  expect(renderLocalSvgInteraction(local.replace('0 0', '0\n 0').replace('"/>', '"></set>')))
    .toBe(local.replace('"/>', '" />'))
})

it('preserves both quote styles and standard whitespace within a valid local fragment', () => {
  const mixedQuoted = local.replace(' viewBox="0 0 100 100"', "\tviewBox \r=\n'0\t0 100 100' ")
    .replace(' width="100"', "\u00a0width \t= '100'").replace(' fill="freeze"', "\nfill = 'freeze' ")
  expect(renderLocalSvgInteraction(mixedQuoted)).toBe(local.replace('"/>', '" />'))
})

it.each([
  local.replace(' height=', 'height='),
  local.replace('width="100"', 'width=100'),
  local.replace('width="100"', "width='100\""),
])('requires attribute separators and paired quotes in %s', (fragment) => {
  expect(renderLocalSvgInteraction(fragment)).toBeNull()
})

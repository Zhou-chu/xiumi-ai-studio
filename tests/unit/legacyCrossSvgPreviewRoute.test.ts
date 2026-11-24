import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import { nativeSvgFixture, nativeSvgProjectId } from '../fixtures/legacy-native-svg'

it('keeps the opt-in cross-SVG preview read-only and binds cancellation to the ZIP owner and token', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-cross-preview-'))
  const data = join(root, 'data'), scratch = join(root, 'scratch')
  await mkdir(scratch)
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: scratch })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const url = 'http://127.0.0.1:' + address.port + '/api/data/restore'
    const bytes = new Uint8Array(await readFile(nativeSvgFixture))
    const upload = (query = '', headers: HeadersInit = {}, source = bytes) => {
      const body = new FormData()
      body.append('file', new Blob([source]), 'synthetic.zip')
      return fetch(url + query, { method: 'POST', body, headers })
    }
    expect((await upload('?crossSvgPreview=1', { Origin: 'https://unrelated.invalid' })).status).toBe(403)
    const normal = await upload()
    const normalCookie = normal.headers.get('set-cookie')!.split(';')[0]
    expect((await normal.json()).plan).not.toHaveProperty('crossSvgPreview')
    const preview = await upload('?crossSvgPreview=1', { Cookie: normalCookie })
    expect(preview.status).toBe(200)
    const cookie = preview.headers.get('set-cookie')!.split(';')[0]
    const { token, plan } = await preview.json()
    expect(plan.projects).toEqual({ add: [], skip: [], unsupported: [nativeSvgProjectId] })
    expect(plan.crossSvgPreview).toMatchObject({ timing: 3, target: 4, context: true })
    expect(JSON.stringify(plan.crossSvgPreview)).not.toMatch(/art_trigger|art_explicit_target|<svg>/)
    const cancel = (headers: HeadersInit, key = token) => fetch(url + '/' + key + '/cancel', { method: 'POST', headers })
    expect((await cancel({})).status).toBe(404)
    expect((await cancel({ Cookie: cookie }, '0'.repeat(64))).status).toBe(404)
    expect((await cancel({ Cookie: cookie, Origin: 'https://unrelated.invalid' })).status).toBe(403)
    expect((await cancel({ Cookie: cookie })).status).toBe(204)
    expect((await cancel({ Cookie: cookie })).status).toBe(404)
    const second = await upload('?crossSvgPreview=1')
    const secondCookie = second.headers.get('set-cookie')!.split(';')[0]
    const secondPlan = await second.json()
    const apply = await fetch(url + '/' + secondPlan.token + '/apply', { method: 'POST', headers: { Cookie: secondCookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
    expect(await apply.json()).toMatchObject({ projects: { restored: [], unsupported: [nativeSvgProjectId] } })
    const archive = await JSZip.loadAsync(bytes)
    const entry = `projects/${nativeSvgProjectId}.json`
    const changed = JSON.parse(await archive.file(entry)!.async('string'))
    changed.blocks = changed.blocks.slice(2, 4).map((block: { props: { html: string } }) => ({
      ...block, props: { ...block.props, html: block.props.html.replaceAll('width="100"', 'width="80.5"').replace('fill="navy"', 'fill="#abcdef"') },
    }))
    archive.file(entry, JSON.stringify(changed))
    const varied = await upload('?crossSvgPreview=1', {}, new Uint8Array(await archive.generateAsync({ type: 'uint8array' })))
    const variedCookie = varied.headers.get('set-cookie')!.split(';')[0]
    const variant = await varied.json()
    expect(variant.plan.projects.unsupported).toEqual([nativeSvgProjectId])
    expect(variant.plan.crossSvgPreview).toMatchObject({ context: false, sourceRect: { width: 80.5, fill: '#abcdef' } })
    expect((await cancel({ Cookie: variedCookie }, variant.token)).status).toBe(204)
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(scratch)).toEqual([])
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllEnvs()
    vi.resetModules()
    await rm(root, { recursive: true, force: true })
  }
})

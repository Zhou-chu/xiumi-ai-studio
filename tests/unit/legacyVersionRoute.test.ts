import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'

const project = 'history-project'
const history = project + '/100-fixture'
const fixture = new URL('../fixtures/legacy-backup/upstream-history.zip', import.meta.url)

async function verify(mode: 'valid' | 'occupied' | 'wrong-parent' | 'oversized') {
  const temp = await mkdtemp(join(tmpdir(), 'xiumi-history-route-'))
  vi.stubEnv('DATA_DIR', join(temp, 'data'))
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: temp })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const base = `http://127.0.0.1:${address.port}`
    const url = base + '/api/data/restore'
    const original = await readFile(fixture)
    const zip = await JSZip.loadAsync(original)
    const patched = mode === 'wrong-parent' || mode === 'oversized'
    if (mode === 'wrong-parent') {
      const old = JSON.parse(await zip.file('versions/' + history + '.json')!.async('string'))
      zip.file('versions/' + history + '.json', JSON.stringify({ ...old, doc: { ...old.doc, id: 'wrong-parent' } }))
    }
    if (mode === 'oversized') zip.file('versions/' + history + '.json', 'x'.repeat(4 * 1024 * 1024 + 1))
    const body = new FormData()
    body.append('file', new Blob([new Uint8Array(patched ? await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : original)]), 'upstream.zip')
    const preview = await fetch(url, { method: 'POST', body })
    expect(preview.status).toBe(200)
    const { token, plan } = await preview.json()
    expect(plan.versions).toEqual({ add: patched ? [] : [history], skip: [] })
    expect(plan.unsupported).toEqual(patched ? ['versions/' + history + '.json'] : [])
    await expect(readdir(join(temp, 'data', 'versions'))).resolves.toEqual([])
    if (mode === 'occupied') {
      await writeFile(join(temp, 'data', 'projects', project + '.json'), JSON.stringify({ id: project, title: 'Kept local' }))
    }
    const applied = await fetch(url + '/' + token + '/apply', { method: 'POST', headers: {
      Cookie: preview.headers.get('set-cookie')!.split(';', 1)[0],
      'Content-Type': 'application/json',
    }, body: JSON.stringify({ confirm: true }) })
    expect(applied.status).toBe(200)
    expect((await applied.json()).versions).toEqual({
      restored: mode === 'valid' ? [history] : [], skipped: mode === 'occupied' ? [history] : [], failed: [],
    })
    const endpoint = base + '/api/projects/' + project + '/versions'
    if (mode === 'valid') {
      const list = await fetch(endpoint)
      expect(await list.json()).toEqual([{ id: '100-fixture', label: 'Synthetic historical snapshot', createdAt: 150, blockCount: 0 }])
      const record = await fetch(endpoint + '/100-fixture')
      expect(await record.json()).toMatchObject({ doc: { title: 'Original manuscript' } })
      const current = await (await fetch(base + '/api/projects/' + project)).json()
      const later = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Normal new version', doc: current }),
      })
      expect(later.status).toBe(200)
      expect(await (await fetch(endpoint)).json()).toEqual([
        expect.objectContaining({ label: 'Normal new version' }),
        expect.objectContaining({ id: '100-fixture', label: 'Synthetic historical snapshot' }),
      ])
    } else {
      if (patched) expect((await fetch(base + '/api/projects/' + project)).status).toBe(200)
      await expect(readdir(join(temp, 'data', 'versions'))).resolves.toEqual([])
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(temp, { recursive: true, force: true })
  }
}

it.each(['valid', 'occupied', 'wrong-parent', 'oversized'] as const)('recovers valid upstream history only with its freshly restored parent (%s)', verify)

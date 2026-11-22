import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'

const project = 'visual-history'
const visual = project + '/visual'
const text = project + '/text'
const archived = new URL('../fixtures/legacy-backup/upstream-image-history.zip', import.meta.url)
const historicFile = 'history-only.png'
const textParent = 'text-history'
const textVisual = textParent + '/visual'
const textHistoricFile = 'text-history-only.png'
const currentFile = 'current-only.png'

it.each(['valid', 'image-conflict', 'late-image-conflict', 'text-history-conflict', 'version-occupied', 'not-opted-in'] as const)(
  'restores only eligible indexed historical dependencies of a fresh parent (%s)', async mode => {
    const sandbox = await mkdtemp(join(tmpdir(), 'xiumi-legacy-image-history-'))
    const data = join(sandbox, 'data')
    vi.stubEnv('DATA_DIR', data)
    vi.resetModules()
    const { createApp } = await import('../../server/app')
    const server = createServer(createApp({ restoreTempRoot: sandbox })).listen(0, '127.0.0.1')
    try {
      await once(server, 'listening')
      const listen = server.address()
      if (typeof listen !== 'object' || !listen) throw new Error('No loopback test port')
      const base = 'http://127.0.0.1:' + listen.port
      const versions = base + '/api/projects/' + project + '/versions'
      const zipBytes = await readFile(archived)
      const zip = await JSZip.loadAsync(zipBytes)
      const fixture = await zip.file('assets/' + historicFile)!.async('nodebuffer')
      const digest = createHash('sha256').update(fixture).digest('hex')
      const retained = Buffer.from('Synthetic local conflicting data')
      const historicPath = join(data, 'assets', historicFile)
      const textHistoricPath = join(data, 'assets', textHistoricFile)
      if (mode === 'image-conflict') await writeFile(historicPath, retained)
      if (mode === 'text-history-conflict') await writeFile(textHistoricPath, retained)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(zipBytes)]), 'upstream-image-history.zip')
      const endpoint = base + '/api/data/restore'
      const preview = await fetch(endpoint + (mode === 'not-opted-in' ? '' : '?indexedImages=1'), { method: 'POST', body: form })
      expect(preview.status).toBe(200)
      const { token, plan } = await preview.json()
      if (mode === 'not-opted-in') {
        expect(plan.projects.add).toEqual([textParent])
        expect(plan.projects.unsupported).toEqual([project])
        expect(plan.versions).toEqual({ add: [], skip: [] })
        return
      }
      expect(plan.projects.add).toEqual([textParent, project])
      const orderedVersions = [textVisual, visual, text]
      const previewSkipped = mode === 'image-conflict' ? [visual] : mode === 'text-history-conflict' ? [textVisual] : []
      expect(plan.versions).toEqual({ add: orderedVersions.filter(key => !previewSkipped.includes(key)), skip: previewSkipped })
      expect(plan.assets.add).toEqual(['current-only', ...mode === 'text-history-conflict' ? [] : ['text-history-only'],
        ...mode === 'image-conflict' ? [] : ['history-only']])
      expect((await fetch(base + '/api/projects/' + project)).status).toBe(404)
      expect(await readdir(join(data, 'versions'))).toEqual([])
      const existingFiles = mode === 'image-conflict' ? [historicFile] : mode === 'text-history-conflict' ? [textHistoricFile] : []
      expect(await readdir(join(data, 'assets'))).toEqual(existingFiles)
      if (mode === 'late-image-conflict') await writeFile(historicPath, retained)
      if (mode === 'version-occupied') {
        const dir = join(data, 'versions', project)
        await mkdir(dir)
        await writeFile(join(dir, 'visual.json'), retained)
      }
      const applied = await fetch(endpoint + '/' + token + '/apply', { method: 'POST',
        headers: { Cookie: preview.headers.get('set-cookie')!.split(';', 1)[0], 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      expect(applied.status).toBe(200)
      const result = await applied.json()
      expect(result.projects.restored).toEqual([textParent, project])
      const applySkipped = mode === 'valid' ? [] : mode === 'text-history-conflict' ? [textVisual] : [visual]
      expect(result.versions).toEqual({ restored: orderedVersions.filter(key => !applySkipped.includes(key)), skipped: applySkipped, failed: [] })
      const plainParent = await (await fetch(base + '/api/projects/' + textParent)).json()
      expect(plainParent).toMatchObject({ title: 'Current text-only manuscript', blocks: [] })
      const plainVisual = await fetch(base + '/api/projects/' + textParent + '/versions/visual')
      if (mode === 'text-history-conflict') {
        expect(plainVisual.status).toBe(404)
        expect(await readFile(textHistoricPath)).toEqual(retained)
      } else {
        expect(plainVisual.status).toBe(200)
        const asset = await zip.file('assets/' + textHistoricFile)!.async('nodebuffer')
        const ref = '/media/' + textHistoricFile + '?gen=' + createHash('sha256').update(asset).digest('hex')
        expect((await plainVisual.json()).doc.blocks[0].props.image.src).toBe(ref)
        const raw = await fetch(base + ref + '&w=2400')
        expect(raw.status).toBe(200)
        expect(Buffer.from(await raw.arrayBuffer())).toEqual(asset)
      }
      const current = await (await fetch(base + '/api/projects/' + project)).json()
      expect(current.blocks[0].props.image.src).toMatch(/^\/media\/current-only\.png\?gen=[0-9a-f]{64}$/)
      expect(await readFile(join(data, 'assets', currentFile))).toEqual(await zip.file('assets/' + currentFile)!.async('nodebuffer'))
      const oldText = await (await fetch(versions + '/text')).json()
      expect(oldText.doc.title).toBe('Historical text only')
      if (mode === 'valid' || mode === 'text-history-conflict') {
        const old = await (await fetch(versions + '/visual')).json()
        const src = '/media/' + historicFile + '?gen=' + digest
        expect(old.doc.blocks[0].props.image.src).toBe(src)
        const bitmap = await fetch(base + src + '&w=2400')
        expect(bitmap.status).toBe(200)
        expect(Buffer.from(await bitmap.arrayBuffer())).toEqual(fixture)
      } else if (mode === 'image-conflict' || mode === 'late-image-conflict') {
        expect(await readFile(historicPath)).toEqual(retained)
        expect((await fetch(versions + '/visual')).status).toBe(404)
      } else {
        expect(await readFile(join(data, 'versions', project, 'visual.json'))).toEqual(retained)
        await expect(readFile(historicPath)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      vi.unstubAllEnvs()
      await rm(sandbox, { recursive: true, force: true })
    }
  },
)

it.each(['matching', 'divergent', 'edited-after-preview', 'retention-limit'] as const)(
  'adds history independently without replacing a retained manuscript (%s)', async mode => {
    const sandbox = await mkdtemp(join(tmpdir(), 'xiumi-existing-image-history-'))
    const data = join(sandbox, 'data')
    vi.stubEnv('DATA_DIR', data)
    vi.resetModules()
    const { createApp } = await import('../../server/app')
    const server = createServer(createApp({ restoreTempRoot: sandbox })).listen(0, '127.0.0.1')
    try {
      await once(server, 'listening')
      const listen = server.address()
      if (typeof listen !== 'object' || !listen) throw new Error('No loopback test port')
      const base = 'http://127.0.0.1:' + listen.port
      const zipBytes = await readFile(archived)
      const seed = await JSZip.loadAsync(zipBytes)
      seed.remove('projects/' + textParent + '.json')
      seed.remove('versions')
      // The seed uses the same upstream photo fixture and normal ZIP restore,
      // but without its old snapshots. The resulting revision belongs here.
      const original = await JSZip.loadAsync(zipBytes)
      original.remove('projects/' + textParent + '.json')
      original.remove('versions/' + textParent)
      const archivePath = base + '/api/data/restore'
      const previewArchive = async (bytes: Uint8Array<ArrayBuffer>) => {
        const form = new FormData()
        form.append('file', new Blob([bytes]), 'upstream-image-history.zip')
        const reply = await fetch(archivePath + '?indexedImages=1', { method: 'POST', body: form })
        expect(reply.status).toBe(200)
        return { ...await reply.json(), cookie: reply.headers.get('set-cookie')!.split(';', 1)[0] }
      }
      const confirm = async ({ token, cookie }: { token: string; cookie: string }) => {
        const reply = await fetch(archivePath + '/' + token + '/apply', { method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
        expect(reply.status).toBe(200)
        return reply.json()
      }
      const initial = await previewArchive(new Uint8Array(await seed.generateAsync({ type: 'uint8array' })))
      expect((await confirm(initial)).projects.restored).toEqual([project])
      const parentFile = join(data, 'projects', project + '.json')
      const parentEndpoint = base + '/api/projects/' + project
      const parentHistory = join(data, 'versions', project)
      await mkdir(parentHistory)
      const localVersionFile = join(parentHistory, 'text.json')
      const localVersion = Buffer.from(JSON.stringify({ id: 'text', projectId: project, label: 'Unrelated local version in occupied slot', createdAt: 10, doc: { blocks: [] } }))
      await writeFile(localVersionFile, localVersion)
      if (mode === 'retention-limit') {
        for (let i = 0; i < 49; i++) await writeFile(join(parentHistory, 'local-' + i + '.json'), localVersion)
      }
      const edit = async () => {
        const current = await (await fetch(parentEndpoint)).json()
        const reply = await fetch(parentEndpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...current, title: 'New local manuscript edit' }) })
        expect(reply.status).toBe(200)
      }
      if (mode === 'divergent') await edit()
      const before = await readFile(parentFile)
      const revision = JSON.parse(before.toString('utf8')).revision
      const archivedParent = JSON.parse(await original.file('projects/' + project + '.json')!.async('string'))
      expect(revision).not.toBe(archivedParent.revision)
      const baseHistory = (await readdir(parentHistory)).sort()
      const historicPath = join(data, 'assets', historicFile)
      const incoming = await previewArchive(new Uint8Array(await original.generateAsync({ type: 'uint8array' })))
      expect(incoming.plan.projects).toMatchObject({ add: [], skip: [project] })
      const ready = mode === 'matching' || mode === 'edited-after-preview'
      expect(incoming.plan.versions).toMatchObject(ready
        ? { add: [visual], skip: [text], reasons: { [text]: 'occupied' } }
        : { add: [], skip: [visual, text], reasons: { [visual]: mode === 'divergent' ? 'parent-mismatch' : 'retention-limit' } })
      expect(await readFile(parentFile)).toEqual(before)
      expect((await readdir(parentHistory)).sort()).toEqual(baseHistory)
      await expect(readFile(historicPath)).rejects.toMatchObject({ code: 'ENOENT' })
      if (mode === 'edited-after-preview') await edit()
      const beforeApply = await readFile(parentFile)
      const restored = await confirm(incoming)
      expect(restored.projects).toMatchObject({ restored: [], skipped: [project] })
      expect(await readFile(parentFile)).toEqual(beforeApply)
      expect(await readFile(localVersionFile)).toEqual(localVersion)
      if (mode === 'matching') {
        expect(restored.versions).toMatchObject({ restored: [visual], skipped: [text], reasons: { [text]: 'occupied' } })
        expect(JSON.parse((await readFile(parentFile)).toString('utf8')).revision).toBe(revision)
        const record = await (await fetch(parentEndpoint + '/versions/visual')).json()
        const raw = await fetch(base + record.doc.blocks[0].props.image.src + '&w=2400')
        expect(raw.status).toBe(200)
        expect(Buffer.from(await raw.arrayBuffer())).toEqual(await original.file('assets/' + historicFile)!.async('nodebuffer'))
      } else {
        const reason = mode === 'divergent' ? 'parent-mismatch' : mode === 'edited-after-preview' ? 'parent-changed' : 'retention-limit'
        expect(restored.versions).toMatchObject({ restored: [], skipped: [visual, text], reasons: { [visual]: reason } })
        expect((await readdir(parentHistory)).sort()).toEqual(baseHistory)
        await expect(readFile(historicPath)).rejects.toMatchObject({ code: 'ENOENT' })
      }
      expect(await readFile(archived)).toEqual(zipBytes)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      vi.unstubAllEnvs()
      await rm(sandbox, { recursive: true, force: true })
    }
  },
)

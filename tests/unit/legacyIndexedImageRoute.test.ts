import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import { compileDoc } from '../../src/core/compiler'

const fixture = fileURLToPath(new URL('../fixtures/legacy-backup/upstream-library.zip', import.meta.url))
it.each(['none', 'first', 'second', 'mixed-history', 'preview-conflict', 'reuse', 'external-reference'])('restores a managed legacy image with an optional late conflict (%s)', async conflict => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-indexed-image-'))
  vi.stubEnv('DATA_DIR', root)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp()).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen address')
    const base = `http://127.0.0.1:${address.port}`
    const rawMedia = '/media/fixture-image.png'
    const oldResponse = await fetch(base + rawMedia)
    expect(oldResponse.status).toBe(404)
    await oldResponse.text()
    let zip = await readFile(fixture)
    const parsed = await JSZip.loadAsync(zip)
    const bytes = await parsed.file('assets/fixture-image.png')!.async('nodebuffer')
    const assetIds = ['fixture-image']
    if (conflict === 'second') {
      // Synthetic two-image edge case derived from the authentic single-image ZIP.
      const id = 'fixture-second'
      const file = id + '.png'
      const archived = JSON.parse(await parsed.file('projects/archived.json')!.async('string'))
      const index = JSON.parse(await parsed.file('assets/_index.json')!.async('string'))
      index[id] = { ...index['fixture-image'], id, file }
      const block = archived.blocks[0]
      const image = { ...block.props.image, assetId: id, src: '/media/' + file }
      archived.blocks.push({ ...block, id, props: { ...block.props, image } })
      parsed.file('projects/archived.json', JSON.stringify(archived))
      parsed.file('assets/_index.json', JSON.stringify(index))
      parsed.file('assets/' + file, bytes)
      zip = Buffer.from(await parsed.generateAsync({ type: 'nodebuffer' }))
      assetIds.push(id)
    }
    if (conflict === 'mixed-history') {
      const text = JSON.parse(await parsed.file('projects/corrupt.json')!.async('string'))
      for (const projectId of ['archived', 'corrupt']) {
        parsed.file(`versions/${projectId}/version-mixed.json`, JSON.stringify({
          id: 'version-mixed', projectId, label: 'Synthetic mixed-scope test',
          createdAt: 42, doc: { ...text, id: projectId },
        }))
      }
      zip = Buffer.from(await parsed.generateAsync({ type: 'nodebuffer' }))
    }
    if (conflict === 'external-reference') {
      const project = JSON.parse(await parsed.file('projects/archived.json')!.async('string'))
      project.blocks[0].props.image.src = 'https://example.invalid/fixture-image.png'
      parsed.file('projects/archived.json', JSON.stringify(project))
      zip = Buffer.from(await parsed.generateAsync({ type: 'nodebuffer' }))
    }
    const conflictExists = ['first', 'second', 'preview-conflict'].includes(conflict)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const stored = join(root, 'assets', 'fixture-image.png')
    if (conflict === 'preview-conflict') await writeFile(stored, 'local file')
    if (conflict === 'reuse') {
      await writeFile(stored, bytes)
      const data = JSON.parse(await parsed.file('assets/_index.json')!.async('string'))
      await writeFile(join(root, 'assets', '_index.json'), JSON.stringify(data))
    }
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(zip)]), 'upstream.zip')
    const route = base + '/api/data/restore'
    const preview = await fetch(route + '?indexedImages=1', { method: 'POST', body: form })
    expect(preview.status).toBe(200)
    const cookie = preview.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toBeTruthy()
    const { token, plan } = await preview.json()
    const knownConflict = conflict === 'preview-conflict', invalidRef = conflict === 'external-reference'
    expect(plan).toMatchObject({
      projects: {
        add: knownConflict || invalidRef ? ['corrupt', 'edited'] : ['archived', 'corrupt', 'edited'],
        skip: knownConflict ? ['archived'] : [],
        unsupported: invalidRef ? ['archived'] : [],
      },
      assets: { add: knownConflict || invalidRef || conflict === 'reuse' ? [] : assetIds,
        alreadyPresent: conflict === 'reuse' ? assetIds : [], skip: knownConflict ? assetIds : [] },
      unsupported: [...(invalidRef ? ['assets/_index.json', 'assets/fixture-image.png'] : []),
        'settings.json', 'templates/fixture-template.json',
        ...(conflict === 'mixed-history' ? ['versions/archived/version-mixed.json'] : [])],
    })
    if (conflict === 'mixed-history') {
      expect(plan.versions).toEqual({ add: ['corrupt/version-mixed'], skip: [] })
    }
    await expect(readdir(join(root, 'projects'))).resolves.toEqual([])
    if (!knownConflict && conflict !== 'reuse') await expect(readdir(join(root, 'assets'))).resolves.toEqual([])
    const conflictingId = conflict === 'second' ? 'fixture-second' : 'fixture-image'
    if (conflictExists && !knownConflict) await writeFile(join(root, 'assets', conflictingId + '.png'), 'local file')
    const response = await fetch(`${route}/${token}/apply`, {
      method: 'POST',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
      body: '{"confirm":true}',
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    const project = await fetch(base + '/api/projects/archived')
    if (invalidRef) {
      expect(result.projects).toMatchObject({ restored: ['corrupt', 'edited'], unsupported: ['archived'] })
      expect(result.assets.restored).toEqual([])
      expect(project.status).toBe(404)
      await project.text()
      await expect(readdir(join(root, 'assets'))).resolves.toEqual([])
      return
    }
    if (conflictExists) {
      expect(result.projects).toMatchObject({ restored: ['corrupt', 'edited'], skipped: ['archived'] })
      expect(result.assets.skipped).toEqual([conflictingId])
      expect(result.assets.restored).toEqual([])
      expect(project.status).toBe(404)
      await project.text()
      await expect(readdir(join(root, 'assets'))).resolves.toEqual([conflictingId + '.png'])
      await expect(readFile(join(root, 'assets', conflictingId + '.png'), 'utf8')).resolves.toBe('local file')
      return
    }
    expect(result.projects.restored).toEqual(['archived', 'corrupt', 'edited'])
    expect(result.assets.restored).toEqual(conflict === 'reuse' ? [] : ['fixture-image'])
    expect(result.assets.alreadyPresent).toEqual(conflict === 'reuse' ? ['fixture-image'] : [])
    expect(project.status).toBe(200)
    if (conflict === 'mixed-history') {
      expect(result.unsupported).toContain('versions/archived/version-mixed.json')
      expect(result.versions).toEqual({ restored: ['corrupt/version-mixed'], skipped: [], failed: [] })
      expect((await fetch(base + '/api/projects/archived/versions/version-mixed')).status).toBe(404)
      expect((await fetch(base + '/api/projects/corrupt/versions/version-mixed')).status).toBe(200)
    }
    const doc = await project.json()
    const qualified = rawMedia + '?gen=' + digest
    expect(doc.blocks[0].props.image.src).toBe(qualified)
    const assetsResponse = await fetch(base + '/api/assets')
    expect(await assetsResponse.json()).toEqual([expect.objectContaining({
      id: 'fixture-image', ...(conflict !== 'reuse' && { generation: digest }),
    })])
    const html = compileDoc(doc).html
    const render = html.match(/<img src="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')
    expect(render).toContain('gen=' + digest)
    const pixels = await fetch(base + render)
    expect(pixels.status).toBe(200)
    expect(pixels.headers.get('content-type')).toBe('image/png')
    await expect(readFile(stored)).resolves.toEqual(bytes)
  } finally {
    server.close()
    await once(server, 'close')
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  }
})

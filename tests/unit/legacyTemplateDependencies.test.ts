import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import { cloneBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import { resolveTheme, THEMES } from '../../src/core/themes'
import type { Block, Doc } from '../../src/core/types'

const archive = new URL('../fixtures/legacy-backup/upstream-template-only.zip', import.meta.url)
const imageId = 'fixture-template-image', textId = 'fixture-template-overrides'
const asset = 'fixture-template-only-teal', name = asset + '.png'
const pngHash = 'ee4467ea86fba01e26dbf35145b490663e0f85e9799e88ae2fde5d4874dcaf1b'

it.each(['clean', 'design-only', 'occupied', 'binary-conflict', 'malformed'] as const)('keeps template-only dependencies add-only (%s)', async mode => {
  const tmp = await mkdtemp(join(tmpdir(), 'xiumi-template-route-'))
  const data = join(tmp, 'library')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: tmp })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address')
    const base = 'http://127.0.0.1:' + address.port, route = base + '/api/data/restore'
    let bytes = await readFile(archive)
    const zip = await JSZip.loadAsync(bytes)
    if (mode === 'malformed') {
      const record = JSON.parse(await zip.file('templates/' + textId + '.json')!.async('string'))
      record.themeOverrides.colors.primary = 'invalid color'
      zip.file('templates/' + textId + '.json', JSON.stringify(record))
      bytes = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
    }
    const preview = async (options: string, cookie?: string) => {
      const body = new FormData()
      body.append('file', new Blob([new Uint8Array(bytes)]), 'upstream-template-only.zip')
      const response = await fetch(route + options, { method: 'POST', body, headers: cookie ? { Cookie: cookie } : {} })
      expect(response.status).toBe(200)
      return { ...await response.json(), cookie: response.headers.get('set-cookie')!.split(';')[0] }
    }
    const design = await preview('?design=1')
    expect(design.plan.design.templates.add).toEqual(mode === 'malformed' ? [] : [textId])
    expect(design.plan.unsupported).toContain('templates/' + imageId + '.json')
    let selected = design
    if (mode !== 'design-only') {
      const images = await preview('?indexedImages=1', design.cookie)
      expect(images.plan.design).toBeUndefined()
      expect(images.plan.assets.add).toEqual([])
      selected = await preview('?design=1&indexedImages=1', images.cookie)
      expect(selected.plan.design.templates.add).toEqual(mode === 'malformed' ? [imageId] : [imageId, textId])
      expect(selected.plan.assets.add).toEqual([asset])
    }
    expect(selected.plan.projects.add).toEqual([])
    expect(await readdir(join(data, 'templates'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual([])
    const templateFile = join(data, 'templates', imageId + '.json'), assetFile = join(data, 'assets', name)
    if (mode === 'occupied') await writeFile(templateFile, 'interrupted local template')
    if (mode === 'binary-conflict') await writeFile(assetFile, 'unrelated local bytes')
    const response = await fetch(route + '/' + selected.token + '/apply', { method: 'POST', headers: { Cookie: selected.cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.design.templates.restored).toEqual(mode === 'clean' ? [imageId, textId] : mode === 'malformed' ? [imageId] : [textId])
    if (mode !== 'malformed') {
      const templates = await (await fetch(base + '/api/templates')).json()
      const saved = templates.find((template: { id: string }) => template.id === textId)
      const id = 'instantiated-style'
      const doc = { ...saved, id, title: saved.name, blocks: saved.blocks.map((block: Block) => cloneBlock(block)), author: '', digest: '' }
      const put = await fetch(base + '/api/projects/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) })
      expect(put.status).toBe(200)
      await put.text()
      const opened = await (await fetch(base + '/api/projects/' + id)).json() as Doc
      expect(opened.themeOverrides).toEqual({ fontSize: 17, colors: { primary: '#27506A' } })
      expect(resolveTheme(opened)).toMatchObject({ fontSize: 17, colors: { primary: '#27506A', text: THEMES.find(theme => theme.id === 'tech-blue')!.colors.text } })
      expect(compileDoc(opened).html).toContain('border-left:4px solid #27506A')
    }
    if (mode === 'design-only') {
      expect(result.assets).toBeUndefined()
      expect(await readdir(join(data, 'templates'))).toEqual([textId + '.json'])
      expect(await readdir(join(data, 'assets'))).toEqual([])
    } else if (mode === 'occupied') {
      expect(result.design.templates.conflicts).toEqual([imageId])
      expect(await readFile(templateFile, 'utf8')).toBe('interrupted local template')
      expect(await readdir(join(data, 'assets'))).toEqual([])
    } else if (mode === 'binary-conflict') {
      expect(result.design.templates.unresolved).toEqual([imageId])
      expect(await readFile(assetFile, 'utf8')).toBe('unrelated local bytes')
      expect(await readdir(join(data, 'assets'))).toEqual([name])
    } else {
      const saved = await (await fetch(base + '/api/templates')).json()
      expect(saved).toContainEqual(expect.objectContaining({ id: imageId, blocks: [expect.objectContaining({ props: expect.objectContaining({ image: expect.objectContaining({ src: '/media/' + name + '?gen=' + pngHash }) }) })] }))
      const media = await fetch(base + '/media/' + name + '?gen=' + pngHash)
      expect(media.status).toBe(200)
      const png = Buffer.from(await media.arrayBuffer())
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([7, 5])
      expect(await readFile(assetFile)).toEqual(await zip.file('assets/' + name)!.async('nodebuffer'))
      expect((await preview('?design=1&indexedImages=1')).plan.design.templates.alreadyPresent).toContain(imageId)
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(tmp, { recursive: true, force: true })
  }
})

const boxArchive = new URL('../fixtures/legacy-backup/upstream-template-box.zip', import.meta.url)
const boxTemplate = 'fixture-template-box'
const boxAsset = 'fixture-template-box-teal'
const boxPngHash = 'cfe2fa9eb3c9be7dab3ed1ae3b8a4e1b074d8216c7f6cf3e113d70ca2f16dd12'

it.each(['clean', 'occupied', 'asset-conflict', 'unsupported-child'] as const)('restores native box dependencies via public library and project routes (%s)', async mode => {
  const tmp = await mkdtemp(join(tmpdir(), 'xiumi-box-template-'))
  const data = join(tmp, 'library')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: tmp })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address')
    const base = 'http://127.0.0.1:' + address.port
    const route = base + '/api/data/restore'
    let bytes = new Uint8Array(await readFile(boxArchive))
    if (mode === 'unsupported-child') {
      const zip = await JSZip.loadAsync(bytes)
      const path = 'templates/' + boxTemplate + '.json'
      const template = JSON.parse(await zip.file(path)!.async('string'))
      template.blocks[0].props.children[2].props.unexpected = 'unsupported'
      zip.file(path, JSON.stringify(template))
      bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
    }
    const preview = async (options: string, cookie?: string) => {
      const body = new FormData()
      body.append('file', new Blob([bytes]), 'upstream-template-box.zip')
      const response = await fetch(route + options, { method: 'POST', body, headers: cookie ? { Cookie: cookie } : {} })
      expect(response.status).toBe(200)
      return { ...await response.json(), cookie: response.headers.get('set-cookie')!.split(';')[0] }
    }
    const design = await preview('?design=1')
    expect(design.plan.design.templates.add).toEqual([])
    expect(design.plan.unsupported).toContain('templates/' + boxTemplate + '.json')
    const both = await preview('?design=1&indexedImages=1', design.cookie)
    const rejected = mode === 'unsupported-child'
    expect(both.plan.design.templates.add).toEqual(rejected ? [] : [boxTemplate])
    expect(both.plan.assets.add).toEqual(rejected ? [] : [boxAsset])
    if (rejected) expect(both.plan.unsupported).toContain('templates/' + boxTemplate + '.json')
    expect(both.plan.projects.add).toEqual([])
    expect(await readdir(join(data, 'templates'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual([])
    const templateFile = join(data, 'templates', boxTemplate + '.json')
    const pngFile = join(data, 'assets', boxAsset + '.png')
    if (mode === 'occupied') await writeFile(templateFile, 'local template')
    if (mode === 'asset-conflict') await writeFile(pngFile, 'local asset')
    const applied = await fetch(route + '/' + both.token + '/apply', { method: 'POST', headers: { Cookie: both.cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
    expect(applied.status).toBe(200)
    const outcome = await applied.json()
    if (mode === 'unsupported-child') {
      expect(outcome.design.templates.restored).toEqual([])
      expect(await readdir(join(data, 'templates'))).toEqual([])
      expect(await readdir(join(data, 'assets'))).toEqual([])
    } else if (mode === 'occupied') {
      expect(outcome.design.templates.conflicts).toEqual([boxTemplate])
      expect(await readFile(templateFile, 'utf8')).toBe('local template')
      expect(await readdir(join(data, 'assets'))).toEqual([])
    } else if (mode === 'asset-conflict') {
      expect(outcome.design.templates.unresolved).toEqual([boxTemplate])
      expect(await readFile(pngFile, 'utf8')).toBe('local asset')
      expect(await readdir(join(data, 'templates'))).toEqual([])
    } else {
      expect(outcome.design.templates.restored).toEqual([boxTemplate])
      const [template] = await (await fetch(base + '/api/templates')).json() as { name: string; blocks: [Block<'box'>]; themeId: string }[]
      const source = template.blocks[0]
      const ids = (box: Block<'box'>) => [box.id, ...box.props.children.map(child => child.id)]
      const seen = new Set(ids(source))
      for (const id of ['from-box-first', 'from-box-second']) {
        const doc = { id, title: template.name, themeId: template.themeId, author: '', digest: '', createdAt: 1, updatedAt: 1, blocks: [cloneBlock(source)] }
        const url = base + '/api/projects/' + id
        const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) })
        expect(put.status).toBe(200)
        await put.text()
        const opened = await (await fetch(url)).json() as Doc
        const [box] = opened.blocks as [Block<'box'>]
        expect(box.type).toBe('box')
        expect(box.props.children.map(child => child.type)).toEqual(['heading', 'image', 'quote'])
        for (const block of ids(box)) { expect(seen.has(block)).toBe(false); seen.add(block) }
        const html = compileDoc(opened).html
        const markers = ['Before the boxed image', 'Only the box contains this teal image', 'After the boxed image'].map(text => html.indexOf(text))
        expect(markers[0]).toBeGreaterThanOrEqual(0)
        expect(markers[1]).toBeGreaterThan(markers[0])
        expect(markers[2]).toBeGreaterThan(markers[1])
      }
      const picture = await fetch(base + '/media/' + boxAsset + '.png?gen=' + boxPngHash)
      expect(picture.status).toBe(200)
      const png = Buffer.from(await picture.arrayBuffer())
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([11, 9])
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    vi.unstubAllEnvs()
    await rm(tmp, { recursive: true, force: true })
  }
})

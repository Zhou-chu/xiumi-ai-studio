import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { cloneBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'
import type { Block, Doc } from '../../src/core/types'

const fixture = new URL('../fixtures/legacy-backup/upstream-native-photo-slots.zip', import.meta.url)
const pair = 'slots-control-pair', empty = 'slots-four-empty', four = 'slots-four-mixed', three = 'slots-three-mixed'
const records = [pair, empty, four, three]
const assets = ['slots-blue', 'slots-green', 'slots-red', 'slots-violet']
type Template = { id: string; name: string; themeId: string; roles: Record<string, string>; blocks: [Block<'photos'>] }

it.each(['clean', 'design-only', 'conflict', 'invalid-slots'] as const)('restores ordered native photo slots through the real library route (%s)', async mode => {
  const temp = await mkdtemp(join(tmpdir(), 'xiumi-photo-slots-'))
  const data = join(temp, 'data')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: temp })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('missing loopback address')
    const base = 'http://127.0.0.1:' + address.port, route = base + '/api/data/restore'
    let archive = new Uint8Array(await readFile(fixture))
    if (mode === 'invalid-slots') {
      const zip = await JSZip.loadAsync(archive)
      const change = async (id: string, modify: (props: { count: number; pics: unknown[] }) => void) => {
        const path = 'templates/' + id + '.json'
        const document = JSON.parse(await zip.file(path)!.async('string'))
        modify(document.blocks[0].props)
        zip.file(path, JSON.stringify(document))
      }
      await change(three, props => { props.pics.splice(1, 1) })
      await change(four, props => { props.pics[0] = { caption: 'not empty', image: null } })
      archive = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
    }
    const preview = async (flags: string, cookie?: string) => {
      const form = new FormData()
      form.append('file', new Blob([archive]), 'upstream-native-photo-slots.zip')
      const response = await fetch(route + flags, { method: 'POST', body: form, headers: cookie ? { Cookie: cookie } : {} })
      expect(response.status).toBe(200)
      return { ...await response.json(), cookie: response.headers.get('set-cookie')!.split(';', 1)[0] }
    }
    const design = await preview('?design=1')
    expect(design.plan.design.templates.add).toEqual([empty])
    expect(design.plan.unsupported).toContain('templates/' + three + '.json')
    expect(design.plan.assets).toBeUndefined()
    if (mode === 'design-only') {
      const applied = await fetch(route + '/' + design.token + '/apply', { method: 'POST', headers: { Cookie: design.cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
      expect(applied.status).toBe(200)
      const result = await applied.json()
      expect(result.design.templates.restored).toEqual([empty])
      expect(result.assets).toBeUndefined()
      expect(await readdir(join(data, 'templates'))).toEqual([empty + '.json'])
      expect(await readdir(join(data, 'assets'))).toEqual([])
      return
    }
    if (mode === 'conflict') await writeFile(join(data, 'assets/slots-green.png'), 'unrelated local bytes')
    const selected = await preview('?design=1&indexedImages=1', design.cookie)
    const expected = mode === 'conflict' ? [pair, empty, three] : mode === 'invalid-slots' ? [pair, empty] : records
    expect(selected.plan.design.templates.add).toEqual(expected)
    const assetPlan = mode === 'clean' ? assets : assets.filter(id => id !== 'slots-green' && (mode !== 'invalid-slots' || id !== 'slots-violet'))
    expect([...selected.plan.assets.add].sort()).toEqual(assetPlan)
    expect(selected.plan.design.templates.unresolved).toEqual(mode === 'conflict' ? [four] : [])
    if (mode === 'invalid-slots') expect(selected.plan.unsupported).toEqual(expect.arrayContaining(['templates/' + three + '.json', 'templates/' + four + '.json']))
    expect(await readdir(join(data, 'templates'))).toEqual([])
    expect(await readdir(join(data, 'projects'))).toEqual([])
    expect(await readdir(join(data, 'assets'))).toEqual(mode === 'conflict' ? ['slots-green.png'] : [])
    const applied = await fetch(route + '/' + selected.token + '/apply', { method: 'POST', headers: { Cookie: selected.cookie, 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
    expect(applied.status).toBe(200)
    expect((await applied.json()).design.templates.restored).toEqual(expected)
    const templates: Template[] = await (await fetch(base + '/api/templates')).json()
    const read = (id: string) => templates.find(template => template.id === id)!
    expect(read(empty).blocks[0].props.pics).toEqual([{ caption: 'Empty first' }, { caption: '' }, { caption: 'Empty third' }, { caption: '' }])
    if (mode === 'conflict') expect(await readFile(join(data, 'assets/slots-green.png'), 'utf8')).toBe('unrelated local bytes')
    if (mode !== 'clean') return

    expect(read(three).roles).toEqual({ photos: 'img3big' })
    expect(read(three).blocks[0].props.pics.map(slot => slot.image?.assetId ?? null)).toEqual(['slots-red', null, 'slots-violet'])
    expect(read(four).roles).toEqual({ photos: 'img4' })
    expect(read(four).blocks[0].props.pics.map(slot => slot.image?.assetId ?? null)).toEqual([null, 'slots-blue', null, 'slots-green'])

    const zip = await JSZip.loadAsync(archive)
    const pixels = { 'slots-red': [179, 31, 43, 255], 'slots-blue': [21, 74, 182, 255], 'slots-green': [23, 163, 107, 255], 'slots-violet': [113, 62, 153, 255] }
    for (const id of [three, four]) {
      const saved = read(id)
      const block = cloneBlock(saved.blocks[0]) as Block<'photos'>
      const pics = block.props.pics.map((slot, i) => ({ ...slot, caption: slot.image ? slot.caption + ' edited' : 'Unfilled ' + i }))
      block.props = { ...block.props, pics }
      const doc: Doc = { id: 'applied-' + id, title: saved.name, themeId: saved.themeId, blocks: [block], author: '', digest: '', createdAt: 1, updatedAt: 1 }
      const destination = base + '/api/projects/' + doc.id
      const put = await fetch(destination, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) })
      expect(put.status).toBe(200)
      const opened: Doc = await (await fetch(destination)).json()
      expect(opened.blocks[0].props).toEqual(block.props)
      const images = new Map<string, string>()
      const expectedPixels: number[][] = []
      for (const slot of pics) {
        if (!slot.image) continue
        const { src, assetId } = slot.image
        expect(src).toMatch(/^\/media\/slots-\w+\.png\?gen=[a-f0-9]{64}$/)
        const resource = await fetch(base + src)
        expect(resource.status).toBe(200)
        const bytes = Buffer.from(await resource.arrayBuffer())
        expect(bytes).toEqual(await zip.file('assets/' + assetId + '.png')!.async('nodebuffer'))
        expectedPixels.push(pixels[assetId as keyof typeof pixels])
      }
      const renderUrls = new Set<string>()
      compileDoc(opened, { mapImage: src => { renderUrls.add(src); return src } })
      expect([...renderUrls].map(src => new URL(base + src).pathname)).toEqual(pics.flatMap(slot => slot.image ? [slot.image.src.split('?')[0]] : []))
      for (const src of renderUrls) {
        const resource = await fetch(base + src)
        expect(resource.status).toBe(200)
        const bytes = Buffer.from(await resource.arrayBuffer())
        images.set(src, 'data:image/png;base64,' + bytes.toString('base64'))
      }
      const html = compileDoc(opened, { mapImage: src => images.get(src) ?? src }).html
      expect(html).not.toContain('/media/')
      const sources = [...html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)].map(match => Buffer.from(match[1], 'base64'))
      const decodedPixels = await Promise.all(sources.map(async bytes => [...(await sharp(bytes).ensureAlpha().raw().toBuffer()).subarray(0, 4)]))
      expect(decodedPixels).toEqual(expectedPixels)
      for (const slot of pics) expect(html).toContain(slot.caption)
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(temp, { recursive: true, force: true })
  }
})

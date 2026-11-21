import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import { assemble, layoutsFor, photoCapacity } from '../../src/core/assemble'
import type { Copy } from '../../src/core/copy'
import { checkPlan, fixedPlacements } from '../../src/core/photoPlan'
import { assetRef, type Asset, type Template } from '../../src/editor/api'
import { kitCandidates, resolveKit } from '../../src/editor/KitPicker'
import { compileForWechat, standaloneHtml } from '../../src/editor/wechatOutput'
import { expect, it, vi } from 'vitest'

const id = 'synthetic-paired-template'
const entry = 'templates/' + id + '.json'
const assets = ['archive-left-violet', 'archive-right-teal']
const names = assets.map(id => id + '.png')
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const fixture = new URL('../fixtures/legacy-backup/upstream-native-dual-photo.zip', import.meta.url)

async function applyAndExport(base: string, original: Template) {
  const upload = new FormData()
  for (const name of ['replacement-left-red.png', 'replacement-right-blue.png']) {
    const bytes = await readFile(new URL('../fixtures/legacy-backup/' + name, import.meta.url))
    upload.append('files', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), name)
  }
  const received = await fetch(base + '/api/assets', { method: 'POST', body: upload })
  expect(received.status).toBe(200)
  const replacements = ((await received.json()) as Asset[]).map(assetRef)
  const kit = resolveKit(kitCandidates([original], [original.id], [], []), {})
  expect(photoCapacity(kit.img2lr!.block)).toBe(2)
  expect(layoutsFor(kit, 2)).toEqual(['img2lr'])
  const copy: Copy = { title: 'Synthetic pair application', subtitle: '', credits: [], items: [
    { id: 'h', kind: 'heading', level: 1, text: 'Applied section' }, { id: 'p', kind: 'para', text: 'Anchor prose.' },
  ] }
  const input = { copy, kit, units: [{ key: 'group', photos: [0, 1], grouped: true, anchor: 'Anchor prose.', layout: 'img2lr' as const }],
    crowd: {}, singlesFor: new Set<string>() }
  expect(checkPlan(copy, kit, input.units).noLayout).toEqual([])
  const { doc } = assemble(copy, kit, replacements, fixedPlacements(input).fixed, { captions: ['New left red', 'New right blue'] })
  expect(doc.blocks.map(block => block.type)).toEqual(['heading', 'paragraph', 'photos'])
  expect(doc.blocks.every(block => !original.blocks.some(archived => archived.id === block.id))).toBe(true)
  const pair = doc.blocks[2]
  if (pair.type !== 'photos') throw new Error('Expected a pair')
  expect(pair.props.pics.map(slot => slot.image?.src)).toEqual(replacements.map(ref => ref.src))
  const fetchLocal = globalThis.fetch
  const requested: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    if (!url.startsWith('/media/')) throw new Error('Unexpected publication or other external request')
    requested.push(new URL(url, base).pathname)
    return fetchLocal(base + url)
  })
  // Node's FileReader shim only reads bytes from the actual loopback response.
  vi.stubGlobal('FileReader', class {
    result = ''
    onload = () => {}
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(bytes => {
        this.result = 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64')
        this.onload()
      })
    }
  })
  try {
    const html = standaloneHtml(doc, (await compileForWechat(doc, 'embed')).html)
    expect(html).not.toMatch(/\/media\/|Archive left placeholder|Archive right placeholder|Archived unused heading/)
    expect(html).toContain('New left red')
    expect(html).toContain('New right blue')
    expect(requested).toEqual(replacements.map(ref => ref.src.split('?')[0]))
    const images = [...html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)]
    expect(images).toHaveLength(2)
    const pixels = await Promise.all(images.map(match => sharp(Buffer.from(match[1], 'base64')).raw().toBuffer()))
    expect(pixels[0][0]).toBeGreaterThan(pixels[0][2] + 100)
    expect(pixels[1][2]).toBeGreaterThan(pixels[1][0] + 100)
  } finally { vi.unstubAllGlobals() }
}

it.each(['clean', 'design-only', 'indexed-only', 'late-conflict', 'tampered-dimensions', 'external-second', 'wrong-count', 'malformed-second'] as const)(
  'qualifies both native pair slots only with exact indexed bytes and both restore choices (%s)', async mode => {
    const temp = await mkdtemp(join(tmpdir(), 'xiumi-native-pair-'))
    const root = join(temp, 'data')
    vi.stubEnv('DATA_DIR', root)
    vi.resetModules()
    const { createApp } = await import('../../server/app')
    const server = createServer(createApp({ restoreTempRoot: temp })).listen(0, '127.0.0.1')
    try {
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No loopback test listener')
      const base = 'http://127.0.0.1:' + address.port
      const original = await readFile(fixture)
      const zip = await JSZip.loadAsync(original)
      const template = JSON.parse(await zip.file(entry)!.async('string'))
      const pictures = await Promise.all(names.map(file => zip.file('assets/' + file)!.async('nodebuffer')))
      const pair = template.blocks[2].props
      if (mode === 'tampered-dimensions') pair.pics[1].image.height = 13
      if (mode === 'external-second') pair.pics[1].image.src = 'https://fixture.invalid/foreign.png'
      if (mode === 'wrong-count') pair.count = 3
      if (mode === 'malformed-second') pair.pics[1].html = '<p>unallowed</p>'
      const isSupported = mode === 'clean' || mode === 'late-conflict'
      let bytes: Uint8Array<ArrayBufferLike> = original
      if (!isSupported && mode !== 'design-only' && mode !== 'indexed-only') {
        zip.file(entry, JSON.stringify(template))
        bytes = await zip.generateAsync({ type: 'nodebuffer' })
      }
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytes)]), 'upstream-native-dual-photo.zip')
      const url = base + '/api/data/restore'
      const flags = mode === 'design-only' ? '?design=1' : mode === 'indexed-only' ? '?indexedImages=1' : '?design=1&indexedImages=1'
      const preview = await fetch(url + flags, { method: 'POST', body: form })
      expect(preview.status).toBe(200)
      const { token, plan } = await preview.json()
      expect(await readdir(join(root, 'templates'))).toEqual([])
      expect(await readdir(join(root, 'assets'))).toEqual([])
      if (!isSupported) {
        expect(plan.unsupported).toContain(entry)
        expect(plan.design?.templates.add ?? []).toEqual([])
        expect(plan.assets?.add ?? []).toEqual([])
        return
      }
      expect(plan.design.templates.add).toEqual([id])
      expect(plan.assets.add).toEqual(assets)
      const path = join(root, 'assets', names[1])
      const local = 'Synthetic conflicting second photo'
      if (mode === 'late-conflict') await writeFile(path, local)
      const result = await fetch(url + '/' + token + '/apply', {
        method: 'POST', body: JSON.stringify({ confirm: true }),
        headers: { Cookie: preview.headers.get('set-cookie')!.split(';', 1)[0], 'Content-Type': 'application/json' },
      })
      expect(result.status).toBe(200)
      const applied = await result.json()
      if (mode === 'late-conflict') {
        expect(applied.design.templates.unresolved).toEqual([id])
        expect(applied.assets.skipped).toEqual([assets[1]])
        expect(await readdir(join(root, 'templates'))).toEqual([])
        expect(await readdir(join(root, 'assets'))).toEqual([names[1]])
        expect(await readFile(path, 'utf8')).toBe(local)
        return
      }
      expect(applied.design.templates.restored).toEqual([id])
      expect(applied.assets.restored).toEqual(assets)
      const [saved] = await (await fetch(base + '/api/templates')).json()
      expect(saved.roles).toEqual(template.roles)
      expect(saved.blocks.map((block: { id: string }) => block.id)).toEqual(template.blocks.map((block: { id: string }) => block.id))
      expect(saved.blocks[2]).toMatchObject({ type: 'photos', props: { layout: 'even', ratio: '4:3', count: 2 } })
      for (const [i, file] of names.entries()) {
        const image = '/media/' + file + '?gen=' + sha256(pictures[i])
        expect(saved.blocks[2].props.pics[i]).toEqual({ ...pair.pics[i], image: { ...pair.pics[i].image, src: image } })
        const local = await fetch(base + image + '&w=2400')
        expect(local.status).toBe(200)
        expect(Buffer.from(await local.arrayBuffer())).toEqual(pictures[i])
      }
      await applyAndExport(base, saved)
      expect((await (await fetch(base + '/api/templates')).json())[0]).toEqual(saved)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      vi.unstubAllEnvs()
      await rm(temp, { recursive: true, force: true })
    }
  },
)

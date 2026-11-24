import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import type { Doc } from '../../src/core/types'

const fixture = new URL('../fixtures/legacy-backup/upstream-native-data-blocks.zip', import.meta.url)
const IDs = ['native-space-divider', 'native-table', 'native-timeline', 'simple'] as const

async function withRestore(run: (context: {
  base: string
  data: string
  zip: Buffer
  importZip: (zip: Buffer) => Promise<Response>
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-native-data-restore-'))
  const data = join(dir, 'data')
  const scratch = join(dir, 'scratch')
  vi.stubEnv('DATA_DIR', data)
  vi.resetModules()
  await mkdir(scratch)
  const { createApp } = await import('../../server/app')
  const server = createServer(createApp({ restoreTempRoot: scratch })).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No listen port')
    const base = 'http://127.0.0.1:' + address.port
    await run({
      base, data, zip: await readFile(fixture),
      importZip: (zip) => {
        const form = new FormData()
        form.append('file', new Blob([new Uint8Array(zip)]), 'upstream-native-data-blocks.zip')
        return fetch(base + '/api/data/restore', { method: 'POST', body: form })
      },
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  }
}

it('restores genuine upstream timeline, table and space divider for edit and export', async () => {
  await withRestore(async ({ base, data, zip, importZip }) => {
    const preview = await importZip(zip)
    expect(preview.status).toBe(200)
    const { token, plan } = await preview.json()
    expect(plan.projects).toEqual({ add: [...IDs], skip: [], unsupported: [] })
    expect(await readdir(join(data, 'projects'))).toEqual([])
    const cookie = preview.headers.get('set-cookie')!.split(';', 1)[0]
    const apply = await fetch(base + '/api/data/restore/' + token + '/apply', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    })
    expect(apply.status).toBe(200)
    expect((await apply.json()).projects).toEqual({ restored: [...IDs], skipped: [], failed: [], unsupported: [] })

    const load = async (id: string): Promise<Doc> => {
      const response = await fetch(base + '/api/projects/' + id)
      expect(response.status).toBe(200)
      return response.json()
    }
    const [space, table, timeline] = await Promise.all(IDs.slice(0, 3).map(load))
    expect(space.blocks).toEqual([{ id: 'divider', type: 'divider', props: { variant: 'space' } }])
    expect(table.blocks).toEqual([{ id: 'table', type: 'table', props: { headers: ['Name', 'Count'], rows: [['Apples', '2']], caption: 'Results' } }])
    expect(timeline.blocks).toEqual([{ id: 'timeline', type: 'timeline', props: { items: [{ time: '09:00', title: 'Start', desc: 'Report' }] } }])

    const { useStore, saveNow } = await import('../../src/editor/store')
    const { compileForWechat } = await import('../../src/editor/wechatOutput')
    const request = globalThis.fetch
    const local = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      request(typeof input === 'string' && input.startsWith('/') ? base + input : input, init))
    try {
      useStore.getState().load(timeline)
      useStore.getState().updateProps('timeline', { items: [{ time: '09:30', title: 'Q&A <TBA>', desc: 'Report' }] })
      expect(await saveNow()).toBe(true)
      useStore.getState().load(await load(timeline.id))
      const timelineExport = await compileForWechat(useStore.getState().doc, 'embed')
      expect(timelineExport.html).toContain('09:30')
      expect(timelineExport.html).toContain('Q&amp;A &lt;TBA&gt;')
      expect(timelineExport.html).not.toContain('<TBA>')
      useStore.getState().load(table)
      useStore.getState().updateProps('table', { rows: [['Apples', '3']] })
      expect(await saveNow()).toBe(true)
      useStore.getState().load(await load(table.id))
      const tableExport = await compileForWechat(useStore.getState().doc, 'embed')
      expect(tableExport.html).toContain('>3</td>')
      useStore.getState().load(space)
      useStore.getState().updateProps('divider', { variant: 'dots' })
      expect(await saveNow()).toBe(true)
      useStore.getState().updateProps('divider', { variant: 'space' })
      expect(await saveNow()).toBe(true)
      useStore.getState().load(await load(space.id))
      expect(useStore.getState().doc.blocks[0].props).toEqual({ variant: 'space' })
      const spaceExport = await compileForWechat(useStore.getState().doc, 'embed')
      expect(spaceExport.html).toContain('height:24px')
      expect([...timelineExport.warnings, ...tableExport.warnings, ...spaceExport.warnings].join('')).not.toContain('数据异常')
    } finally { local.mockRestore() }
  })
})

it('reports malformed and over-budget native data projects as unsupported without writing them', async () => {
  await withRestore(async ({ data, zip, importZip }) => {
    const mutated = await JSZip.loadAsync(zip)
    const mutate = async (source: string, id: string, props: unknown) => {
      const doc = JSON.parse(await mutated.file('projects/' + source + '.json')!.async('string'))
      mutated.file('projects/' + id + '.json', JSON.stringify({ ...doc, id, blocks: [{ ...doc.blocks[0], props }] }))
    }
    await Promise.all([
      mutate('native-timeline', 'timeline-extra', { items: [{ time: 'now', title: 'name', desc: '', other: 'unrecognized' }] }),
      mutate('native-timeline', 'timeline-too-large', { items: Array.from({ length: 129 }, () => ({ time: '', title: '', desc: '' })) }),
      mutate('native-table', 'table-object-cell', { headers: ['A'], rows: [[{ value: 1 }]], caption: '' }),
      mutate('native-table', 'table-too-wide', { headers: Array(33).fill('A'), rows: [], caption: '' }),
      mutate('native-table', 'table-text-too-long', { headers: ['A'], rows: [['a'.repeat(2001)]], caption: '' }),
      mutate('native-space-divider', 'space-extra', { variant: 'space', extra: '' }),
    ])
    const preview = await importZip(await mutated.generateAsync({ type: 'nodebuffer' }))
    expect(preview.status).toBe(200)
    const { plan } = await preview.json()
    expect(plan.projects.add).toEqual([...IDs])
    expect([...plan.projects.unsupported].sort()).toEqual([
      'space-extra', 'table-object-cell', 'table-text-too-long', 'table-too-wide', 'timeline-extra', 'timeline-too-large',
    ])
    expect(await readdir(join(data, 'projects'))).toEqual([])
  })
})


it('treats media-like paths in admitted table text as literal but still excludes missing real image dependencies', async () => {
  await withRestore(async ({ zip, importZip }) => {
    const mutated = await JSZip.loadAsync(zip)
    const table = JSON.parse(await mutated.file('projects/native-table.json')!.async('string'))
    table.blocks[0].props.caption = 'Local path reference /media/known.png'
    mutated.file('projects/native-table.json', JSON.stringify(table))
    const timeline = JSON.parse(await mutated.file('projects/native-timeline.json')!.async('string'))
    timeline.blocks[0].props.items[0].desc = 'See /media/other.jpg'
    mutated.file('projects/native-timeline.json', JSON.stringify(timeline))
    mutated.file('projects/missing-image.json', JSON.stringify({
      ...table, id: 'missing-image',
      blocks: [{ id: 'photo', type: 'image', props: { image: { src: '/media/known.png', assetId: 'known', alt: '' }, caption: '', variant: 'full' } }],
    }))
    const preview = await importZip(await mutated.generateAsync({ type: 'nodebuffer' }))
    expect(preview.status).toBe(200)
    const { plan } = await preview.json()
    expect(plan.projects.add).toEqual([...IDs])
    expect(plan.projects.unsupported).toEqual(['missing-image'])
  })
})

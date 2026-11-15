import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { LibraryComponent } from '../../src/core/components'

const h = vi.hoisted(() => {
  const unexpected = () => { throw Error('Unexpected component storage boundary') }
  return {
    exists: vi.fn<(path: string) => boolean>(unexpected),
    list: vi.fn<() => Promise<LibraryComponent[]>>(unexpected),
    get: vi.fn<(id: string) => Promise<LibraryComponent | undefined>>(unexpected),
    put: vi.fn<(item: LibraryComponent) => Promise<void>>(unexpected),
    remove: vi.fn<(id: string) => Promise<void>>(unexpected),
    id: vi.fn<(size: number) => string>(unexpected),
    fetch: vi.fn(unexpected),
  }
})
vi.mock('node:fs', () => ({ existsSync: h.exists }))
vi.mock('nanoid', () => ({ nanoid: h.id }))
vi.mock('../../server/store', () => ({
  DIRS: { components: '/virtual-components', assets: '/virtual-assets' },
  collection: (dir: string) => {
    if (dir !== '/virtual-components') throw Error('Unexpected collection path')
    return h
  },
}))

const { listComponents, missingAssets, removeComponent, saveComponent, updateComponent } =
  await import('../../server/components')

const draft = {
  name: '旧名',
  kind: 'image',
  tags: ['旧标签'],
  block: { id: 'fixture-block', type: 'paragraph' as const, props: { content: { type: 'doc', content: [] }, align: 'left' as const } },
  fingerprint: 'fixture-layout',
  origin: { kind: 'original', attested: true },
}
const existing = (overrides: Partial<LibraryComponent> = {}): LibraryComponent => ({
  ...draft,
  block: draft.block,
  origin: { kind: 'original', attested: true, via: 'block', attestedAt: 7, redistributable: true, title: '', url: '', account: '' },
  kind: 'image', stats: { texts: 1, photos: 0, bgPhotos: 0, chars: 2 }, fixedDecor: 0,
  palette: [], text: '示例', id: 'old-id', schema: 1, rev: 4, createdAt: 400, updatedAt: 500,
  ...overrides,
})
const html = (markup: string): LibraryComponent['block'] => ({
  id: 'fixture-html', type: 'html', props: { html: markup, label: '合成片段' },
})

beforeEach(() => {
  for (const stub of Object.values(h)) stub.mockReset()
  vi.stubGlobal('fetch', h.fetch)
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
})
afterEach(() => {
  try { expect(h.fetch).not.toHaveBeenCalled() }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals() }
})

it('deduplicates the same referenced media and checks only expected local filename types', () => {
  h.exists.mockImplementationOnce(() => false).mockImplementationOnce(() => true)
  expect(missingAssets({ block: html('<img src="/media/old-1.jpg?fit=1:1"><img src="/media/old-1.jpg"><img src="/media/keep_2.png"><img src="/media/non-image.gif">') })).toEqual(['old-1.jpg'])
  expect(h.exists.mock.calls).toEqual([[join('/virtual-assets', 'old-1.jpg')], [join('/virtual-assets', 'keep_2.png')]])
})
it('returns a newest-first listing with a missing-media receipt and omits unusable records', async () => {
  const previous = existing({ createdAt: 100 })
  const newest = existing({ id: 'new-id', createdAt: 200, block: html('<img src="/media/gone.png">') })
  const future = existing({ id: 'future', schema: 2, createdAt: 300 })
  const malformed = { ...existing(), id: 'broken', block: undefined } as unknown as LibraryComponent
  const rows = [previous, newest, future, malformed]
  h.list.mockResolvedValueOnce(rows)
  h.exists.mockReturnValueOnce(false)
  expect(await listComponents()).toEqual([{ ...newest, missing: ['gone.png'] }, { ...previous, missing: [] }])
  expect(rows.map(item => item.id)).toEqual(['old-id', 'new-id', 'future', 'broken'])
  expect(newest).not.toHaveProperty('missing')
})
it('rejects invalid drafts and unattested imported material before any storage write', async () => {
  await expect(saveComponent(null)).rejects.toMatchObject({ status: 400, message: '组件数据无效' })
  await expect(saveComponent({ ...draft, block: html('<p>合成片段</p>'), origin: { kind: 'other', attested: false } }))
    .rejects.toMatchObject({ status: 400, message: '导入内容需要先确认使用权' })
  expect(h.list).not.toHaveBeenCalled()
  expect(h.put).not.toHaveBeenCalled()
  expect(h.id).not.toHaveBeenCalled()
})
it('returns the matching component unchanged without assigning a new id or publishing', async () => {
  const previous = existing()
  h.list.mockResolvedValueOnce([existing({ fingerprint: 'different' }), previous])
  const receipt = await saveComponent({ ...draft, name: '不同名称' })
  expect(receipt).toEqual({ duplicate: true, component: previous })
  expect(receipt.component).toBe(previous)
  expect(h.id).not.toHaveBeenCalled()
  expect(h.put).not.toHaveBeenCalled()
})
it('stores a normalized new component with trusted identity and no lookup for an empty fingerprint', async () => {
  h.id.mockReturnValueOnce('fake/id 01')
  h.put.mockResolvedValueOnce(undefined)
  const { component, duplicate } = await saveComponent({ ...draft, fingerprint: '', id: 'untrusted', rev: 99, tags: [' 新 ', '新'] })
  expect(duplicate).toBe(false)
  expect(component).toMatchObject({ id: 'fake_id_01', rev: 1, schema: 1, createdAt: Date.now(), updatedAt: Date.now(), tags: ['新'] })
  expect(h.id).toHaveBeenCalledExactlyOnceWith(10)
  expect(h.put).toHaveBeenCalledExactlyOnceWith(component)
  expect(h.list).not.toHaveBeenCalled()
})
it('protects content and origin while allowing trimmed metadata and a standard name to determine kind', async () => {
  const base = existing()
  h.get.mockResolvedValueOnce(base)
  h.put.mockResolvedValueOnce(undefined)
  const result = await updateComponent(base.id, {
    name: '  ' + '新'.repeat(44) + '  ', tags: [' 甲 ', '甲', '乙'], kind: 'cover', role: 'h2',
    block: html('<p>未经许可的替换</p>'), origin: { redistributable: true }, id: 'unexpected',
    rev: 50, createdAt: 2, fingerprint: 'overwrite',
  })
  expect(result).toEqual({ ...base, name: '新'.repeat(40), tags: ['甲', '乙'], kind: 'heading', role: 'h2', rev: 5, updatedAt: Date.now() })
  expect(h.put).toHaveBeenCalledExactlyOnceWith(result)
  expect(base.rev).toBe(4)
})
it('ignores blank and invalid metadata, permits the neutral role, and rejects a missing record', async () => {
  const base = existing()
  h.get.mockResolvedValueOnce(base).mockResolvedValueOnce(undefined)
  h.put.mockResolvedValueOnce(undefined)
  const result = await updateComponent(base.id, { name: ' ', tags: 'not array', kind: 'INVALID', role: 'other' })
  expect(result).toEqual({ ...base, role: 'other', rev: 5, updatedAt: Date.now() })
  await expect(updateComponent('unknown-id', {})).rejects.toMatchObject({ status: 404, message: '组件不存在' })
  expect(h.put).toHaveBeenCalledExactlyOnceWith(result)
})
it('propagates a repository write failure and delegates removal only to the requested record', async () => {
  const diskError = Error('synthetic write failure')
  h.id.mockReturnValueOnce('fake-id')
  h.put.mockRejectedValueOnce(diskError)
  await expect(saveComponent({ ...draft, fingerprint: '' })).rejects.toBe(diskError)
  h.remove.mockResolvedValueOnce(undefined)
  await expect(removeComponent('selected-id')).resolves.toBeUndefined()
  expect(h.remove).toHaveBeenCalledExactlyOnceWith('selected-id')
})

import JSZip from 'jszip'
import { afterEach, expect, it, vi } from 'vitest'
import { createProjectBackup } from '../../src/editor/projectBackup'
import { api } from '../../src/editor/api'
import type { Doc } from '../../src/core/types'

vi.mock('../../src/editor/api', () => ({
  api: { projects: vi.fn(), project: vi.fn(), assets: vi.fn() },
}))

const project: Doc = {
  id: 'project1', title: 'Saved local draft', author: '', digest: '',
  themeId: 'default', blocks: [], createdAt: 1, updatedAt: 2,
}
const asset = { id: 'asset1', file: 'asset1.png', name: 'Figure', width: 1, height: 1, size: 3, createdAt: 3 }

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it('packs saved drafts and indexed local assets in the old ZIP layout without settings', async () => {
  vi.mocked(api.projects).mockResolvedValue([{ ...project, blockCount: 0 }])
  vi.mocked(api.project).mockResolvedValue(project)
  vi.mocked(api.assets).mockResolvedValue([asset])
  const fetchMedia = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
  vi.stubGlobal('fetch', fetchMedia)
  const zip = await JSZip.loadAsync(await createProjectBackup())
  expect(Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name).sort())
    .toEqual(['assets/_index.json', 'assets/asset1.png', 'projects/project1.json', 'xiumi-backup.json'])
  expect(JSON.parse(await zip.file('xiumi-backup.json')!.async('string'))).toMatchObject({ app: 'xiumi-ai-studio' })
  expect(JSON.parse(await zip.file('projects/project1.json')!.async('string'))).toEqual(project)
  expect(JSON.parse(await zip.file('assets/_index.json')!.async('string'))).toEqual({ asset1: asset })
  expect(await zip.file('assets/asset1.png')!.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]))
  expect(fetchMedia.mock.calls.map(([url]) => url)).toEqual(['/media/asset1.png?w=2400'])
})

it('reports an incomplete backup rather than downloading missing media', async () => {
  vi.mocked(api.projects).mockResolvedValue([])
  vi.mocked(api.assets).mockResolvedValue([asset])
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
  await expect(createProjectBackup()).rejects.toThrow(/素材/)
})

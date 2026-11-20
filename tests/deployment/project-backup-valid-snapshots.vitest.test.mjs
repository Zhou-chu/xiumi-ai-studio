import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { test } from 'vitest'
import { stageProjectRestore } from '../../scripts/restore-project-backup.mjs'

const writeJson = (path, value) => writeFile(path, JSON.stringify(value))
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

test('current projects win on overlap and ordinary backup images survive a staged restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-valid-backup-'))
  try {
    const base = join(root, 'current')
    const incoming = join(root, 'backup')
    const output = join(root, 'stage')
    for (const dir of [base, incoming]) {
      await mkdir(join(dir, 'projects'), { recursive: true })
      await mkdir(join(dir, 'assets'), { recursive: true })
    }
    const project = { id: 'same', title: 'Current title', themeId: 'default', blocks: [], createdAt: 1, updatedAt: 2 }
    await writeJson(join(base, 'projects', 'same.json'), project)
    await writeJson(join(incoming, 'projects', 'same.json'), { ...project, title: 'Older title' })
    await writeJson(join(incoming, 'projects', 'recovered.json'), {
      ...project, id: 'recovered', title: 'From backup',
      cover: { assetId: 'photo', src: '/media/photo.png' },
    })
    await writeJson(join(incoming, 'xiumi-backup.json'), { app: 'xiumi-ai-studio', scope: 'projects-and-assets' })
    const image = await sharp({ create: { width: 24, height: 16, channels: 4, background: '#0088ff' } }).png().toBuffer()
    await writeFile(join(incoming, 'assets', 'photo.png'), image)
    await writeJson(join(incoming, 'assets', '_index.json'), {
      photo: { id: 'photo', file: 'photo.png', name: 'Photo', width: 24, height: 16, size: image.length, createdAt: 2 },
    })

    assert.deepEqual(await stageProjectRestore({ base, incoming, output }), { projects: 2, assets: 1, preserved: 1 })
    assert.deepEqual(await readJson(join(output, 'projects', 'same.json')), project)
    assert.equal((await readJson(join(output, 'projects', 'recovered.json'))).cover.assetId, 'photo')
    assert.deepEqual(await readFile(join(output, 'assets', 'photo.png')), image)
    assert.equal((await readJson(join(incoming, 'projects', 'same.json'))).title, 'Older title')
    assert.deepEqual(await readJson(join(base, 'projects', 'same.json')), project)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

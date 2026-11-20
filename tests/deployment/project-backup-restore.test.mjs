import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import sharp from 'sharp'
import { stageProjectRestore } from '../../scripts/restore-project-backup.mjs'

const json = async (path, value) => writeFile(path, JSON.stringify(value))
const draft = (id, title, assetId) => ({
  id, title, createdAt: 2, updatedAt: 3, author: '', digest: '', themeId: 'default',
  blocks: [], ...(assetId ? { cover: { assetId, src: `/media/${assetId}.png` } } : {}),
})

async function roots() {
  const root = await mkdtemp(join(tmpdir(), 'xiumi-restore-fixture-'))
  const base = join(root, 'current'), incoming = join(root, 'selected-backup'), output = join(root, 'new-data')
  for (const dir of [base, incoming]) for (const group of ['projects', 'assets']) await mkdir(join(dir, group), { recursive: true })
  await json(join(incoming, 'xiumi-backup.json'), { app: 'xiumi-ai-studio', scope: 'projects-and-assets' })
  return { base, incoming, output }
}

async function asset(root, id, background) {
  const bytes = await sharp({ create: { width: 1600, height: 32, channels: 4, background } }).png().toBuffer()
  await writeFile(join(root, 'assets', `${id}.png`), bytes)
  await json(join(root, 'assets', '_index.json'), {
    [id]: { id, file: `${id}.png`, name: 'Local sample', width: 1600, height: 32, size: bytes.length, createdAt: 2 },
  })
  return bytes
}

test('stages a second data directory, preserves existing projects and keeps original asset bytes', async () => {
  const options = await roots()
  const { base, incoming, output } = options
  await json(join(base, 'projects', 'kept.json'), draft('kept', 'Current version', 'local'))
  await json(join(incoming, 'projects', 'kept.json'), draft('kept', 'Backup version'))
  await json(join(incoming, 'projects', 'brought.json'), draft('brought', 'From backup', 'photo'))
  const original = await asset(incoming, 'photo', '#0000ff')
  const baseBytes = await asset(base, 'local', '#9900ff')
  await json(join(base, 'settings.json'), { localSetting: 'excluded' })
  const outputText = execFileSync(process.execPath, ['scripts/restore-project-backup.mjs', base, incoming, output], { encoding: 'utf8' })
  assert.match(outputText, /保留 1 个同 ID/)

  const result = async (name) => JSON.parse(await readFile(join(output, name), 'utf8'))
  assert.equal((await result('projects/kept.json')).title, 'Current version')
  assert.equal((await result('projects/brought.json')).cover.src, '/media/photo.png')
  assert.equal((await result('assets/_index.json')).photo.width, 1600)
  assert.deepEqual(await readFile(join(output, 'assets', 'photo.png')), original)
  assert.deepEqual(await readFile(join(output, 'assets', 'local.png')), baseBytes)
  await assert.rejects(readFile(join(output, 'settings.json')), { code: 'ENOENT' })
  assert.equal(JSON.parse(await readFile(join(base, 'projects', 'kept.json'), 'utf8')).title, 'Current version')
  await assert.rejects(stageProjectRestore(options), /已存在/)
})

test('refuses differing images with the same managed identity before creating output', async () => {
  const options = await roots()
  await asset(options.base, 'photo', '#0000ff')
  await asset(options.incoming, 'photo', '#ff0000')
  await assert.rejects(stageProjectRestore(options), /素材冲突/)
  await assert.rejects(readFile(join(options.output, 'assets', 'photo.png')), { code: 'ENOENT' })
})

test('refuses a project whose backup-managed image is missing before creating output', async () => {
  const options = await roots()
  await json(join(options.incoming, 'projects', 'brought.json'), draft('brought', 'From backup', 'photo'))
  await assert.rejects(stageProjectRestore(options), /缺少素材/)
  await assert.rejects(readFile(join(options.output, 'projects', 'brought.json')), { code: 'ENOENT' })
})

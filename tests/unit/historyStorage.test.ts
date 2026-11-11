// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collection } from '../../server/store'
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'xiumi-history-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
describe('first project history on real filesystem', () => {
  it('lists untouched project history as empty', async () => {
    await expect(collection(join(root, 'versions', 'new-project')).list()).resolves.toEqual([])
  })
  it('persists the first full snapshot in a new project directory', async () => {
    const dir = join(root, 'versions', 'new-project')
    const versions = collection<{ id: string; doc: unknown }>(dir)
    const snapshot = { id: 'v1', doc: { title: 'Saved', themeId: 'warm', blocks: [{ id: 'p', type: 'paragraph', props: { content: 'Body' } }], images: [{ src: '/media/test.jpg' }] } }
    await versions.put(snapshot)
    expect(JSON.parse(await readFile(join(dir, 'v1.json'), 'utf8'))).toEqual(snapshot)
    expect(await versions.get('v1')).toEqual(snapshot)
    expect(await versions.list()).toEqual([snapshot])
  })
  it('does not hide invalid-directory failures', async () => {
    const file = join(root, 'file')
    await writeFile(file, 'occupied')
    await expect(collection(file).list()).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
})

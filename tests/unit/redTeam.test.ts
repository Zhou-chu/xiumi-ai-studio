import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { writeJson } from '../../server/store'

describe('red team: overlapping autosaves', () => {
  it('removes temporary data if atomic replacement fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xiumi-failed-save-'))
    try {
      const target = join(dir, 'target')
      await mkdir(target)
      await expect(writeJson(target, { text: 'unsaved' })).rejects.toThrow()
      expect(await readdir(dir)).toEqual(['target'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('completes concurrent writes with a complete JSON document and no temporary files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xiumi-concurrent-'))
    try {
      const file = join(dir, 'project.json')
      const docs = Array.from({ length: 32 }, (_, id) => ({ id, text: String(id).repeat(10000) }))
      const results = await Promise.allSettled(docs.map((doc) => writeJson(file, doc)))
      expect(results.filter((result) => result.status === 'rejected')).toEqual([])
      const saved = JSON.parse(await readFile(file, 'utf8'))
      expect(docs).toContainEqual(saved)
      expect(await readdir(dir)).toEqual(['project.json'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

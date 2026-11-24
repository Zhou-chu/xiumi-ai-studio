import { expect, it, vi } from 'vitest'
import type { Request } from 'express'
import { boundedDiskStorage } from '../../server/uploadStorage'

const disk = vi.hoisted(() => ({
  write: vi.fn(),
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
}))
vi.mock('node:fs', () => ({ default: { createWriteStream: disk.write } }))
vi.mock('node:fs/promises', () => ({
  mkdtemp: disk.mkdtemp,
  readFile: disk.readFile,
  unlink: disk.unlink,
  rmdir: disk.rmdir,
}))

it('cleans completed files on removal and rejects invalid configured budgets', () => {
  for (const value of [0, -1, Infinity, 1.2]) {
    expect(() => boundedDiskStorage(value)).toThrow(RangeError)
  }

  const storage = boundedDiskStorage(10)
  const file = { buffer: Buffer.from('old') } as unknown as Express.Multer.File
  const removed = vi.fn()
  storage._removeFile({} as Request, file, removed)

  expect(removed).toHaveBeenCalledExactlyOnceWith(null)
  expect(file.buffer).toBeUndefined()
  for (const operation of Object.values(disk)) expect(operation).not.toHaveBeenCalled()
})

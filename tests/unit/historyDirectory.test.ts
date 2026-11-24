import { describe, expect, it } from 'vitest'
import { verifyHistoryDirectory } from '../../server/historyDirectory'

const short = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\archive\\versions'
const canonical = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\archive\\versions'
const blockingAncestor = 'C:\\Users\\RUNNER~1\\AppData'
const direct = (ino = 42n) => ({ dev: 7n, ino, isDirectory: () => true, isSymbolicLink: () => false })
const probe = (result: string, stats = async (_path: string) => direct()) => ({
  realpath: async (_path: string) => result,
  lstat: stats,
})

describe('history restore directory confinement', () => {
  it('accepts real short-name aliases without trusting Windows case spelling', async () => {
    await expect(verifyHistoryDirectory(short, 'win32', probe(canonical))).resolves.toBe(true)
    await expect(verifyHistoryDirectory(canonical.toUpperCase(), 'win32', probe(canonical))).resolves.toBe(true)
  })
  it('refuses symbolic/junction ancestors, changed identities and unsupported spelling aliases', async () => {
    const junction = { ...direct(), isSymbolicLink: () => true }
    await expect(verifyHistoryDirectory(short, 'win32', probe(canonical,
      async path => path === blockingAncestor ? junction : direct()))).resolves.toBe(false)
    await expect(verifyHistoryDirectory(short, 'win32', probe(canonical,
      async path => path === canonical ? direct(45n) : direct()))).resolves.toBe(false)
    await expect(verifyHistoryDirectory(short, 'win32', probe(canonical, async () => direct(0n)))).resolves.toBe(false)
    await expect(verifyHistoryDirectory(short.replace('RUNNER~1', 'unrelated'), 'win32', probe(canonical))).resolves.toBe(false)
    await expect(verifyHistoryDirectory(short, 'win32', probe(canonical.replace('C:', 'D:')))).resolves.toBe(false)
    await expect(verifyHistoryDirectory('/tmp/linked/versions', 'linux', probe('/tmp/actual/versions'))).resolves.toBe(false)
  })
})

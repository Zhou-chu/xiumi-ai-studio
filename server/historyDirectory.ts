import { lstat, realpath } from 'node:fs/promises'
import { win32 } from 'node:path'

type DirectoryInfo = { isDirectory(): boolean; isSymbolicLink(): boolean; dev: bigint; ino: bigint }
type Probe = { lstat(path: string): Promise<DirectoryInfo>; realpath(path: string): Promise<string> }
const fsProbe: Probe = { lstat: path => lstat(path, { bigint: true }), realpath }
const asDirectDirectory = (info: DirectoryInfo) => info.isDirectory() && !info.isSymbolicLink()
const shortName = /^[a-z0-9_!@#$%&'()`{}^+-]{1,6}~[1-9]\d{0,5}(?:\.[a-z0-9_]{1,3})?$/i

function sameWindowsDirectorySpelling(path: string, canonical: string) {
  const root = win32.parse(path).root
  const targetRoot = win32.parse(canonical).root
  if (!root || root.toLowerCase() !== targetRoot.toLowerCase()) return false
  const spellings = path.slice(root.length).split('\\')
  const expanded = canonical.slice(targetRoot.length).split('\\')
  return spellings.length === expanded.length && spellings.every((name, index) =>
    name.toLowerCase() === expanded[index].toLowerCase() || (name.split('.', 1)[0].length <= 8 && shortName.test(name)))
}

/** Permit equivalent Windows short names without granting a symlink or junction. */
export async function verifyHistoryDirectory(path: string, platform: NodeJS.Platform = process.platform, probe = fsProbe) {
  const leaf = await probe.lstat(path)
  if (!asDirectDirectory(leaf)) return false
  const canonical = await probe.realpath(path)
  if (platform !== 'win32') return canonical === path
  if (!sameWindowsDirectorySpelling(path, canonical)) return false
  // Even a case-only spelling change cannot bypass junction checks.
  let current = path
  for (;;) {
    const parent = win32.dirname(current)
    if (parent === current) break
    if (!asDirectDirectory(await probe.lstat(parent))) return false
    current = parent
  }
  if (canonical.toLowerCase() === path.toLowerCase()) return true
  const target = await probe.lstat(canonical)
  return asDirectDirectory(target) && leaf.ino !== 0n && leaf.dev !== 0n &&
    leaf.ino === target.ino && leaf.dev === target.dev
}

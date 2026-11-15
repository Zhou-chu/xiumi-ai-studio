import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { copyDir } from '../../scripts/fsutil'
import { closeOwnedChild, VerificationLifecycle } from '../../scripts/verificationLifecycle'
import { sharpNativePackage } from '../../scripts/verificationRuntime'

const h = vi.hoisted(() => ({
  copy: vi.fn(), mkdir: vi.fn(), readdir: vi.fn(), stat: vi.fn(),
  realpath: vi.fn(), read: vi.fn(), req: vi.fn(), resolve: vi.fn(),
}))
vi.mock('node:fs', () => ({
  copyFileSync: h.copy, mkdirSync: h.mkdir, readdirSync: h.readdir, statSync: h.stat,
  realpathSync: h.realpath, readFileSync: h.read,
}))
vi.mock('node:module', () => ({ createRequire: h.req }))
beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset().mockImplementation((...args: unknown[]) => {
    throw Error('Unexpected package boundary: ' + args.join(' '))
  })
})

it('copies nested files including paths with spaces and non-ASCII characters while applying exclusions at all levels', () => {
  const source = join('fixture', '源 目录')
  const target = join('fixture', '目标 目录')
  const sub = join(source, '子目录')
  const dirs = new Map([[source, ['子目录', '说明.txt', 'node_modules']], [sub, ['照片.png','node_modules']]])
  h.readdir.mockImplementation((path: string) => {
    if (!dirs.has(path)) throw Error('Unknown readdir: ' + path)
    return dirs.get(path)
  })
  const files = new Set([join(sub,'照片.png'),join(source,'说明.txt')])
  h.stat.mockImplementation((path: string) => {
    if (path !== sub && !files.has(path)) throw Error('Unexpected stat of ' + path)
    return { isDirectory: () => path === sub }
  })
  h.mkdir.mockReturnValue(undefined)
  h.copy.mockReturnValue(undefined)
  copyDir(source, target, new Set(['node_modules']))
  expect(h.mkdir.mock.calls).toEqual([[target, { recursive: true }],[join(target,'子目录'), { recursive: true }]])
  expect(h.copy.mock.calls).toEqual([
    [join(sub,'照片.png'),join(target,'子目录','照片.png')],
    [join(source,'说明.txt'),join(target,'说明.txt')],
  ])
  expect(h.stat.mock.calls.flat()).not.toContain(join(sub,'node_modules'))
  expect(h.stat.mock.calls.flat()).not.toContain(join(source,'node_modules'))
})

it('propagates the first copy failure and does not attempt later files', () => {
  const source = join('fixture','source')
  const target = join('fixture','target')
  h.mkdir.mockReturnValue(undefined)
  h.readdir.mockReturnValueOnce(['first','later'])
  h.stat.mockReturnValueOnce({ isDirectory: () => false })
  const failure = Error('copy refused')
  h.copy.mockImplementationOnce(() => { throw failure })
  expect(() => copyDir(source,target)).toThrow(failure)
  expect(h.stat).toHaveBeenCalledExactlyOnceWith(join(source,'first'))
  expect(h.copy).toHaveBeenCalledExactlyOnceWith(join(source,'first'),join(target,'first'))
})

const setupRuntime = (native: string, name = '@img/sharp-win32-x64') => {
  const root = join('fixture','package')
  const canonical = join('canonical','package')
  const sharp = join(canonical,'app','node_modules','sharp','package.json')
  const resolved = join(canonical,'virtual','native','package.json')
  h.realpath.mockImplementation((file: string) => {
    if (file === root) return canonical
    if (file === sharp) return sharp
    if (file === resolved) return native
    throw Error('Unexpected realpath: ' + file)
  })
  h.req.mockReturnValueOnce({ resolve: h.resolve })
  h.resolve.mockReturnValueOnce(resolved)
  h.read.mockImplementation((file: string) => {
    if (file !== native) throw Error('Unexpected manifest: ' + file)
    return JSON.stringify({ name })
  })
  return { root, canonical, sharp, resolved }
}

it('anchors native resolution at the unpacked sharp manifest and reads only the canonical contained package', () => {
  const manifest = join('canonical','package','app','node_modules','@img','sharp-win32-x64','package.json')
  const { root, sharp, resolved } = setupRuntime(manifest)
  expect(sharpNativePackage(root)).toBe(manifest)
  expect(h.req).toHaveBeenCalledExactlyOnceWith(sharp)
  expect(h.resolve).toHaveBeenCalledExactlyOnceWith('@img/sharp-win32-x64/package')
  expect(h.realpath.mock.calls.flat()).toEqual([root,sharp,resolved])
  expect(h.read).toHaveBeenCalledExactlyOnceWith(manifest,'utf8')
})

it('rejects a canonical native manifest outside the unpacked directory before reading it', () => {
  const { root } = setupRuntime(join('canonical','package-sibling','package.json'))
  expect(() => sharpNativePackage(root)).toThrow('Runtime dependency is outside unpacked root')
  expect(h.read).not.toHaveBeenCalled()
})

it('rejects a canonical sharp entry outside the unpacked directory before resolving any native module', () => {
  const { root, canonical } = setupRuntime(join('canonical','package','package.json'))
  h.realpath.mockReset().mockReturnValueOnce(canonical).mockReturnValueOnce(join('canonical','other','package.json'))
  expect(() => sharpNativePackage(root)).toThrow('Runtime dependency is outside unpacked root')
  expect(h.req).not.toHaveBeenCalled()
  expect(h.read).not.toHaveBeenCalled()
})

it('checks the actual native manifest name rather than trusting a successful resolution', () => {
  const { root } = setupRuntime(join('canonical','package','package.json'), '@img/not-sharp')
  expect(() => sharpNativePackage(root)).toThrow('Unexpected native runtime package')
  expect(h.read).toHaveBeenCalledOnce()
})

it('does not wait for a child if termination throws and preserves the exact failure', async () => {
  const failure = Error('termination refused')
  const terminate = vi.fn(() => { throw failure })
  const wait = vi.fn()
  await expect(closeOwnedChild({ pid: 412, exitCode: null, signalCode: null }, terminate, wait)).rejects.toBe(failure)
  expect(terminate).toHaveBeenCalledExactlyOnceWith(412)
  expect(wait).not.toHaveBeenCalled()
})

it('waits for tracked child cleanup before removing evidence and retains it if the wait fails', async () => {
  const failure = Error('child wait failed')
  let deny!: (error: Error) => void
  const terminate = vi.fn()
  const wait = vi.fn(() => new Promise<void>((_, reject) => { deny = reject }))
  const remove = vi.fn()
  const lifecycle = new VerificationLifecycle(remove)
  lifecycle.track(() => closeOwnedChild({ pid: 413, exitCode: null, signalCode: null }, terminate, wait))
  const run = lifecycle.run(async () => 'complete')
  await Promise.resolve()
  expect(terminate).toHaveBeenCalledExactlyOnceWith(413)
  expect(wait).toHaveBeenCalledOnce()
  expect(remove).not.toHaveBeenCalled()
  deny(failure)
  await expect(run).rejects.toThrow('verification cleanup failed; evidence retained')
  expect(lifecycle.cleanupErrors).toEqual([failure])
  expect(remove).not.toHaveBeenCalled()
})

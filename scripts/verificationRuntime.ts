import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, sep } from 'node:path'
/** Resolve only an unpacked verifier fixture, not an arbitrary installed application. */
export function sharpNativePackage(root: string): string {
  const unpacked = realpathSync(root)
  const sharp = realpathSync(join(unpacked, 'app/node_modules/sharp/package.json'))
  const within = (file: string) => {
    const path = relative(unpacked, file)
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('Runtime dependency is outside unpacked root')
  }
  within(sharp)
  const manifest = realpathSync(createRequire(sharp).resolve('@img/sharp-win32-x64/package'))
  within(manifest)
  if (JSON.parse(readFileSync(manifest, 'utf8')).name !== '@img/sharp-win32-x64') throw new Error('Unexpected native runtime package')
  return manifest
}

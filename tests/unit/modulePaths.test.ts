import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// Vite checks .ts before .tsx. On Windows, Foo.tsx and foo.ts can therefore
// resolve the same extensionless import to different modules than on Linux.
function modules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? modules(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : []
  })
}

it('keeps source module paths unambiguous on case-insensitive filesystems', () => {
  const paths = new Map<string, string[]>()
  for (const path of [...modules('src'), ...modules('server')]) {
    const key = path.replace(/\.[cm]?[jt]sx?$/, '').toLowerCase()
    paths.set(key, [...(paths.get(key) ?? []), path])
  }
  expect([...paths.values()].filter(group => group.length > 1), 'Rename modules that collide after extension removal and case folding').toEqual([])
})

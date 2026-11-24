import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { matchesGlob, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, URL } from 'node:url'
import { loadConfigFromFile } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))
const production = /^(?:src|server|scripts|templates)\/.+\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/
const declaration = /\.d\.(?:ts|mts|cts)$/
const trackedSource = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(path => production.test(path) && !declaration.test(path))

for (const file of ['vitest.coverage.config.ts', 'vitest.scripts.coverage.config.ts']) {
  test(`${file} includes every tracked production JS/TS source in mixed coverage`, async () => {
    const resolved = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(root, file), root)
    const { include, exclude } = resolved.config.test.coverage
    const missing = trackedSource.filter(path =>
      !include.some(pattern => matchesGlob(path, pattern)) ||
      (exclude ?? []).some(pattern => matchesGlob(path, pattern)),
    )
    assert.deepEqual(missing, [], `uncovered inventory: ${missing.join(', ')}`)
  })
}

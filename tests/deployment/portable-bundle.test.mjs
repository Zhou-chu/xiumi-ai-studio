import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import process from 'node:process'

test('bundles existing entry into the independent staged package without embedding external runtime dependencies', async t => {
  const stage = await mkdtemp(join(tmpdir(), 'xiumi-bundle-'))
  t.after(() => rm(stage, { recursive: true, force: true }))
  const build = spawnSync(process.execPath, ['scripts/windows-portable-bundle.mjs', stage], { encoding: 'utf8', timeout: 15_000 })
  assert.equal(build.status, 0, 'portable-stage build should succeed: ' + build.stderr)
  const server = await readFile(join(stage, 'server', 'index.mjs'), 'utf8')
  assert.ok(server.includes('127.0.0.1'))
  assert.match(server, /from ['"]sharp['"]/)
  assert.match(server, /from ['"]isomorphic-dompurify['"]/)
  assert.doesNotMatch(server, /from ['"]\.\.?\//)
  const check = spawnSync(process.execPath, ['--check', join(stage, 'server', 'index.mjs')])
  assert.equal(check.status, 0)
})

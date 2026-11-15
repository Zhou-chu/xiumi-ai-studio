import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, URL } from 'node:url'
import * as layer from './test-layer-check.mjs'

const testPath = 'tests/unit/a.test.ts'
const sourcePath = 'src/a.ts'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'xiumi-test-layer-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  write(testPath, '// synthetic test\n')
  write(sourcePath, 'export const a = 1\n')
  const manifest = {
    schemaVersion: 1, hashMethod: 'sha256-utf8-normalized-crlf-to-lf',
    tests: [{
      path: testPath, runner: 'vitest', layer: 'unit', target: [sourcePath],
      rationale: 'Synthetic direct unit test for the gate contract',
      sha256: layer.normalizedSha256('// synthetic test\n'),
    }],
    support: [], productionFiles: [sourcePath],
    sourceHashes: { [sourcePath]: layer.normalizedSha256('export const a = 1\n') },
  }
  return { write, manifest, root, trustedFiles: [sourcePath, testPath] }
}
const audit = ({root, manifest, trustedFiles}, extra = {}) => layer.auditLayers(root, manifest, { trustedFiles, ...extra })

test('CRLF-normalized identity accepts source checkout line-ending differences', t => {
  const f = fixture(t)
  f.write(sourcePath, 'export const a = 1\r\n')
  assert.deepEqual(audit(f).unitFiles, [testPath])
})

test('source-only drift cannot retain reviewed unit selections even in diagnostics', t => {
  const f = fixture(t)
  assert.equal(audit(f).unitFiles.length, 1)
  f.write(sourcePath, 'export const a = 2\n')
  for (const diagnostic of [false, true]) {
    assert.throws(() => audit(f, { diagnostic }), /stale source digest.*src\/a\.ts/)
  }
})

test('source identity must be a complete valid exact map', async t => {
  const mutate = {
    absent: f => { delete f.manifest.sourceHashes },
    omitted: f => { delete f.manifest.sourceHashes[sourcePath] },
    extra: f => { f.manifest.sourceHashes['src/extra.ts'] = 'a'.repeat(64) },
    malformed: f => { f.manifest.sourceHashes[sourcePath] = 'short' },
  }
  for (const [name, corrupt] of Object.entries(mutate)) {
    await t.test(name, sub => {
      const f = fixture(sub)
      corrupt(f)
      assert.throws(() => audit(f), /source [Hh]ash|source digest/)
    })
  }
})

const roots = ['src', 'server', 'scripts', 'templates']
const suffixes = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']
test('adding any JS/TS extension under any managed root cannot go unseen', async t => {
  for (const root of roots) {
    for (const ext of suffixes) {
      const path = root + '/nested/new.' + ext
      await t.test(path, sub => {
        const f = fixture(sub)
        f.write(path, 'export {}\n')
        f.trustedFiles.push(path)
        assert.throws(() => audit(f, { diagnostic: true }), /production inventory/)
      })
    }
  }
})

test('filesystem, Git and coverage receive the same complete source set', t => {
  const f = fixture(t)
  for (const root of roots) {
    for (const ext of suffixes) {
      const path = root + '/nested/new.' + ext
      f.write(path, 'export {}\n')
      f.manifest.productionFiles.push(path)
      f.manifest.sourceHashes[path] = layer.normalizedSha256('export {}\n')
      f.trustedFiles.push(path)
    }
    for (const ext of ['d.ts', 'd.mts', 'd.cts']) {
      const path = root + '/nested/types.' + ext
      f.write(path, 'export {}\n')
      f.trustedFiles.push(path)
    }
  }
  const expected = [...f.manifest.productionFiles].sort()
  assert.deepEqual(layer.inventories(f.root).production, expected)
  const result = audit(f)
  assert.deepEqual(result.productionFiles, expected)
  assert.deepEqual(result.coverageInclude, expected)
})

test('new classified source missing from the real temporary Git index is rejected', t => {
  const f = fixture(t)
  const git = (...args) => execFileSync('git', args, { cwd: f.root, stdio: 'pipe' })
  git('init', '-q')
  git('add', '--', sourcePath, testPath)
  const path = 'server/untracked.js'
  const body = 'export {}\n'
  f.write(path, body)
  f.manifest.productionFiles.push(path)
  f.manifest.sourceHashes[path] = layer.normalizedSha256(body)
  const run = () => layer.auditLayers(f.root, f.manifest, { diagnostic: true })
  assert.throws(run, /trusted Git inventory.*server\/untracked\.js/)
  git('add', '--', path)
  assert.ok(run().productionFiles.includes(path))
})

test('a diagnostic can report zero reviewed units but cannot produce an executable empty selection', t => {
  const f = fixture(t)
  f.manifest.tests[0].layer = 'review-pending'
  f.manifest.tests[0].target = []
  assert.throws(() => audit(f), /review pending/)
  const selection = audit(f, { diagnostic: true })
  assert.deepEqual(selection.unitFiles, [])
  assert.throws(() => layer.requireUnitSelection(selection), /no reviewed product unit test/)
})

test('pending and mixed entries are never strict units despite valid bytes', t => {
  const f = fixture(t)
  const path = 'tests/unit/mixed.test.ts'
  const body = '// synthetic mixed test\n'
  f.write(path, body)
  f.trustedFiles.push(path)
  f.manifest.tests.push({
    ...f.manifest.tests[0], path, sha256: layer.normalizedSha256(body),
    layer: 'mixed', subLayers: ['unit', 'api-integration'], splitRequired: true,
  })
  assert.throws(() => audit(f), /mixed files require split/)
  const selection = audit(f, { diagnostic: true })
  assert.deepEqual(layer.requireUnitSelection(selection), [testPath])
})

test('a discovered test missing classification or a support digest drift fails both modes', t => {
  const f = fixture(t)
  const path = 'tests/unit/added.test.ts'
  const support = 'tests/unit/support.ts'
  const body = '// checked support\n'
  f.write(support, body)
  f.manifest.support.push({ path: support, sha256: layer.normalizedSha256(body) })
  f.trustedFiles.push(support)
  assert.doesNotThrow(() => audit(f))
  f.write(path, '// new test\n')
  f.trustedFiles.push(path)
  for (const diagnostic of [false, true]) assert.throws(() => audit(f, { diagnostic }), /unclassified test inventory/)
  f.manifest.tests.push({ ...f.manifest.tests[0], path, sha256: layer.normalizedSha256('// new test\n') })
  f.write(support, '// drifted support\n')
  for (const diagnostic of [false, true]) assert.throws(() => audit(f, { diagnostic }), /stale digest.*support\.ts/)
})

test('Vitest V8 loader matches exactly the frozen source paths, not their neighbors', async () => {
  const { resolveConfig } = await import('vitest/node')
  const { default: coverage } = await import('@vitest/coverage-v8')
  const { version } = await import('vitest/package.json', { with: { type: 'json' } }).then(module => module.default)
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const expected = layer.auditLayers(root, layer.readManifest(root), { diagnostic: true })
  const { test: config } = await resolveConfig({ root, config: join(root, 'vitest.unit.config.ts'), watch: false })
  assert.deepEqual(config.include, expected.unitFiles)
  assert.equal(config.coverage.include.length, expected.productionFiles.length)
  assert.deepEqual(config.coverage.thresholds, { statements: 90.01, branches: 90.01, functions: 90.01, lines: 90.01 })
  const provider = await coverage.getProvider()
  provider.initialize({
    version, config: { root, project: [] }, projects: [],
    _coverageOptions: config.coverage, logger: { warn: message => assert.fail(message) },
  })
  const alwaysUnmatched = new Set()
  const universe = new Set(expected.productionFiles)
  for (const path of expected.productionFiles) {
    assert.equal(provider.isIncluded(join(root, path), root), true, path)
    for (const other of [path + '.extra.js', path + '/child.js', 'out-of-scope/' + path, path.replace('/', '/unreviewed/'), path.replace(/(.)$/, 'Z')]) {
      if (!universe.has(other)) alwaysUnmatched.add(other)
    }
  }
  for (const path of alwaysUnmatched) assert.equal(provider.isIncluded(join(root, path), root), false, path)
})

function addProtocolFixture(f, path, runner, classification) {
  const content = '// synthetic boundary entry\n'
  f.write(path, content)
  f.trustedFiles.push(path)
  f.manifest.tests.push({ path, runner, layer: classification, target: [sourcePath], rationale: 'Explicit request-only protocol test; no browser or unit claim', sha256: layer.normalizedSha256(content) })
}
test('request-only Playwright API integration is classified without joining strict unit selection', t => {
  const f = fixture(t)
  addProtocolFixture(f, 'tests/e2e/api-only.spec.ts', 'playwright', 'api-integration')
  const result = audit(f)
  assert.deepEqual(result.unitFiles, [testPath])
  assert.deepEqual(result.productionFiles, [sourcePath])
  assert.deepEqual(result.coverageInclude, [sourcePath])
  assert.equal(result.counts['api-integration'], 1)
  assert.equal(result.counts.browser, 0)
})
test('Playwright entries can never be classified as strict unit even in diagnostics', t => {
  const f = fixture(t)
  addProtocolFixture(f, 'tests/e2e/not-unit.spec.ts', 'playwright', 'unit')
  for (const diagnostic of [false, true]) assert.throws(() => audit(f, { diagnostic }), /browser runner cannot be classified/)
})
test('explicit node-browser runners cannot borrow the request-only Playwright classification', t => {
  const f = fixture(t)
  addProtocolFixture(f, 'tests/fixtures/real.browser.mjs', 'node-browser', 'api-integration')
  assert.throws(() => audit(f), /browser runner cannot be classified/)
})

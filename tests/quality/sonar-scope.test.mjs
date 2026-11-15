import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import test from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const properties = Object.fromEntries(readFileSync(resolve(root, '.sonarcloud.properties'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(s => { const at = s.indexOf('='); return [s.slice(0, at), s.slice(at + 1)] }))
const entries = key => (properties[key] ?? '').split(',').filter(Boolean)
const sources = entries('sonar.sources'), tests = entries('sonar.tests'), exclusions = entries('sonar.exclusions')
const matches = (file, paths) => paths.some(p => file === p || file.startsWith(p + '/'))
const isSource = file => matches(file, sources) && !matches(file, exclusions)
const isTest = file => matches(file, tests)

test('all scope entries are actual fixed paths, with no broad exclusions or rule changes', () => {
 for (const path of [...sources, ...tests, ...exclusions]) { assert(!/[?*]/.test(path), path); assert(existsSync(resolve(root, path)), path) }
 assert.deepEqual(tests, ['tests', 'deploy/test-desktop.ps1'])
 assert.deepEqual(exclusions, ['deploy/test-desktop.ps1'])
 assert.deepEqual(Object.keys(properties).sort(), ['sonar.sources', 'sonar.tests', 'sonar.exclusions', 'sonar.sourceEncoding'].sort())
})
test('every tracked file is in exactly one initial source/test scope', () => {
 for (const file of files) assert.equal(Number(isSource(file)) + Number(isTest(file)), 1, file)
 const expectedRoots = [...new Set(files.map(f => f.split('/')[0]))].filter(p => p !== 'tests').sort()
 assert.deepEqual([...sources].sort(), expectedRoots)
})
test('the complete current production JS/TS and production PowerShell remain SOURCE', () => {
 const { productionFiles } = JSON.parse(readFileSync(resolve(root, 'test-layers.json'), 'utf8'))
 const expected = files.filter(path => /^(src|server|scripts|templates)\//.test(path) && /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.test(path) && !/\.d\.(ts|mts|cts)$/.test(path))
 assert.deepEqual([...productionFiles].sort(), expected.sort())
 for (const path of [...productionFiles, 'deploy/desktop.ps1', 'deploy/install-desktop.ps1', 'start.bat']) {
  assert(files.includes(path), path)
  assert(isSource(path), path)
  assert(!isTest(path), path)
 }
})
test('mock and harness reports are classified TEST without dropping their files', () => {
 for (const path of ['tests/deployment/Deployment.Tests.ps1', 'tests/e2e/fixtures/inlineReview.ts', 'deploy/test-desktop.ps1']) {
  assert(files.includes(path), path)
  assert(isTest(path), path)
  assert(!isSource(path), path)
 }
})

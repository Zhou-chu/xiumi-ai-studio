import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import console from 'node:console'

const sourceRoots = ['src', 'server', 'scripts', 'templates']
const codeExtension = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/
const declaration = /\.d\.(?:ts|mts|cts)$/
const isProduction = path => sourceRoots.includes(path.split('/')[0]) && path.includes('/') && codeExtension.test(path) && !declaration.test(path)
const isTestCode = path => path.startsWith('tests/') && (codeExtension.test(path) || /\.ps1$/i.test(path))
const isDeploymentTest = path => path === 'deploy/test-desktop.ps1'
// Refuse literal paths that the Vitest glob selector cannot represent unambiguously.
function literalSelector(path) {
  if (/[!*?{}()[\]]/.test(path)) throw Error(`unsupported glob metacharacter in audited path: ${path}`)
  return path
}
const layers = new Set(['unit', 'component-integration', 'api-integration', 'resource-integration', 'tool', 'static-contract', 'browser', 'live-browser', 'mixed', 'review-pending'])
const runners = new Set(['vitest', 'playwright', 'node-test', 'pester', 'powershell', 'node-browser'])
export const normalizedSha256 = content => createHash('sha256').update(String(content).replace(/\r\n/g, '\n')).digest('hex')
function walk(root, directory) {
  const location = join(root, directory)
  const stat = lstatSync(location, { throwIfNoEntry: false })
  if (!stat) return []
  if (!stat.isDirectory()) throw Error(`non-regular test/source directory: ${directory}`)
  return readdirSync(location, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    if (entry.isSymbolicLink()) throw Error(`symbolic test/source path needs explicit review: ${path}`)
    if (entry.isDirectory()) return walk(root, path)
    if (!entry.isFile()) throw Error(`non-regular test/source path: ${path}`)
    return [path]
  })
}
function safePath(path) {
  if (typeof path !== 'string' || !path || (path.includes('\\') || path.includes(':') || [...path].some(char => char.charCodeAt(0) < 32)) || isAbsolute(path) || path.split('/').some(part => part === '..' || part === '.' || part === '')) throw Error(`unsafe path: ${path}`)
  return path
}
export function expectedRunner(path) {
  if (path.endsWith('.browser.mjs')) return 'node-browser'
  if (/\.Tests\.ps1$/i.test(path)) return 'pester'
  if (path.startsWith('tests/unit/')) return 'vitest'
  if (['tests/e2e/', 'tests/live/', 'tests/shell/'].some(prefix => path.startsWith(prefix))) return 'playwright'
  if (path === 'deploy/test-desktop.ps1') return 'powershell'
  if (path.startsWith('tests/quality/') && path.endsWith('.test.mjs')) return 'node-test'
  return null
}
function sameInventory(actual, expected, label) {
  const a = [...actual].sort(), b = [...expected].sort()
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${label}: missing=[${a.filter(x => !b.includes(x))}] stale=[${b.filter(x => !a.includes(x))}]`)
}
export function inventories(root) {
  const testCode = walk(root, 'tests').filter(isTestCode)
  const isTest = path => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || /\.Tests\.ps1$/i.test(path) || /\.browser\.mjs$/.test(path)
  const tests = testCode.filter(isTest)
  if (existsSync(join(root, 'deploy/test-desktop.ps1'))) tests.push('deploy/test-desktop.ps1')
  const support = testCode.filter(path => !isTest(path))
  const production = sourceRoots.flatMap(dir => walk(root, dir)).filter(isProduction)
  return { tests: tests.sort(), support: support.sort(), production: production.sort() }
}
export function auditLayers(root, manifest, { diagnostic = false, trustedFiles } = {}) {
  if (manifest.schemaVersion !== 1 || manifest.hashMethod !== 'sha256-utf8-normalized-crlf-to-lf') throw Error('unsupported test-layer manifest schema/hash method')
  if (!Array.isArray(manifest.tests) || !Array.isArray(manifest.support) || !Array.isArray(manifest.productionFiles)) throw Error('missing manifest inventories')
  if (!manifest.tests.length || !manifest.productionFiles.length) throw Error('empty test/source manifest is not a valid classification')
  const seen = new Set()
  for (const item of [...manifest.tests, ...manifest.support]) {
    safePath(item.path)
    if (seen.has(item.path)) throw Error(`duplicate entry: ${item.path}`)
    seen.add(item.path)
    if (!existsSync(join(root, item.path))) throw Error(`missing reviewed path: ${item.path}`)
    if (!lstatSync(join(root, item.path)).isFile()) throw Error('reviewed path must be a regular file: ' + item.path)
    if (normalizedSha256(readFileSync(join(root, item.path), 'utf8')) !== item.sha256) throw Error(`stale digest requires boundary review: ${item.path}`)
  }
  for (const item of manifest.tests) {
    if (!layers.has(item.layer) || !runners.has(item.runner)) throw Error(`invalid layer/runner: ${item.path}`)
    if (expectedRunner(item.path) !== item.runner) throw Error('runner does not match discovered test entry point: ' + item.path)
    const allowedProtocolLayer = item.runner === 'playwright' && item.layer === 'api-integration'
    if (['playwright', 'node-browser'].includes(item.runner) && !allowedProtocolLayer && !['browser', 'live-browser', 'review-pending'].includes(item.layer)) throw Error('browser runner cannot be classified in this layer: ' + item.path)
    if (!Array.isArray(item.target) || (item.layer !== 'review-pending' && !item.target.length) || typeof item.rationale !== 'string' || item.rationale.trim().length < 20) throw Error(`missing logical target/rationale: ${item.path}`)
    for (const target of item.target) { safePath(target); if (!existsSync(join(root, target))) throw Error(`missing target: ${target}`); if (!lstatSync(join(root, target)).isFile()) throw Error('target must be a regular file: ' + target) }
    if (item.layer === 'mixed' && (!Array.isArray(item.subLayers) || item.subLayers.length < 2 || item.subLayers.some(layer => !layers.has(layer) || layer === 'mixed') || !item.splitRequired)) throw Error(`mixed file needs explicit pending split: ${item.path}`)
  }
  const inventory = inventories(root)
  sameInventory(inventory.tests, manifest.tests.map(x => x.path), 'unclassified test inventory')
  sameInventory(inventory.support, manifest.support.map(x => x.path), 'support inventory')
  sameInventory(inventory.production, manifest.productionFiles.map(safePath), 'production inventory')
  const hashes = manifest.sourceHashes
  if (!hashes || typeof hashes !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(hashes))) {
    throw Error('source hash map must be a plain object')
  }
  sameInventory(Object.keys(hashes), inventory.production, 'source hash inventory')
  for (const path of inventory.production) {
    if (typeof hashes[path] !== 'string' || !/^[0-9a-f]{64}$/.test(hashes[path])) throw Error(`invalid source digest: ${path}`)
    if (normalizedSha256(readFileSync(join(root, path), 'utf8')) !== hashes[path]) throw Error(`stale source digest requires boundary review: ${path}`)
  }
  const coverageInclude = inventory.production.map(literalSelector)
  const tracked = trustedFiles ?? execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  if (!tracked.length) throw Error('empty trusted Git inventory')
  const trackedCode = tracked.filter(path => isTestCode(path) || isDeploymentTest(path) || isProduction(path))
  sameInventory([...inventory.tests, ...inventory.support, ...inventory.production], trackedCode, 'trusted Git inventory')
  const pendingReview = manifest.tests.filter(item => item.layer === 'review-pending').map(item => item.path)
  if (pendingReview.length && !diagnostic) throw Error('logical-boundary review pending before release: ' + pendingReview.join(', '))
  const mixed = manifest.tests.filter(item => item.layer === 'mixed').map(item => item.path)
  if (mixed.length && !diagnostic) throw Error(`mixed files require split/node-level review before release: ${mixed.join(', ')}`)
  return { pendingReview, unitFiles: manifest.tests.filter(item => item.layer === 'unit' && item.runner === 'vitest').map(item => literalSelector(item.path)), mixed, productionFiles: inventory.production, coverageInclude, counts: Object.fromEntries([...layers].map(layer => [layer, manifest.tests.filter(item => item.layer === layer).length])) }
}
export function requireUnitSelection(selection) {
  if (!selection.unitFiles.length) throw Error('no reviewed product unit tests; use classification diagnostics instead')
  return selection.unitFiles
}
export function readManifest(root) { return JSON.parse(readFileSync(join(root, 'test-layers.json'), 'utf8').replace(/^\uFEFF/, '')) }
const entry = process.argv[1]
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  try { const result = auditLayers(root, readManifest(root), { diagnostic: process.argv.includes('--diagnostic') }); console.log(JSON.stringify({ mode: process.argv.includes('--diagnostic') ? 'diagnostic-subset-not-release' : 'release-classification', ...result }, null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}

import { defineConfig, mergeConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import base from './vite.config.ts'
import { auditLayers, readManifest, requireUnitSelection } from './tests/quality/test-layer-check.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
// Classification diagnostics allow a partially reviewed manifest; only reviewed
// product units are executable here. Separately run the formal audit for release.
const selection = auditLayers(root, readManifest(root), { diagnostic: true })
const unitFiles = requireUnitSelection(selection)
// Vitest 5.0.5 interprets every non-dynamic coverage include as a
// directory and appends /**. The audited suffix is an ASCII letter; a
// one-member character class preserves the exact filename as a glob.
const exactCoverageGlobs = selection.coverageInclude.map(path => `${path.slice(0, -1)}[${path.at(-1)}]`)
const config = mergeConfig(base, defineConfig({
  test: {
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage-unit-diagnostic',
      thresholds: { statements: 90.01, branches: 90.01, functions: 90.01, lines: 90.01 },
    },
  },
}))
// mergeConfig concatenates arrays: override these after merging.
config.test = {
  ...config.test,
  include: unitFiles,
  coverage: { ...config.test?.coverage, include: exactCoverageGlobs, exclude: [] },
}
export default config

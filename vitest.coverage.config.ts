import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vite.config.ts'

// Full application denominator, including files no selected test imports.
// Do not replace this with a touched-files list or exclude low-coverage modules.
export default mergeConfig(base, defineConfig({
  test: {
    maxWorkers: 2,
    // The offline restore fixture touches disk and belongs only to mixed coverage.
    include: ['tests/deployment/project-backup-valid-snapshots.vitest.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'scripts/**/*.{ts,mjs}', 'templates/**/*.mjs'],
      exclude: ['**/*.d.ts'],
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: { statements: 90.01, branches: 90.01, functions: 90.01, lines: 90.01 },
    },
  },
}))


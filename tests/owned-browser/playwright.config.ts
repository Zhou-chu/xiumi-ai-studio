import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Deliberately separate from the dev proxy: the owner-local route must work
// only on the same origin actually bound by the application.
export default defineConfig({
  testDir: '.',
  outputDir: resolve('test-results', 'owned-directory-migration'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: resolve('playwright-report', 'owned-directory-migration') }]],
  fullyParallel: false,
  workers: 1,
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})

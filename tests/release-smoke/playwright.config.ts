import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  outputDir: resolve('test-results', 'release-smoke'),
  workers: 1,
  timeout: 45_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: resolve('playwright-report', 'release-smoke') }]],
  use: {
    ...devices['Desktop Chrome'],
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})

import { defineConfig, devices } from '@playwright/test'

const built = process.env.XIUMI_E2E_TARGET === 'built'

// E2E 使用独立端口与数据目录，不影响日常使用的 data/
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  fullyParallel: false,
  workers: 1,
  // 首次运行生成截图基线；之后与基线比较（视觉回归）
  updateSnapshots: 'missing',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5273',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: built ? [{
    command: 'node --import tsx tests/fixtures/start-built-e2e.ts',
    env: { API_PORT: '5273' },
    url: 'http://127.0.0.1:5273/api/ai/status',
    reuseExistingServer: false,
  }] : [
    {
      // 每次运行前清空 E2E 数据目录
      command: `node -e "require('fs').rmSync('data-e2e',{recursive:true,force:true})" && npx tsx server/index.ts`,
      env: { API_PORT: '5274', DATA_DIR: 'data-e2e' },
      url: 'http://127.0.0.1:5274/api/ai/status',
      reuseExistingServer: false,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5273 --strictPort',
      env: { API_PORT: '5274', VITE_CACHE_DIR: 'node_modules/.vite-e2e' },
      url: 'http://127.0.0.1:5273',
      reuseExistingServer: false,
    },
  ],
})

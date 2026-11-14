import { defineConfig, devices } from '@playwright/test'
export default defineConfig({testDir:'tests/live',outputDir:'test-results-live',timeout:420000,workers:1,reporter:[['list']],use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:5176',viewport:{width:1440,height:900},trace:'off',screenshot:'only-on-failure'}})

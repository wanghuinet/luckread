import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/live',
  testMatch: '**/*.production.spec.ts',
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: './test-results/creator-production',
  use: {
    baseURL: 'https://mp.luckread.com',
    ...devices['Desktop Chrome'],
    channel: 'chromium',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 25_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})

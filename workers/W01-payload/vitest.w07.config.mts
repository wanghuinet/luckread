import { defineConfig } from 'vitest/config'

/**
 * Isolated unit-test configuration for W07 payment adapter tests.
 * This config sits beside the existing W01 Vitest toolchain so the runner
 * resolves its dependency without adding packages under W07.
 */
export default defineConfig({
  root: process.cwd(),
  test: {
    environment: 'node',
    include: ['../../workers/W07-subscription-commerce/src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})

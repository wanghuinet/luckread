import { defineConfig } from 'vitest/config'

/**
 * Unit-test configuration for W07 payment adapter tests.
 * The command is invoked from workers/W01-payload so its dependencies come
 * from the already-locked W01 test toolchain; do not broaden W01 integration
 * test discovery to include out-of-scope Worker unit tests.
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

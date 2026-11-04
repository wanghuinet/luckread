import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['../W05-social/src/push-endpoint-w01-runtime.integration.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})

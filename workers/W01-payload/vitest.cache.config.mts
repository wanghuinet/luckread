import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/lib/public-response-cache.test.ts',
      'src/lib/content-list-cache-guard.test.ts',
      'src/content/w03-content-client.test.ts',
    ],
  },
})

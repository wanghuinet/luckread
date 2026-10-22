import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: '../W05-social',
  test: {
    environment: 'node',
    include: [
      'src/poll-runtime.test.ts',
      'src/index.test.ts',
      'src/social-closure-runtime.test.ts',
    ],
  },
})

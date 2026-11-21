import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: '../W05-social',
  test: {
    environment: 'node',
    include: ['src/profile-channel-runtime.test.ts', 'src/index.test.ts'],
  },
})

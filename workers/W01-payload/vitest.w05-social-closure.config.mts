import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: '../W05-social',
  test: {
    environment: 'node',
    include: ['src/social-closure-runtime.test.ts', 'src/notification-preferences-runtime.test.ts']
  },
})

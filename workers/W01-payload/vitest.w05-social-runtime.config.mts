import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: '../W05-social',
  test: {
    environment: 'node',
    include: [
      'src/neon/runtime.test.ts',
      'src/like-mutation-runtime.test.ts',
      'src/like-mutation-store-postgres.test.ts',
      'src/comment-write-runtime.test.ts',
      'src/comment-create-store-postgres.test.ts',
      'src/comment-mutation-store-postgres.test.ts',
      'src/comment-notification-context-store-postgres.test.ts',
      'src/notification-enqueue-store-postgres.test.ts',
      'src/social-targets-read-store-postgres.test.ts',
      'src/social-token-sync-store-postgres.test.ts',
      'src/social-closure-runtime.test.ts',
    ],
  },
})

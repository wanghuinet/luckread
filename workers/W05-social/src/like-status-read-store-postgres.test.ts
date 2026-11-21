import { describe, expect, it } from 'vitest'
import { LikeStatusReadStoreError } from './like-status-read-store.js'
import {
  createPostgresLikeStatusReadStore,
  type LikeStatusPostgresQueryExecutor,
} from './like-status-read-store-postgres.js'

describe('W05 PostgreSQL like status read store', () => {
  it('reads actor state and aggregate count with parameterized target scope', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: LikeStatusPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{ liked: true, like_count: '12' }] as unknown as Row[] }
      },
    }

    await expect(createPostgresLikeStatusReadStore(db).read({
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
      includeCount: true,
    })).resolves.toEqual({ liked: true, likeCount: 12 })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['actor-1', 'content', 'content-1', 'content', 'content-1'])
    expect(calls[0]?.sql).toContain('FROM interaction_likes il')
    expect(calls[0]?.sql).toContain('actor_user_id = $1')
    expect(calls[0]?.sql).toContain('target_type = $2')
    expect(calls[0]?.sql).toContain('target_id = $3')
    expect(calls[0]?.sql).toContain('COUNT(*)')
    expect(calls[0]?.sql).toContain('target_type = $4')
    expect(calls[0]?.sql).toContain('target_id = $5')
  })

  it('skips the aggregate subquery when only viewer state is needed', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: LikeStatusPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{ liked: false }] as unknown as Row[] }
      },
    }

    await expect(createPostgresLikeStatusReadStore(db).read({
      actorUserId: 'actor-2',
      targetType: 'comment',
      targetId: 'comment-2',
      includeCount: false,
    })).resolves.toEqual({ liked: false, likeCount: null })

    expect(calls[0]?.values).toEqual(['actor-2', 'comment', 'comment-2'])
    expect(calls[0]?.sql).not.toContain('COUNT(*)')
  })

  it('sanitizes provider and unsafe aggregate failures', async () => {
    const brokenDb: LikeStatusPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('private-driver-host-details')
      },
    }
    const store = createPostgresLikeStatusReadStore(brokenDb)
    const input = {
      actorUserId: 'actor-1',
      targetType: 'content' as const,
      targetId: 'content-1',
      includeCount: true,
    }

    await expect(store.read(input)).rejects.toBeInstanceOf(LikeStatusReadStoreError)
    await expect(store.read(input)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'LIKE_STATUS_READ_UNAVAILABLE',
    })

    const unsafeCountDb: LikeStatusPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        return { rows: [{ liked: true, like_count: '-1' }] as unknown as Row[] }
      },
    }
    await expect(createPostgresLikeStatusReadStore(unsafeCountDb).read(input))
      .rejects.toBeInstanceOf(LikeStatusReadStoreError)
  })
})

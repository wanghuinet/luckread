import { describe, expect, it, vi } from 'vitest'
import { FavoriteStatusReadStoreError } from './favorite-status-read-store.js'
import {
  createPostgresFavoriteStatusReadStore,
  type FavoriteStatusPostgresQueryExecutor,
} from './favorite-status-read-store-postgres.js'

describe('W05 PostgreSQL favorite status read store', () => {
  it('uses one parameterized actor/target scoped existence query', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: FavoriteStatusPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [{ favorited: true }] as unknown as Row[] }
      },
    }

    await expect(createPostgresFavoriteStatusReadStore(db).isFavorited({
      actorUserId: 'actor-1',
      targetId: 'content-1',
    })).resolves.toBe(true)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['actor-1', 'content-1'])
    expect(calls[0]?.sql).toContain('FROM interaction_favorites')
    expect(calls[0]?.sql).toContain('actor_user_id = $1')
    expect(calls[0]?.sql).toContain("target_type = 'content'")
    expect(calls[0]?.sql).toContain('target_id = $2')
    expect(calls[0]?.sql).toContain('SELECT EXISTS')
    expect(calls[0]?.sql).not.toContain('FROM contents')
  })

  it('returns false for a missing actor/target relationship', async () => {
    const query = vi.fn(async () => ({ rows: [{ favorited: false }] }))
    const db = { query } as unknown as FavoriteStatusPostgresQueryExecutor

    await expect(createPostgresFavoriteStatusReadStore(db).isFavorited({
      actorUserId: 'actor-2',
      targetId: 'content-missing',
    })).resolves.toBe(false)
  })

  it('maps provider failures to a sanitized 503', async () => {
    const db: FavoriteStatusPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('secret-postgres-host-and-driver-detail')
      },
    }

    await expect(createPostgresFavoriteStatusReadStore(db).isFavorited({
      actorUserId: 'actor-1',
      targetId: 'content-1',
    })).rejects.toBeInstanceOf(FavoriteStatusReadStoreError)
    await expect(createPostgresFavoriteStatusReadStore(db).isFavorited({
      actorUserId: 'actor-1',
      targetId: 'content-1',
    })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'FAVORITE_STATUS_READ_UNAVAILABLE',
    })
  })
})

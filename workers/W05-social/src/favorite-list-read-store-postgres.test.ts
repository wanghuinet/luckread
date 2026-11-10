import { describe, expect, it, vi } from 'vitest'
import { FavoriteListReadStoreError } from './favorite-list-read-store.js'
import {
  createPostgresFavoriteListReadStore,
  type FavoriteListPostgresQueryExecutor,
} from './favorite-list-read-store-postgres.js'

describe('W05 PostgreSQL favorite list read store', () => {
  it('uses actor-scoped keyset pagination and keeps microsecond cursor precision', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: FavoriteListPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return {
          rows: [{
            relationship_id: 'favorite-1',
            target_id: 'content-1',
            created_at: '2026-11-10T04:00:00.789Z',
            cursor_created_at: '2026-11-10T04:00:00.789123Z',
          }] as unknown as Row[],
        }
      },
    }
    const store = createPostgresFavoriteListReadStore(db)

    await expect(store.list({
      actorUserId: 'actor-1',
      cursor: {
        createdAt: '2026-11-10T04:00:00.900456Z',
        relationshipId: 'favorite-2',
      },
      limit: 3,
    })).resolves.toEqual([{
      relationship_id: 'favorite-1',
      target_id: 'content-1',
      created_at: '2026-11-10T04:00:00.789Z',
      cursor_created_at: '2026-11-10T04:00:00.789123Z',
    }])

    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual([
      'actor-1',
      '2026-11-10T04:00:00.900456Z',
      'favorite-2',
      3,
    ])
    const sql = calls[0]?.sql ?? ''
    expect(sql).toContain('actor_user_id = $1')
    expect(sql).toContain("target_type = 'content'")
    expect(sql).toContain('created_at < $2::timestamptz')
    expect(sql).toContain('created_at = $2::timestamptz')
    expect(sql).toContain('relationship_id < $3')
    expect(sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    expect(sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    expect(sql).toContain('ORDER BY created_at DESC, relationship_id DESC')
    expect(sql).toContain('LIMIT $4')
    expect(sql).not.toContain('FROM contents')
  })

  it('returns an actor-scoped first page without a cursor', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const db = { query } as unknown as FavoriteListPostgresQueryExecutor
    await expect(createPostgresFavoriteListReadStore(db).list({
      actorUserId: 'actor-2',
      cursor: null,
      limit: 21,
    })).resolves.toEqual([])
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(values).toEqual(['actor-2', 21])
    expect(sql).toContain('actor_user_id = $1')
    expect(sql).toContain('LIMIT $2')
    expect(sql).not.toContain('created_at <')
  })

  it('maps provider failures to a sanitized 503', async () => {
    const db: FavoriteListPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('secret-postgres-host-and-driver-detail')
      },
    }
    await expect(createPostgresFavoriteListReadStore(db).list({
      actorUserId: 'actor-1',
      cursor: null,
      limit: 21,
    })).rejects.toBeInstanceOf(FavoriteListReadStoreError)
    await expect(createPostgresFavoriteListReadStore(db).list({
      actorUserId: 'actor-1',
      cursor: null,
      limit: 21,
    })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'FAVORITE_LIST_READ_UNAVAILABLE',
    })
  })
})

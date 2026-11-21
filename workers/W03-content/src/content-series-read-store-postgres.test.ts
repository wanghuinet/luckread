import { describe, expect, it, vi } from 'vitest'

import { createPostgresSeriesReadStore, type SeriesPostgresQueryExecutor } from './content-series-read-store-postgres.js'

describe('PostgreSQL creator-series read store', () => {
  const row = {
    id: 'series_1',
    owner_user_id: 'user_1',
    creator_id: 'user_1',
    ip_id: null,
    state: 'DRAFT' as const,
    version: 3,
    title: 'Series 1',
    description: 'description',
    cover_ref: null,
    etag: 'W/"3"',
    created_at: new Date('2026-10-07T00:00:00.000Z'),
    updated_at: new Date('2026-10-08T00:00:00.000Z'),
  }

  it('uses an owner-scoped parameterized detail read and maps timestamps', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresSeriesReadStore({ query } as unknown as SeriesPostgresQueryExecutor)

    await expect(store.getSeries('user_1', 'series_1')).resolves.toEqual({
      id: 'series_1',
      ownerUserId: 'user_1',
      creatorId: 'user_1',
      ipId: null,
      state: 'DRAFT',
      version: 3,
      title: 'Series 1',
      description: 'description',
      coverRef: null,
      etag: 'W/"3"',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
    })
    expect(query.mock.calls[0]?.[0]).toContain('owner_user_id = $1 AND id = $2')
    expect(query.mock.calls[0]?.[1]).toEqual(['user_1', 'series_1'])
  })

  it('uses bounded owner-scoped keyset pagination for the creator list', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresSeriesReadStore({ query } as unknown as SeriesPostgresQueryExecutor)

    await store.listCreatorSeries('user_1', {
      updatedAt: '2026-10-09T00:00:00.000Z',
      id: 'series_9',
    }, 21)
    expect(query.mock.calls[0]?.[0]).toContain('owner_user_id = $1')
    expect(query.mock.calls[0]?.[0]).toContain('(updated_at, id) < ($2::timestamptz, $3::text)')
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY updated_at DESC, id DESC')
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT $4')
    expect(query.mock.calls[0]?.[1]).toEqual([
      'user_1', '2026-10-09T00:00:00.000Z', 'series_9', 21,
    ])
  })

  it('rejects an invalid list limit before query and fails closed on PostgreSQL errors', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresSeriesReadStore({ query } as unknown as SeriesPostgresQueryExecutor)
    await expect(store.listCreatorSeries('user_1', null, 52))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(query).not.toHaveBeenCalled()

    const failed = createPostgresSeriesReadStore({
      query: vi.fn(async (_sql: string, _values?: unknown[]) => { throw new Error('private DB detail') }),
    } as unknown as SeriesPostgresQueryExecutor)
    await expect(failed.getSeries('user_1', 'series_1'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

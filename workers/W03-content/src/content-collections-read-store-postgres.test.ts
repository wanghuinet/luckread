import { describe, expect, it, vi } from 'vitest'

import { createPostgresCollectionListReadStore, type CollectionListPostgresQueryExecutor } from './content-collections-read-store-postgres.js'

describe('PostgreSQL creator-collection read store', () => {
  it('uses an owner-scoped parameterized detail query and maps timestamps', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({
      rows: [{
        id: 'collection_1',
        owner_user_id: 'user_1',
        creator_id: 'user_1',
        state: 'DRAFT' as const,
        version: 3,
        title: 'Collection 1',
        description: 'description',
        cover_ref: null,
        etag: 'W/"3"',
        created_at: new Date('2026-10-07T00:00:00.000Z'),
        updated_at: new Date('2026-10-08T00:00:00.000Z'),
      }],
    }))
    const store = createPostgresCollectionListReadStore({ query } as unknown as CollectionListPostgresQueryExecutor)

    await expect(store.getCollection('user_1', 'collection_1')).resolves.toEqual({
      id: 'collection_1',
      ownerUserId: 'user_1',
      creatorId: 'user_1',
      state: 'DRAFT',
      version: 3,
      title: 'Collection 1',
      description: 'description',
      coverRef: null,
      etag: 'W/"3"',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[0]).toContain('WHERE owner_user_id = $1 AND id = $2 LIMIT 1')
    expect(query.mock.calls[0]?.[1]).toEqual(['user_1', 'collection_1'])
  })

  it('uses owner-scoped keyset pagination and maps PostgreSQL timestamps', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({
      rows: [{
        id: 'collection_1',
        owner_user_id: 'user_1',
        creator_id: 'user_1',
        state: 'DRAFT' as const,
        version: 2,
        title: 'Collection 1',
        description: 'description',
        cover_ref: null,
        etag: 'W/"2"',
        created_at: new Date('2026-10-07T00:00:00.000Z'),
        updated_at: new Date('2026-10-08T00:00:00.000Z'),
      }],
    }))
    const store = createPostgresCollectionListReadStore({ query } as unknown as CollectionListPostgresQueryExecutor)

    const result = await store.listCreatorCollections(
      'user_1',
      { updatedAt: '2026-10-09T00:00:00.000Z', id: 'collection_9' },
      21,
    )

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[0]).toContain('owner_user_id = $1')
    expect(query.mock.calls[0]?.[0]).toContain('(updated_at, id) < ($2::timestamptz, $3::text)')
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY updated_at DESC, id DESC')
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT $4')
    expect(query.mock.calls[0]?.[1]).toEqual([
      'user_1',
      '2026-10-09T00:00:00.000Z',
      'collection_9',
      21,
    ])
    expect(result).toEqual([{
      id: 'collection_1',
      ownerUserId: 'user_1',
      creatorId: 'user_1',
      state: 'DRAFT',
      version: 2,
      title: 'Collection 1',
      description: 'description',
      coverRef: null,
      etag: 'W/"2"',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
    }])
  })

  it('returns null for an absent owner-scoped detail record', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresCollectionListReadStore({ query } as unknown as CollectionListPostgresQueryExecutor)
    await expect(store.getCollection('user_2', 'collection_1')).resolves.toBeNull()
  })

  it('rejects an invalid page size before querying', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresCollectionListReadStore({ query } as unknown as CollectionListPostgresQueryExecutor)
    await expect(store.listCreatorCollections('user_1', null, 52))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(query).not.toHaveBeenCalled()
  })

  it('normalizes query failures without exposing database details', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => {
      throw new Error('private connection detail')
    })
    const store = createPostgresCollectionListReadStore({ query } as unknown as CollectionListPostgresQueryExecutor)
    await expect(store.listCreatorCollections('user_1', null, 11))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

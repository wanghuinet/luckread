import { describe, expect, it, vi } from 'vitest'

import { createPostgresMembersReadStore, type MembersPostgresQueryExecutor } from './content-members-read-store-postgres.js'

describe('PostgreSQL creator membership list read stores', () => {
  const memberRow = {
    relationship_id: 'rel_1',
    position: 4,
    created_at: new Date('2026-10-07T00:00:00.000Z'),
    updated_at: new Date('2026-10-08T00:00:00.000Z'),
    content_id: 'content_1',
    content_slug: 'post-1',
    content_type: 'post' as const,
    content_state: 'PUBLISHED',
    content_title: 'Post 1',
  }

  it('checks series ownership and reads active members with bounded keyset ordering', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'series_1', version: 7, etag: 'W/"7"' }] })
      .mockResolvedValueOnce({ rows: [{ ...memberRow, series_id: 'series_1' }] })
    const store = createPostgresMembersReadStore({ query } as unknown as MembersPostgresQueryExecutor)

    await expect(store.series.listSeriesMembers('user_1', 'series_1', {
      position: 3,
      id: 'rel_0',
    }, 51)).resolves.toEqual({
      items: [{
        relationshipId: 'rel_1',
        seriesId: 'series_1',
        contentId: 'content_1',
        contentSlug: 'post-1',
        contentType: 'post',
        contentState: 'PUBLISHED',
        title: 'Post 1',
        position: 4,
        createdAt: '2026-10-07T00:00:00.000Z',
        updatedAt: '2026-10-08T00:00:00.000Z',
      }],
      seriesVersion: 7,
      seriesEtag: 'W/"7"',
    })
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0]?.[0]).toContain('content_series WHERE id = $1 AND owner_user_id = $2')
    expect(query.mock.calls[0]?.[1]).toEqual(['series_1', 'user_1'])
    expect(query.mock.calls[1]?.[0]).toContain("r.relation_type = 'series-member'")
    expect(query.mock.calls[1]?.[0]).toContain('(r.position, r.relationship_id) > ($2::integer, $3::text)')
    expect(query.mock.calls[1]?.[0]).toContain('ORDER BY r.position ASC, r.relationship_id ASC LIMIT $4')
    expect(query.mock.calls[1]?.[1]).toEqual(['series_1', 3, 'rel_0', 51])
  })

  it('checks collection ownership and returns version metadata with active members', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'collection_1', version: 5, etag: 'W/"5"' }] })
      .mockResolvedValueOnce({ rows: [{ ...memberRow, collection_id: 'collection_1' }] })
    const store = createPostgresMembersReadStore({ query } as unknown as MembersPostgresQueryExecutor)

    await expect(store.collections.listCollectionMembers('user_1', 'collection_1', null, 101))
      .resolves.toMatchObject({
        items: [{
          relationshipId: 'rel_1',
          collectionId: 'collection_1',
          contentId: 'content_1',
          position: 4,
        }],
        collectionVersion: 5,
        collectionEtag: 'W/"5"',
      })
    expect(query.mock.calls[0]?.[0]).toContain('content_collections WHERE id = $1 AND owner_user_id = $2')
    expect(query.mock.calls[1]?.[0]).toContain("r.relation_type = 'collection-member'")
    expect(query.mock.calls[1]?.[1]).toEqual(['collection_1', null, null, 101])
  })

  it('returns NOT_FOUND for non-owned parents and rejects unbounded limits before querying', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const store = createPostgresMembersReadStore({ query } as unknown as MembersPostgresQueryExecutor)
    await expect(store.series.listSeriesMembers('user_2', 'series_1', null, 11))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(query).toHaveBeenCalledTimes(1)

    const invalid = vi.fn()
    const invalidStore = createPostgresMembersReadStore({ query: invalid } as unknown as MembersPostgresQueryExecutor)
    await expect(invalidStore.collections.listCollectionMembers('user_1', 'collection_1', null, 102))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(invalid).not.toHaveBeenCalled()
  })

  it('normalizes PostgreSQL failures without exposing connection details', async () => {
    const store = createPostgresMembersReadStore({
      query: vi.fn(async () => { throw new Error('private connection detail') }),
    } as unknown as MembersPostgresQueryExecutor)
    await expect(store.series.listSeriesMembers('user_1', 'series_1', null, 11))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

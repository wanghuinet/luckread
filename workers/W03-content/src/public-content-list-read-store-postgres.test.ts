import { describe, expect, it, vi } from 'vitest'

import {
  createPostgresPublicContentListReadStore,
  type PublicContentListPostgresQueryExecutor,
} from './public-content-list-read-store-postgres.js'

describe('PostgreSQL public content list read store', () => {
  const row = {
    id: 'content_1',
    content_type: 'article' as const,
    owner_user_id: 'owner_1',
    creator_id: null,
    ip_id: null,
    state: 'PUBLISHED' as const,
    scheduled_at: null,
    access_mode: 'PUBLIC' as const,
    version: 2,
    revision: 1,
    slug: 'hello-world',
    title: 'Hello world',
    body_ref: 'body-ref',
    media_refs_json: '[]',
    cover_ref: null,
    media_warning: null,
    etag: 'W/"2"',
    created_at: new Date('2026-11-10T10:00:00.000Z'),
    updated_at: new Date('2026-11-11T11:00:00.000Z'),
  }

  it('lists only published content with optional filters and stable keyset order', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresPublicContentListReadStore({
      query,
    } as unknown as PublicContentListPostgresQueryExecutor)

    await expect(store.list({
      cursor: { createdAt: '2026-11-12T00:00:00.000Z', id: 'content_9' },
      limit: 21,
      creatorId: 'creator_1',
      ownerUserId: 'owner_1',
      contentType: 'article',
    })).resolves.toEqual([{
      ...row,
      created_at: '2026-11-10T10:00:00.000Z',
      updated_at: '2026-11-11T11:00:00.000Z',
    }])

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[0]).toContain("state = 'PUBLISHED'")
    expect(query.mock.calls[0]?.[0]).toContain('creator_id = $1')
    expect(query.mock.calls[0]?.[0]).toContain('owner_user_id = $2')
    expect(query.mock.calls[0]?.[0]).toContain('content_type = $3')
    expect(query.mock.calls[0]?.[0]).toContain('(created_at, id) < ($4::timestamptz, $5::text)')
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY created_at DESC, id DESC')
    expect(query.mock.calls[0]?.[1]).toEqual([
      'creator_1',
      'owner_1',
      'article',
      '2026-11-12T00:00:00.000Z',
      'content_9',
      21,
    ])
  })

  it('searches normalized title and slug text without LIKE wildcard expansion', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresPublicContentListReadStore({
      query,
    } as unknown as PublicContentListPostgresQueryExecutor)

    await expect(store.search({
      query: ' ＨＥＬＬＯ ',
      cursor: { createdAt: '2026-11-12T00:00:00.000Z', id: 'content_9' },
      limit: 12,
    })).resolves.toEqual([{
      ...row,
      created_at: '2026-11-10T10:00:00.000Z',
      updated_at: '2026-11-11T11:00:00.000Z',
    }])

    expect(query.mock.calls[0]?.[0]).toContain('strpos(lower(title), lower($1)) > 0')
    expect(query.mock.calls[0]?.[0]).toContain('strpos(lower(slug), lower($1)) > 0')
    expect(query.mock.calls[0]?.[0]).toContain('(created_at, id) < ($2::timestamptz, $3::text)')
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY created_at DESC, id DESC')
    expect(query.mock.calls[0]?.[1]).toEqual([
      'HELLO',
      '2026-11-12T00:00:00.000Z',
      'content_9',
      12,
    ])
  })

  it('rejects blank searches and invalid limits before querying', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresPublicContentListReadStore({
      query,
    } as unknown as PublicContentListPostgresQueryExecutor)

    await expect(store.search({ query: '  ', cursor: null, limit: 20 }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(store.list({
      cursor: null,
      limit: 52,
      creatorId: null,
      ownerUserId: null,
      contentType: null,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(query).not.toHaveBeenCalled()
  })

  it('fails closed on PostgreSQL errors without exposing connection details', async () => {
    const store = createPostgresPublicContentListReadStore({
      query: vi.fn(async () => { throw new Error('private connection detail') }),
    } as unknown as PublicContentListPostgresQueryExecutor)

    await expect(store.search({ query: 'story', cursor: null, limit: 11 }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

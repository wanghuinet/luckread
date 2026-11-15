import { describe, expect, it, vi } from 'vitest'

import {
  createPostgresContentDetailReadStore,
  type ContentDetailPostgresQueryExecutor,
} from './content-detail-read-store-postgres.js'

describe('PostgreSQL canonical content detail read store', () => {
  const row = {
    id: 'content_1',
    content_type: 'article' as const,
    owner_user_id: 'owner_1',
    creator_id: 'creator_1',
    ip_id: null,
    state: 'PUBLISHED' as const,
    scheduled_at: new Date('2026-11-01T00:00:00.000Z'),
    access_mode: 'MEMBERS_ONLY' as const,
    version: 4,
    revision: 3,
    slug: 'content-slug',
    title: 'Members only article',
    body_ref: 'body-ref-1',
    media_refs_json: '["media-ref-1"]',
    cover_ref: 'cover-ref-1',
    media_warning: null,
    etag: 'W/"4"',
    created_at: new Date('2026-10-30T00:00:00.000Z'),
    updated_at: new Date('2026-11-01T00:00:00.000Z'),
  }

  it('uses the canonical ID-or-slug lookup and enforces published-or-owner visibility in SQL', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresContentDetailReadStore({
      query,
    } as unknown as ContentDetailPostgresQueryExecutor)

    await expect(store.getContent('content-slug', null)).resolves.toEqual({
      ...row,
      scheduled_at: '2026-11-01T00:00:00.000Z',
      created_at: '2026-10-30T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[0]).toContain('(id = $1 OR slug = $1)')
    expect(query.mock.calls[0]?.[0]).toContain("(state = 'PUBLISHED' OR owner_user_id = $2)")
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT 1')
    expect(query.mock.calls[0]?.[1]).toEqual(['content-slug', ''])
  })

  it('passes the principal owner filter for unpublished creator drafts', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresContentDetailReadStore({
      query,
    } as unknown as ContentDetailPostgresQueryExecutor)

    await expect(store.getContent('draft_1', 'owner_1')).resolves.toBeNull()
    expect(query.mock.calls[0]?.[1]).toEqual(['draft_1', 'owner_1'])
  })

  it('returns null for absent content and fails closed on PostgreSQL errors', async () => {
    const empty = createPostgresContentDetailReadStore({
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ContentDetailPostgresQueryExecutor)
    await expect(empty.getContent('missing', null)).resolves.toBeNull()

    const failed = createPostgresContentDetailReadStore({
      query: vi.fn(async () => { throw new Error('private connection detail') }),
    } as unknown as ContentDetailPostgresQueryExecutor)
    await expect(failed.getContent('content_1', 'owner_1'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

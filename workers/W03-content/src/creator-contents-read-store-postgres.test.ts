import { describe, expect, it, vi } from 'vitest'

import {
  createPostgresCreatorContentsReadStore,
  type CreatorContentsPostgresQueryExecutor,
} from './creator-contents-read-store-postgres.js'

describe('PostgreSQL creator-contents read store', () => {
  const row = {
    id: 'content_1',
    content_type: 'video' as const,
    owner_user_id: 'owner_1',
    creator_id: 'creator_1',
    ip_id: null,
    state: 'SCHEDULED' as const,
    scheduled_at: new Date('2026-11-18T12:00:00.000Z'),
    access_mode: 'MEMBERS_ONLY' as const,
    version: 4,
    revision: 3,
    slug: 'scheduled-video',
    title: 'Scheduled video',
    body_ref: 'body-ref',
    media_refs_json: '["media-ref"]',
    cover_ref: 'cover-ref',
    media_warning: 'SENSITIVE' as const,
    etag: 'W/"4"',
    created_at: new Date('2026-11-10T10:00:00.000Z'),
    updated_at: new Date('2026-11-11T11:00:00.000Z'),
  }

  it('uses owner, state, type and stable keyset filters with bounded pagination', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresCreatorContentsReadStore({
      query,
    } as unknown as CreatorContentsPostgresQueryExecutor)

    await expect(store.list(
      'owner_1',
      { updatedAt: '2026-11-12T00:00:00.000Z', id: 'content_9' },
      31,
      { status: 'SCHEDULED', contentType: 'video' },
    )).resolves.toEqual([{
      ...row,
      scheduled_at: '2026-11-18T12:00:00.000Z',
      created_at: '2026-11-10T10:00:00.000Z',
      updated_at: '2026-11-11T11:00:00.000Z',
    }])

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[0]).toContain('owner_user_id = $1')
    expect(query.mock.calls[0]?.[0]).toContain('state = $2')
    expect(query.mock.calls[0]?.[0]).toContain('content_type = $3')
    expect(query.mock.calls[0]?.[0]).toContain('(updated_at, id) < ($4::timestamptz, $5::text)')
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY updated_at DESC, id DESC')
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT $6')
    expect(query.mock.calls[0]?.[1]).toEqual([
      'owner_1',
      'SCHEDULED',
      'video',
      '2026-11-12T00:00:00.000Z',
      'content_9',
      31,
    ])
  })

  it('omits optional filters and cursor while preserving the owner boundary', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresCreatorContentsReadStore({
      query,
    } as unknown as CreatorContentsPostgresQueryExecutor)

    await store.list('owner_1', null, 11, {})
    expect(query.mock.calls[0]?.[0]).toContain('WHERE owner_user_id = $1')
    expect(query.mock.calls[0]?.[0]).not.toContain('state =')
    expect(query.mock.calls[0]?.[0]).not.toContain('content_type =')
    expect(query.mock.calls[0]?.[1]).toEqual(['owner_1', 11])
  })

  it('rejects invalid owner and unbounded page sizes before querying', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresCreatorContentsReadStore({
      query,
    } as unknown as CreatorContentsPostgresQueryExecutor)

    await expect(store.list('', null, 11, {}))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(store.list('owner_1', null, 52, {}))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(query).not.toHaveBeenCalled()
  })

  it('fails closed on PostgreSQL errors without exposing connection details', async () => {
    const store = createPostgresCreatorContentsReadStore({
      query: vi.fn(async () => { throw new Error('private connection detail') }),
    } as unknown as CreatorContentsPostgresQueryExecutor)

    await expect(store.list('owner_1', null, 11, {}))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

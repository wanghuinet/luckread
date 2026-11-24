import { describe, expect, it, vi } from 'vitest'

import {
  encodeScopedCursor,
  getContentRevision,
  listContentRevisions,
  type ContentRevision,
  type ContentRevisionReadStore,
} from './content-runtime.js'
import {
  createPostgresContentRevisionReadStore,
  type ContentRevisionPostgresQueryExecutor,
} from './content-revision-read-store-postgres.js'
import { createW03ContentWorker } from './index.js'

const revision = (overrides: Partial<ContentRevision> = {}): ContentRevision => ({
  id: 'revision-1',
  contentId: 'content-1',
  revision: 2,
  contentVersion: 2,
  actorUserId: 'owner-1',
  sourceRevision: 1,
  operation: 'UPDATE',
  state: 'DRAFT',
  accessMode: 'MEMBERS_ONLY',
  slug: 'draft-slug',
  title: 'A revision',
  bodyRef: 'body:revision-1',
  mediaRefs: ['media:one'],
  coverRef: null,
  mediaWarning: null,
  etag: 'etag-revision-1',
  reason: 'edited',
  correlationId: 'correlation-1',
  createdAt: '2026-11-16T12:00:00.000Z',
  ...overrides,
})

const postgresRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'revision-1',
  content_id: 'content-1',
  revision: 2,
  content_version: 2,
  actor_user_id: 'owner-1',
  source_revision: 1,
  operation: 'UPDATE' as const,
  state: 'DRAFT' as const,
  access_mode: 'MEMBERS_ONLY' as const,
  slug: 'draft-slug',
  title: 'A revision',
  body_ref: 'body:revision-1',
  media_refs_json: '["media:one"]',
  cover_ref: null,
  media_warning: null,
  etag: 'etag-revision-1',
  reason: 'edited',
  correlation_id: 'correlation-1',
  created_at: new Date('2026-11-16T12:00:00.000Z'),
  ...overrides,
})

describe('W03 PostgreSQL content revision reader', () => {
  it('lists owner-scoped revisions in stable order and maps PostgreSQL timestamps', async () => {
    const row = postgresRow()
    const database = {
      query: vi.fn(async () => ({ rows: [row] })),
    } as unknown as ContentRevisionPostgresQueryExecutor
    const store = createPostgresContentRevisionReadStore(database)

    await expect(store.list('owner-1', 'content-1', null, 21)).resolves.toEqual([
      revision(),
    ])
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('JOIN contents c ON c.id = r.content_id'),
      ['content-1', 'owner-1', 21],
    )
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('c.owner_user_id = $2'),
      expect.any(Array),
    )
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY r.created_at DESC, r.id DESC'),
      expect.any(Array),
    )
  })

  it('uses a stable timestamp-plus-ID cursor without changing owner scope', async () => {
    const database = {
      query: vi.fn(async () => ({ rows: [postgresRow()] })),
    } as unknown as ContentRevisionPostgresQueryExecutor
    const store = createPostgresContentRevisionReadStore(database)
    const cursor = { updatedAt: '2026-11-16T11:00:00.000Z', id: 'revision-0' }

    await store.list('owner-1', 'content-1', cursor, 11)

    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('r.created_at < $3::timestamptz'),
      ['content-1', 'owner-1', cursor.updatedAt, cursor.id, 11],
    )
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('AND c.owner_user_id = $2'),
      expect.any(Array),
    )
  })

  it('gets a single revision only through its content and owner scope', async () => {
    const database = {
      query: vi.fn(async () => ({ rows: [postgresRow()] })),
    } as unknown as ContentRevisionPostgresQueryExecutor
    const store = createPostgresContentRevisionReadStore(database)

    await expect(store.get('owner-1', 'content-1', 'revision-1')).resolves.toEqual(revision())
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE r.id = $1'),
      ['revision-1', 'content-1', 'owner-1'],
    )
  })

  it('returns null for missing or other-owner revision IDs', async () => {
    const database = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as ContentRevisionPostgresQueryExecutor
    const store = createPostgresContentRevisionReadStore(database)

    await expect(store.get('someone-else', 'content-1', 'revision-1')).resolves.toBeNull()
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('c.owner_user_id = $3'),
      ['revision-1', 'content-1', 'someone-else'],
    )
  })

  it('maps database failures to a non-leaking service error', async () => {
    const database = {
      query: vi.fn(async () => {
        throw new Error('postgres://secret-host/database SQL leaked')
      }),
    } as unknown as ContentRevisionPostgresQueryExecutor
    const store = createPostgresContentRevisionReadStore(database)

    await expect(store.get('owner-1', 'content-1', 'revision-1'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

describe('W03 revision runtime injection', () => {
  it('uses the injected reader for pagination', async () => {
    const first = revision({ id: 'revision-2', createdAt: '2026-11-16T12:00:00.000Z' })
    const second = revision({ id: 'revision-1', createdAt: '2026-11-16T11:00:00.000Z' })
    const store: ContentRevisionReadStore = {
      list: vi.fn(async () => [first, second]),
      get: vi.fn(async () => first),
    }
    const page = await listContentRevisions(
      store,
      'owner-1',
      'content-1',
      null,
      1,
    )

    expect(store.list).toHaveBeenCalledWith('owner-1', 'content-1', null, 2)
    expect(page.items).toEqual([first])
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe(encodeScopedCursor(first.createdAt, first.id,
      JSON.stringify({ type: 'content-revisions', principalUserId: 'owner-1', contentId: 'content-1' })))
  })

  it('uses the injected reader for details and preserves not-found semantics', async () => {
    const store: ContentRevisionReadStore = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
    }

    await expect(getContentRevision(
      store,
      'owner-1',
      'content-1',
      'revision-1',
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('fails closed when Neon revision readers or the restore store are unavailable', async () => {
    const worker = createW03ContentWorker()
    const env = {} as never
    const headers = {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'content-revision-store-unavailable',
      'X-LuckRead-Principal-User-Id': 'owner-1',
      'X-LuckRead-Principal-Layer': 'L3',
    }

    const listResponse = await worker.fetch(
      new Request('https://w03.internal/internal/content/contents/content-1/revisions?limit=10', { headers }),
      env,
    )
    const detailResponse = await worker.fetch(
      new Request('https://w03.internal/internal/content/contents/content-1/revisions/revision-1', { headers }),
      env,
    )
    const rollbackResponse = await worker.fetch(
      new Request('https://w03.internal/internal/content/contents/content-1/revisions/revision-1/rollback', {
        method: 'POST',
        headers: {
          ...headers,
          'If-Match': 'W/"2"',
          'Idempotency-Key': 'revision-restore-unavailable',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'restore previous revision' }),
      }),
      env,
    )

    expect(listResponse.status).toBe(503)
    expect(detailResponse.status).toBe(503)
    expect(rollbackResponse.status).toBe(503)
  })

  it('routes both revision endpoints through the injected reader', async () => {
    const item = revision()
    const store: ContentRevisionReadStore = {
      list: vi.fn(async () => [item]),
      get: vi.fn(async () => item),
    }
    const worker = createW03ContentWorker({
      contentRevisionReadStoreProvider: () => store,
    })
    const env = {} as never
    const headers = {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'content-revision-read-store-test',
      'X-LuckRead-Principal-User-Id': 'owner-1',
      'X-LuckRead-Principal-Layer': 'L3',
    }

    const listResponse = await worker.fetch(
      new Request('https://w03.internal/internal/content/contents/content-1/revisions?limit=10', { headers }),
      env,
    )
    const detailResponse = await worker.fetch(
      new Request('https://w03.internal/internal/content/contents/content-1/revisions/revision-1', { headers }),
      env,
    )

    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toMatchObject({ data: { items: [item], hasMore: false } })
    expect(detailResponse.status).toBe(200)
    expect(await detailResponse.json()).toMatchObject({ data: item })
    expect(store.list).toHaveBeenCalledWith('owner-1', 'content-1', null, 11)
    expect(store.get).toHaveBeenCalledWith('owner-1', 'content-1', 'revision-1')
  })
})

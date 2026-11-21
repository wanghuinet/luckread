import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool, type PoolClient } from 'pg'

import { ContentRuntimeError, type ContentRow } from './content-runtime.js'
import { createPostgresFollowingOwnerContentsReadStore } from './following-owner-contents-read-store-postgres.js'
import type { FollowingOwnerContentsPostgresQueryExecutor } from './following-owner-contents-read-store-postgres.js'

const row = (id: string, ownerUserId: string, createdAt: string): ContentRow => ({
  id,
  content_type: 'post',
  owner_user_id: ownerUserId,
  creator_id: ownerUserId,
  ip_id: null,
  state: 'PUBLISHED',
  scheduled_at: null,
  access_mode: 'PUBLIC',
  version: 1,
  revision: 1,
  slug: id,
  title: id,
  body_ref: `body-${id}`,
  media_refs_json: '[]',
  cover_ref: null,
  media_warning: null,
  etag: 'W/"1"',
  created_at: createdAt,
  updated_at: createdAt,
})

describe('W03 PostgreSQL following-feed read store', () => {
  it('uses the W04-authorized owner set, published-only filter, stable keyset order, and bounded limit', async () => {
    const rows = [row('post-2', 'creator-2', '2026-11-13T11:00:00.000Z')]
    const query = vi.fn(async () => ({ rows }))
    const store = createPostgresFollowingOwnerContentsReadStore({ query })

    const result = await store.list(
      ['creator-2', 'creator-1', 'creator-2'],
      { createdAt: '2026-11-13T12:00:00.000Z', id: 'post-9' },
      21,
    )

    expect(result).toEqual(rows)
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain("c.state = 'PUBLISHED'")
    expect(sql).toContain('c.owner_user_id = ANY($1::text[])')
    expect(sql).toContain('(c.created_at, c.id) < ($2::timestamptz, $3::text)')
    expect(sql).toContain('ORDER BY c.created_at DESC, c.id DESC')
    expect(values).toEqual([
      ['creator-2', 'creator-1'],
      '2026-11-13T12:00:00.000Z',
      'post-9',
      21,
    ])
    expect(sql).not.toContain('social_follow_relationships')
    expect(sql).not.toContain('social_user_interactions')
  })

  it('normalizes PostgreSQL timestamptz Date values to API-compatible ISO strings', async () => {
    const rows = [{
      ...row('post-date', 'creator-1', '2026-11-13T11:00:00.000Z'),
      created_at: new Date('2026-11-13T11:00:00.000Z'),
      updated_at: new Date('2026-11-13T11:01:00.000Z'),
      scheduled_at: new Date('2026-11-13T12:00:00.000Z'),
    } as unknown as Record<string, unknown>]
    const store = createPostgresFollowingOwnerContentsReadStore({
      query: vi.fn(async () => ({ rows })),
    })

    await expect(store.list(['creator-1'], null, 5)).resolves.toMatchObject([{
      created_at: '2026-11-13T11:00:00.000Z',
      updated_at: '2026-11-13T11:01:00.000Z',
      scheduled_at: '2026-11-13T12:00:00.000Z',
    }])
  })

  it('returns no rows without querying for an empty owner set', async () => {
    const query = vi.fn()
    const store = createPostgresFollowingOwnerContentsReadStore({ query })
    await expect(store.list([], null, 5)).resolves.toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it('maps PostgreSQL failures to a safe service-unavailable error', async () => {
    const store = createPostgresFollowingOwnerContentsReadStore({
      query: vi.fn(async () => { throw new Error('sensitive connection detail') }),
    })
    await expect(store.list(['creator-1'], null, 5))
      .rejects.toBeInstanceOf(ContentRuntimeError)
    await expect(store.list(['creator-1'], null, 5))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('rejects invalid limits before querying PostgreSQL', async () => {
    const query = vi.fn()
    const store = createPostgresFollowingOwnerContentsReadStore({ query })
    await expect(store.list(['creator-1'], null, 0))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(query).not.toHaveBeenCalled()
  })
})

const postgresUrl = process.env.W03_POSTGRES_TEST_URL

describe.skipIf(!postgresUrl)('W03 PostgreSQL following-feed integration', () => {
  let pool: Pool | undefined
  let client: PoolClient | undefined

  beforeAll(async () => {
    pool = new Pool({ connectionString: postgresUrl, max: 1 })
    client = await pool.connect()
    await client.query(`
      CREATE TEMP TABLE contents (
        id TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        creator_id TEXT,
        ip_id TEXT,
        state TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ,
        access_mode TEXT,
        version INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        body_ref TEXT NOT NULL,
        media_refs_json TEXT NOT NULL,
        cover_ref TEXT,
        media_warning TEXT,
        etag TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `)
    await client.query(`
      INSERT INTO contents (
        id, content_type, owner_user_id, creator_id, state, version, revision,
        slug, title, body_ref, media_refs_json, etag, created_at, updated_at
      ) VALUES
        ('post-new', 'post', 'creator-1', 'creator-1', 'PUBLISHED', 1, 1,
         'post-new', 'New post', 'body-new', '[]', 'W/"1"', '2026-11-13T12:00:00Z', '2026-11-13T12:00:00Z'),
        ('post-b', 'post', 'creator-2', 'creator-2', 'PUBLISHED', 1, 1,
         'post-b', 'Post B', 'body-b', '[]', 'W/"1"', '2026-11-13T11:00:00Z', '2026-11-13T11:00:00Z'),
        ('post-a', 'post', 'creator-1', 'creator-1', 'PUBLISHED', 1, 1,
         'post-a', 'Post A', 'body-a', '[]', 'W/"1"', '2026-11-13T11:00:00Z', '2026-11-13T11:00:00Z'),
        ('post-draft', 'post', 'creator-1', 'creator-1', 'DRAFT', 1, 1,
         'post-draft', 'Draft', 'body-draft', '[]', 'W/"1"', '2026-11-13T13:00:00Z', '2026-11-13T13:00:00Z'),
        ('post-outside', 'post', 'creator-3', 'creator-3', 'PUBLISHED', 1, 1,
         'post-outside', 'Outside', 'body-outside', '[]', 'W/"1"', '2026-11-13T14:00:00Z', '2026-11-13T14:00:00Z')
    `)
  })

  afterAll(async () => {
    client?.release()
    await pool?.end()
  })

  it('executes against PostgreSQL 18 with exact publish filtering, owner scope, ordering, and cursor semantics', async () => {
    const store = createPostgresFollowingOwnerContentsReadStore(
      client as unknown as FollowingOwnerContentsPostgresQueryExecutor,
    )
    const firstPage = await store.list(['creator-1', 'creator-2'], null, 3)
    expect(firstPage.map((item) => item.id)).toEqual(['post-new', 'post-b', 'post-a'])
    expect(firstPage.every((item) => item.state === 'PUBLISHED')).toBe(true)
    expect(firstPage.every((item) => ['creator-1', 'creator-2'].includes(item.owner_user_id))).toBe(true)
    expect(typeof firstPage[0]?.created_at).toBe('string')

    const nextPage = await store.list(
      ['creator-1', 'creator-2'],
      { createdAt: firstPage[1]!.created_at, id: firstPage[1]!.id },
      3,
    )
    expect(nextPage.map((item) => item.id)).toEqual(['post-a'])
  })
})

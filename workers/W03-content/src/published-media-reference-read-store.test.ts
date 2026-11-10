import { describe, expect, it } from 'vitest'

import { resolvePublishedMediaReferenceAccess } from './content-runtime.js'
import {
  createD1PublishedMediaReferenceReadStore,
  PublishedMediaReferenceReadStoreError,
} from './published-media-reference-read-store.js'
import { createPostgresPublishedMediaReferenceReadStore } from './published-media-reference-read-store-postgres.js'

const candidates = [
  'https://img.luckread.com/media/photo-one.png',
  'https://video.luckread.com/media/clip-two.mp4',
]

const rows = [{
  id: 'post_001',
  owner_user_id: 'owner_001',
  creator_id: 'creator_001',
  content_type: 'post' as const,
  access_mode: 'PUBLIC' as const,
}]

function fakeD1(options: { rows?: typeof rows; fail?: boolean } = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    prepare(sql: string) {
      const call = { sql, values: [] as unknown[] }
      calls.push(call)
      return {
        bind(...values: unknown[]) {
          call.values = values
          return this
        },
        async all<T>() {
          if (options.fail) throw new Error('D1 unavailable')
          return { results: (options.rows ?? rows) as unknown as T[] }
        },
      }
    },
  }
  return { db, calls }
}

function fakePostgres(options: { rows?: typeof rows; fail?: boolean } = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const database = {
    async query<T>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.fail) throw new Error('PostgreSQL unavailable')
      return { rows: (options.rows ?? rows) as unknown as T[] }
    },
  }
  return { database, calls }
}

describe('W03 published media reference read store', () => {
  it('preserves the D1 JSON1 lookup, deterministic ordering and row bound', async () => {
    const { db, calls } = fakeD1()
    const result = await createD1PublishedMediaReferenceReadStore(db as never)
      .listPublishedMediaReferences(candidates, 51)

    expect(result).toEqual(rows)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain("state = 'PUBLISHED'")
    expect(calls[0]?.sql).toContain('json_each(contents.media_refs_json)')
    expect(calls[0]?.sql).toContain('ORDER BY id ASC')
    expect(calls[0]?.sql).toContain('LIMIT ?')
    expect(calls[0]?.values).toEqual([
      ...candidates,
      ...candidates,
      ...candidates,
      51,
    ])
  })

  it('returns no D1 rows without querying for an empty candidate list', async () => {
    const { db, calls } = fakeD1()
    await expect(createD1PublishedMediaReferenceReadStore(db as never)
      .listPublishedMediaReferences([], 51)).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('wraps D1 query failures without leaking driver errors', async () => {
    const { db } = fakeD1({ fail: true })
    await expect(createD1PublishedMediaReferenceReadStore(db as never)
      .listPublishedMediaReferences(candidates, 51))
      .rejects.toMatchObject({ code: 'QUERY_FAILED' })
  })

  it('uses PostgreSQL array matching for scalar and JSON-text media references', async () => {
    const { database, calls } = fakePostgres()
    const result = await createPostgresPublishedMediaReferenceReadStore(database)
      .listPublishedMediaReferences(candidates, 51)

    expect(result).toEqual(rows)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('body_ref = ANY($1::text[])')
    expect(calls[0]?.sql).toContain('cover_ref = ANY($1::text[])')
    expect(calls[0]?.sql).toContain('contents.media_refs_json::jsonb ?| $1::text[]')
    expect(calls[0]?.sql).toContain("state = 'PUBLISHED'")
    expect(calls[0]?.sql).toContain('ORDER BY id ASC')
    expect(calls[0]?.sql).toContain('LIMIT $2')
    expect(calls[0]?.values).toEqual([candidates, 51])
  })

  it('returns no PostgreSQL rows without querying for an empty candidate list', async () => {
    const { database, calls } = fakePostgres()
    await expect(createPostgresPublishedMediaReferenceReadStore(database)
      .listPublishedMediaReferences([], 51)).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('wraps PostgreSQL query failures without leaking driver errors', async () => {
    const { database } = fakePostgres({ fail: true })
    await expect(createPostgresPublishedMediaReferenceReadStore(database)
      .listPublishedMediaReferences(candidates, 51))
      .rejects.toMatchObject({ code: 'QUERY_FAILED' })
  })

  it('rejects invalid limits and malformed candidate references before querying', async () => {
    const { database, calls } = fakePostgres()
    const store = createPostgresPublishedMediaReferenceReadStore(database)
    await expect(store.listPublishedMediaReferences(candidates, 52))
      .rejects.toBeInstanceOf(PublishedMediaReferenceReadStoreError)
    await expect(store.listPublishedMediaReferences(['  '], 51))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(calls).toHaveLength(0)
  })

  it('allows the W03 authorization decision to use an injected provider store', async () => {
    let called = false
    const store = {
      async listPublishedMediaReferences(lookup: readonly string[], limit: number) {
        called = true
        expect(lookup).toEqual(['https://img.luckread.com/media/photo.png'])
        expect(limit).toBe(51)
        return rows
      },
    }
    const db = {
      prepare() {
        throw new Error('injected store must not use D1')
      },
    }
    const result = await resolvePublishedMediaReferenceAccess(
      db as never,
      'https://img.luckread.com/media/photo.png',
      null,
      undefined,
      store,
    )
    expect(called).toBe(true)
    expect(result).toEqual({ isPublic: true, isMemberContent: false, allowed: true })
  })
})

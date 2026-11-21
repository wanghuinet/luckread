import { describe, expect, it } from 'vitest'

import { resolvePublishedMediaReferenceAccess } from './content-runtime.js'
import { PublishedMediaReferenceReadStoreError } from './published-media-reference-read-store.js'
import { createPostgresPublishedMediaReferenceReadStore } from './published-media-reference-read-store-postgres.js'
import { createW03ContentWorker } from './index.js'

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
  it('routes media authorization through the injected Neon store', async () => {
    let storeCalls = 0
    const mediaUrl = 'https://img.luckread.com/media/neon-read-only.png'
    const store = {
      async listPublishedMediaReferences(candidates: readonly string[], limit: number) {
        storeCalls += 1
        expect(candidates).toEqual([mediaUrl])
        expect(limit).toBe(51)
        return rows
      },
    }
    const worker = createW03ContentWorker({ publishedMediaReferenceReadStore: store })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/public-media-reference?url=' + encodeURIComponent(mediaUrl), {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'w03-postgres-media-route-injection',
        },
      }),
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { isPublic: true, isMemberContent: false, allowed: true },
    })
    expect(storeCalls).toBe(1)
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
    const result = await resolvePublishedMediaReferenceAccess(
      'https://img.luckread.com/media/photo.png',
      null,
      undefined,
      store,
    )
    expect(called).toBe(true)
    expect(result).toEqual({ isPublic: true, isMemberContent: false, allowed: true })
  })
})

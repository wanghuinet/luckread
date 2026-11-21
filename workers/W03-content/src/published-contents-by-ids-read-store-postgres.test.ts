import { describe, expect, it } from 'vitest'

import { createPostgresPublishedContentsByIdsReadStore } from './published-contents-by-ids-read-store-postgres.js'
import { createW03ContentWorker } from './index.js'

const publishedRows = [
  {
    id: 'content_2', content_type: 'post', owner_user_id: 'user_2', creator_id: 'user_2',
    ip_id: null, state: 'PUBLISHED', scheduled_at: null, version: 1, revision: 1,
    slug: 'post-2', title: 'Post 2', body_ref: 'body_2', media_refs_json: '[]',
    cover_ref: null, media_warning: null, etag: 'W/"1"',
    created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z',
  },
  {
    id: 'content_1', content_type: 'article', owner_user_id: 'user_1', creator_id: 'user_1',
    ip_id: null, state: 'PUBLISHED', scheduled_at: null, version: 1, revision: 1,
    slug: 'article-1', title: 'Article 1', body_ref: 'body_1', media_refs_json: '[]',
    cover_ref: null, media_warning: null, etag: 'W/"1"',
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  },
] as const

describe('W03 PostgreSQL bookmark-content batch read', () => {
  it('preserves requested bookmark order and filters to published content', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const database = {
      async query(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [...publishedRows] }
      },
    }

    const items = await createPostgresPublishedContentsByIdsReadStore(database)
      .list(['content_2', 'content_1'])

    expect(items.map(item => item.id)).toEqual(['content_2', 'content_1'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('unnest($1::text[]) WITH ORDINALITY')
    expect(calls[0]?.sql).toContain("WHERE c.state = 'PUBLISHED'")
    expect(calls[0]?.sql).toContain('ORDER BY requested.ordinality ASC')
    expect(calls[0]?.sql).toContain('LIMIT $2')
    expect(calls[0]?.values).toEqual([['content_2', 'content_1'], 2])
  })

  it('does not query PostgreSQL for an empty ID list', async () => {
    let calls = 0
    const database = {
      async query() {
        calls += 1
        return { rows: [] }
      },
    }
    await expect(createPostgresPublishedContentsByIdsReadStore(database).list([])).resolves.toEqual([])
    expect(calls).toBe(0)
  })

  it('converts database failures to the stable W03 service-unavailable error', async () => {
    const database = {
      async query() {
        throw new Error('sensitive database connection details')
      },
    }
    await expect(createPostgresPublishedContentsByIdsReadStore(database).list(['content_1']))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('uses the injected store for the bookmark route without touching D1', async () => {
    let d1Calls = 0
    const store = {
      async list(ids: readonly string[]) {
        expect(ids).toEqual(['content_2', 'content_1'])
        return [...publishedRows]
      },
    }
    const worker = createW03ContentWorker({
      publishedContentsByIdsReadStoreProvider: () => store,
    })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/bookmarked-items', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'bookmark-neon-read-test',
          'X-LuckRead-Principal-User-Id': 'viewer_1',
          'X-LuckRead-Principal-Layer': 'L2',
        },
        body: JSON.stringify({ ids: ['content_2', 'content_1'] }),
      }),
      {
        D1_02: {
          prepare() {
            d1Calls += 1
            throw new Error('D1 must not be touched when the read store is injected')
          },
        },
      } as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [
          { id: 'content_2', title: 'Post 2', bodyRef: 'body_2' },
          { id: 'content_1', title: 'Article 1', bodyRef: 'body_1' },
        ],
      },
    })
    expect(d1Calls).toBe(0)
  })
})

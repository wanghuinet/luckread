/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const feedRows = [
  {
    id: 'content-1',
    slug: 'hello-1',
    owner_user_id: 'creator-1',
    creator_id: 'creator-1',
    created_at: '2026-10-16T12:00:00.000Z',
    content_type: 'post' as const,
    title: 'Followed creator post',
    body_ref: null,
    media_refs_json: '["https://cdn.example/video.mp4"]',
    cover_ref: 'https://cdn.example/cover.jpg',
    updated_at: '2026-10-16T12:00:00.000Z',
  },
  {
    id: 'content-2',
    slug: 'hello-2',
    owner_user_id: 'creator-2',
    creator_id: 'creator-2',
    created_at: '2026-10-16T11:00:00.000Z',
    content_type: 'article' as const,
    title: 'Another followed creator post',
    body_ref: 'body-2',
    media_refs_json: '[]',
    cover_ref: null,
    updated_at: '2026-10-16T11:00:00.000Z',
  },
]

const dbForFeed = () => {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((..._args: unknown[]) => ({
      all: vi.fn(async () => ({ results: feedRows })),
      first: vi.fn(async () => null),
      run: vi.fn(async () => ({ meta: { changes: 0 } })),
      sql,
    })),
  }))
  return { db: { prepare } as unknown as D1Database, prepare }
}

const headers = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'following-feed-test',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
  'X-LuckRead-Principal-Layer': 'L1',
}

describe('W05 following feed runtime', () => {
  it('returns only published, followed-author content with stable cursor pagination', async () => {
    const { db, prepare } = dbForFeed()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/feed/following?limit=1', { headers }),
      { DB: db },
    )
    expect(response.status).toBe(200)
    const payload = await response.json() as {
      data: {
        items: Array<{ id: string; creatorId: string; mediaRefs: string[]; contentType: string }>
        hasMore: boolean
        nextCursor: string | null
      }
    }
    expect(payload.data.items).toHaveLength(1)
    expect(payload.data.items[0]).toMatchObject({
      id: 'content-1',
      creatorId: 'creator-1',
      contentType: 'post',
      mediaRefs: ['https://cdn.example/video.mp4'],
    })
    expect(payload.data.hasMore).toBe(true)
    expect(payload.data.nextCursor).toBeTruthy()
    const sql = prepare.mock.calls[0]?.[0] ?? ''
    expect(sql).toContain("c.state = 'PUBLISHED'")
    expect(sql).toContain('social_follow_relationships')
    expect(sql).toContain("b.relation_type = 'block'")
    expect(sql).toContain("m.relation_type = 'mute'")

    const foreignViewerResponse = await worker.fetch(
      new Request(
        'https://luckread-w05.internal/internal/social/feed/following?limit=1&cursor=' +
          encodeURIComponent(payload.data.nextCursor ?? ''),
        { headers: { ...headers, 'X-LuckRead-Principal-User-Id': 'viewer-2' } },
      ),
      { DB: db },
    )
    expect(foreignViewerResponse.status).toBe(400)
    await expect(foreignViewerResponse.json()).resolves.toMatchObject({
      error: { code: 'INVALID_CURSOR' },
    })
  })

  it('requires the trusted W01 transport and an authenticated principal', async () => {
    const { db } = dbForFeed()
    const noPrincipal = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/feed/following'),
      { DB: db },
    )
    expect(noPrincipal.status).toBe(403)

    const noUser = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/feed/following', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'missing-principal',
        },
      }),
      { DB: db },
    )
    expect(noUser.status).toBe(401)
  })

  it('rejects malformed cursors and unbounded page sizes', async () => {
    const { db } = dbForFeed()
    const invalidLimit = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/feed/following?limit=1000', { headers }),
      { DB: db },
    )
    expect(invalidLimit.status).toBe(422)

    const invalidCursor = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/feed/following?cursor=not-a-valid-json-cursor', { headers }),
      { DB: db },
    )
    expect(invalidCursor.status).toBe(400)
  })
})

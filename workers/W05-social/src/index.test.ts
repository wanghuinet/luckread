/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'


const dbFor = (results: unknown[] = []) => {
  let index = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => results[index++] ?? null),
      all: vi.fn(async () => ({ results })),
      run: vi.fn(async () => ({ sql, args })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

const request = (pathname: string, headers: Record<string, string> = {}) =>
  new Request(`https://luckread-w05.internal${pathname}`, { headers })

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'test-correlation',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
}

describe('W05 social query transport', () => {
  it('creates a share for published content', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/content/content-1/shares', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'Idempotency-Key': 'share-1',
        },
      }),
      {
        DB: dbFor([
          { id: 'content-1', state: 'PUBLISHED' },
          null,
          { share_id: 'share-1', content_id: 'content-1', actor_user_id: 'viewer-1', created_at: '2026-10-02T00:00:00.000Z' },
        ]),
      },
    )
    expect(response.status).toBe(201)
  })

  it('resolves a share without a viewer principal', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/shares/share-1', {
        method: 'GET',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'share-resolve',
        },
      }),
      { DB: dbFor([{ share_id: 'share-1', content_id: 'content-1', created_at: '2026-10-02T00:00:00.000Z', state: 'PUBLISHED' }]) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { contentId: 'content-1' } })
  })

  it('requires an idempotency key for share creation', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/content/content-1/shares', {
        method: 'POST',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2' },
      }),
      { DB: dbFor([{ id: 'content-1', state: 'PUBLISHED' }]) },
    )
    expect(response.status).toBe(428)
  })

  it('accepts an idempotent content favorite', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'content-type': 'application/json',
          'Idempotency-Key': 'favorite-1',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      {
        DB: dbFor([
          { id: 'content-1', state: 'PUBLISHED' },
          {
            relationship_id: 'favorite-1',
            actor_user_id: 'viewer-1',
            target_type: 'content',
            target_id: 'content-1',
            created_at: '2026-10-02T00:00:00.000Z',
          },
        ]),
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { relationshipId: 'favorite-1', targetId: 'content-1' },
    })
  })

  it('reads favorite status for the authenticated actor', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks?targetType=content&targetId=content-1', {
        method: 'GET',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2' },
      }),
      { DB: dbFor([{ favorited: 1 }]) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { favorited: true },
    })
  })

  it('requires an idempotency key for favorite mutations', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(428)
  })

  it('unfavorites with a 204 response', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'content-type': 'application/json',
          'Idempotency-Key': 'favorite-delete-1',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(204)
  })

  it('denies favorites below the minimum interaction permission layer', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L1',
          'content-type': 'application/json',
          'Idempotency-Key': 'favorite-2',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(403)
  })

  it('accepts an idempotent content like', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      {
        DB: dbFor([
          { id: 'content-1', state: 'PUBLISHED' },
          {
            relationship_id: 'like-1',
            actor_user_id: 'user-1',
            target_type: 'content',
            target_id: 'content-1',
            created_at: '2026-10-02T00:00:00.000Z',
          },
        ]),
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { relationshipId: 'like-1', targetId: 'content-1' },
    })
  })

  it('reads like status for the authenticated actor', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes?targetType=content&targetId=content-1', {
        method: 'GET',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2' },
      }),
      { DB: dbFor([{ relationship_id: 'like-1' }]) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { liked: true },
    })
  })

  it('unlikes with a 204 response', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'DELETE',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(204)
  })

  it('denies like without the minimum interaction permission layer', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(403)
  })

  it('serves followers without a principal for public reads', async () => {
    const publicTransportHeaders = {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'public-follow-test',
    }
    const response = await worker.fetch(
      request('/internal/social/users/creator-1/followers?limit=20', publicTransportHeaders),
      { DB: dbFor([]) },
    )
    expect(response.status).toBe(200)
  })

  it('serves followers with relationship rows and total count', async () => {
    const env = {
      DB: dbFor([
        {
          relationship_id: 'r1',
          user_id: 'fan-1',
          followed_at: '2026-10-02T00:00:00.000Z',
          total_count: 1,
        },
      ]),
    }

    const response = await worker.fetch(
      request('/internal/social/users/creator-1/followers?limit=20', transportHeaders),
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [
          {
            relationshipId: 'r1',
            userId: 'fan-1',
            followedAt: '2026-10-02T00:00:00.000Z',
          },
        ],
        totalCount: 1,
        nextCursor: null,
        hasMore: false,
      },
    })
  })

  it('serves following from the same relationship authority', async () => {
    const env = {
      DB: dbFor([
        {
          relationship_id: 'r2',
          user_id: 'creator-2',
          followed_at: '2026-10-02T00:00:00.000Z',
          total_count: 1,
        },
      ]),
    }

    const response = await worker.fetch(
      request('/internal/social/users/user-1/following', transportHeaders),
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        totalCount: 1,
        items: [{ userId: 'creator-2' }],
      },
    })
  })

  it('fails closed when the W01 transport boundary is missing', async () => {
    const response = await worker.fetch(
      request('/internal/social/users/creator-1/followers'),
      { DB: dbFor([]) },
    )

    expect(response.status).toBe(403)
  })

  it('rejects non-GET query transport', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/users/creator-1/followers', {
        method: 'POST',
        headers: transportHeaders,
      }),
      { DB: dbFor([]) },
    )

    expect(response.status).toBe(405)
  })
})


describe('W05 social comment transport', () => {
  const commentHeaders = {
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': 'comment-test',
  }

  it('serves public comments without a principal header', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/comments?limit=20', {
        headers: commentHeaders,
      }),
      {
        DB: dbFor([]),
      },
    )
    expect(response.status).toBe(200)
  })

  it('requires an authenticated principal for comment creation', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/comments', {
        method: 'POST',
        headers: { ...commentHeaders, 'content-type': 'application/json', 'Idempotency-Key': 'comment-1' },
        body: JSON.stringify({ body: '你好' }),
      }),
      {
        DB: dbFor([]),
      },
    )
    expect(response.status).toBe(401)
  })
})

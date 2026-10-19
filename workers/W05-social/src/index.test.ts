/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'


const dbFor = (results: unknown[] = []) => {
  let index = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => results[index++] ?? null),
      all: vi.fn(async () => ({ results })),
      run: vi.fn(async () => ({ sql, args, meta: { changes: 1 } })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

const request = (pathname: string, headers: Record<string, string> = {}) =>
  new Request(`https://luckread-w05.internal${pathname}`, { headers })

const requestWithMethod = (pathname: string, method: string, headers: Record<string, string> = {}) =>
  new Request(`https://luckread-w05.internal${pathname}`, { method, headers })

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'test-correlation',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

describe('W05 social query transport', () => {
  it('serves profile replies through a bounded public GET route', async () => {
    const response = await worker.fetch(
      request('/internal/social/users/user-1/replies?limit=6', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'profile-replies',
      }),
      { DB: dbFor([{
        id: 'reply-1', content_id: 'content-1', author_user_id: 'user-1', parent_id: 'comment-0',
        body: 'Reply body', state: 'PUBLISHED', depth: 1,
        created_at: '2026-10-15T10:00:00.000Z', updated_at: '2026-10-15T10:00:00.000Z',
      }]) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ id: 'reply-1', contentId: 'content-1', authorUserId: 'user-1' }], hasMore: false, nextCursor: null },
      requestId: expect.stringMatching(/^req_/),
    })
  })

  it('serves liked content identifiers through a bounded public GET route', async () => {
    const response = await worker.fetch(
      request('/internal/social/users/user-1/likes?limit=6', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'profile-likes',
      }),
      { DB: dbFor([{ relationship_id: 'like-1', target_id: 'content-1', created_at: '2026-10-15T10:00:00.000Z' }]) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ contentId: 'content-1', likedAt: '2026-10-15T10:00:00.000Z' }], hasMore: false, nextCursor: null },
    })
  })

  it('sets and reads reply audience policy through the authenticated W05 route', async () => {
    const savedPolicy = {
      content_id: 'content-1',
      owner_user_id: 'viewer-1',
      audience: 'following',
      mentioned_user_ids_json: '[]',
      updated_at: '2026-10-19T00:00:00.000Z',
    }
    const write = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/reply-audience', {
        method: 'PUT',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'reply-audience-write-1',
        },
        body: JSON.stringify({ replyAudience: 'following', mentionedUserIds: [] }),
      }),
      { DB: dbFor([
        { id: 'content-1', owner_user_id: 'viewer-1', content_type: 'post', state: 'DRAFT' },
        savedPolicy,
      ]) },
    )
    expect(write.status).toBe(200)
    await expect(write.json()).resolves.toMatchObject({
      data: { contentId: 'content-1', ownerUserId: 'viewer-1', replyAudience: 'following' },
    })

    const read = await worker.fetch(
      request('/internal/social/contents/content-1/reply-audience', transportHeaders),
      { DB: dbFor([savedPolicy]) },
    )
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({
      data: { contentId: 'content-1', ownerUserId: 'viewer-1', replyAudience: 'following' },
    })
  })

  it('rejects replies outside the configured audience on the W05 comment route', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/comments', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Verified': 'false',
          'content-type': 'application/json',
          'Idempotency-Key': 'reply-audience-denied-1',
        },
        body: JSON.stringify({ body: 'Restricted reply', parentId: null }),
      }),
      { DB: dbFor([{
        content_state: 'PUBLISHED',
        content_owner_user_id: 'owner-1',
        parent_content_id: null,
        parent_author_user_id: null,
        parent_state: null,
        parent_depth: null,
        recent_count: 0,
        blocked: 0,
        reply_audience_allowed: 0,
      }]) },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PERMISSION_DENIED' },
    })
  })

  it('requires internal transport and rejects writes to profile channel routes', async () => {
    const unauthorized = await worker.fetch(request('/internal/social/users/user-1/replies'), { DB: dbFor() })
    expect(unauthorized.status).toBe(403)

    const unsupported = await worker.fetch(new Request('https://luckread-w05.internal/internal/social/users/user-1/likes', {
      method: 'POST',
      headers: {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'profile-likes-write',
      },
    }), { DB: dbFor() })
    expect(unsupported.status).toBe(405)
  })
  it('lists the authenticated viewer block relations through the internal GET route', async () => {
    const response = await worker.fetch(
      request('/internal/social/interactions/blocks?limit=10', transportHeaders),
      { DB: dbFor([
        {
          relationship_id: 'block-1',
          actor_user_id: 'viewer-1',
          target_user_id: 'target-1',
          relation_type: 'block',
          created_at: '2026-10-18T00:00:00.000Z',
        },
      ]) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{ relationshipId: 'block-1', targetUserId: 'target-1', createdAt: '2026-10-18T00:00:00.000Z' }],
        nextCursor: null,
        hasMore: false,
      },
      requestId: expect.stringMatching(/^req_/),
    })
  })

  it('creates an idempotent block relation for an active actor and existing target', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/blocks', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'Idempotency-Key': 'block-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetUserId: 'target-1' }),
      }),
      {
        DB: dbFor([
          {
            relationship_id: 'block-1',
            actor_user_id: 'viewer-1',
            target_user_id: 'target-1',
            relation_type: 'block',
            created_at: '2026-10-02T00:00:00.000Z',
            updated_at: '2026-10-02T00:00:00.000Z',
          },
        ]),
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { relationshipId: 'block-1', relationType: 'block', targetUserId: 'target-1' },
    })
  })

  it('creates mute independently from block', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/mutes', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'Idempotency-Key': 'mute-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetUserId: 'target-1' }),
      }),
      {
        DB: dbFor([
          {
            relationship_id: 'mute-1',
            actor_user_id: 'viewer-1',
            target_user_id: 'target-1',
            relation_type: 'mute',
            created_at: '2026-10-02T00:00:00.000Z',
            updated_at: '2026-10-02T00:00:00.000Z',
          },
        ]),
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { relationshipId: 'mute-1', relationType: 'mute' },
    })
  })

  it('rejects self block and missing idempotency safely', async () => {
    const selfResponse = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/blocks', {
        method: 'POST',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'Idempotency-Key': 'block-self', 'content-type': 'application/json' },
        body: JSON.stringify({ targetUserId: 'viewer-1' }),
      }),
      { DB: dbFor() },
    )
    expect(selfResponse.status).toBe(409)

    const missingKey = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/mutes', {
        method: 'POST',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'content-type': 'application/json' },
        body: JSON.stringify({ targetUserId: 'target-1' }),
      }),
      { DB: dbFor() },
    )
    expect(missingKey.status).toBe(428)
  })

  it('returns a canonical conflict error and request ID for self-follow attempts', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/follows/viewer-1', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'self-follow-1',
        },
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CONFLICT', message: 'CONFLICT', details: {} },
      requestId: expect.stringMatching(/^req_[A-Za-z0-9_-]+$/),
    })
  })

  it('unblocks and unmutes with idempotent 204 responses', async () => {
    const unblock = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/blocks/target-1', {
        method: 'DELETE',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'Idempotency-Key': 'unblock-1' },
      }),
      { DB: dbFor() },
    )
    expect(unblock.status).toBe(204)

    const unmute = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/mutes/target-1', {
        method: 'DELETE',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'Idempotency-Key': 'unmute-1' },
      }),
      { DB: dbFor() },
    )
    expect(unmute.status).toBe(204)
  })

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


  it('lists the authenticated viewer favorite IDs with an opaque bounded cursor', async () => {
    const response = await worker.fetch(
      request('/internal/social/interactions/bookmarks/list?limit=1', transportHeaders),
      { DB: dbFor([
        { relationship_id: 'favorite-1', target_id: 'content-1', created_at: '2026-10-03T00:00:00.000Z' },
        { relationship_id: 'favorite-2', target_id: 'content-2', created_at: '2026-10-02T00:00:00.000Z' },
      ]) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{ targetId: 'content-1', createdAt: '2026-10-03T00:00:00.000Z' }],
        hasMore: true,
        nextCursor: expect.any(String),
      },
    })
  })

  it('requires an authenticated transport for favorite-list reads', async () => {
    const response = await worker.fetch(
      request('/internal/social/interactions/bookmarks/list?limit=20', {
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'missing-caller',
        'X-LuckRead-Principal-User-Id': 'viewer-1',
        'X-LuckRead-Principal-Layer': 'L2',
      }),
      { DB: dbFor([]) },
    )
    expect(response.status).toBe(403)
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
        headers: { ...transportHeaders, 'content-type': 'application/json', 'Idempotency-Key': 'like-1' },
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

  it('accepts a comment like through the shared interaction transport', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'POST',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'content-type': 'application/json', 'Idempotency-Key': 'comment-like-1' },
        body: JSON.stringify({ targetType: 'comment', targetId: 'comment-1' }),
      }),
      {
        DB: dbFor([
          { id: 'comment-1', state: 'PUBLISHED', author_user_id: 'author-1', content_owner_user_id: 'owner-1', blocked: 0 },
          {
            relationship_id: 'comment-like-1',
            actor_user_id: 'viewer-1',
            target_type: 'comment',
            target_id: 'comment-1',
            created_at: '2026-10-02T00:00:00.000Z',
          },
        ]),
      },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { relationshipId: 'comment-like-1', targetType: 'comment', targetId: 'comment-1' },
    })
  })

  it('reads comment like status through the shared interaction transport', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes?targetType=comment&targetId=comment-1', {
        method: 'GET',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2' },
      }),
      { DB: dbFor([{ liked: 1, like_count: 2 }]) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { liked: true, likeCount: 2 },
    })
  })

  it('unlikes with a 204 response', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'DELETE',
        headers: { ...transportHeaders, 'content-type': 'application/json', 'Idempotency-Key': 'like-delete-1' },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(204)
  })

  it('requires idempotency keys for like mutations', async () => {
    const post = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
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
    expect(post.status).toBe(428)

    const del = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      { DB: dbFor() },
    )
    expect(del.status).toBe(428)
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

  it('requires idempotency keys for follow mutations', async () => {
    const post = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/follows/target-1', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
        },
      }),
      { DB: dbFor() },
    )
    expect(post.status).toBe(428)

    const del = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/follows/target-1', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
        },
      }),
      { DB: dbFor() },
    )
    expect(del.status).toBe(428)
  })

  it('denies follow mutations below the minimum interaction permission layer', async () => {
    const post = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/follows/target-1', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L1',
          'Idempotency-Key': 'follow-low-layer',
        },
      }),
      { DB: dbFor() },
    )
    expect(post.status).toBe(403)

    const del = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/follows/target-1', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L1',
          'Idempotency-Key': 'unfollow-low-layer',
        },
      }),
      { DB: dbFor() },
    )
    expect(del.status).toBe(403)
  })

  it('serves follow status and relationship from one relationship authority', async () => {
    const response = await worker.fetch(
      request('/internal/social/follows/target-1', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L2',
      }),
      {
        DB: dbFor([{
          following: 1,
          followed_by: 1,
          relationship_id: 'follow-1',
          created_at: '2026-10-02T00:00:00.000Z',
          blocked: 0,
          blocked_by: 0,
          muted: 0,
        }]),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        following: true,
        relationshipId: 'follow-1',
        targetUserId: 'target-1',
        createdAt: '2026-10-02T00:00:00.000Z',
        relationship: {
          following: true,
          followedBy: true,
          mutualFollow: true,
          blocked: false,
          blockedBy: false,
          muted: false,
          relationshipId: 'follow-1',
          createdAt: '2026-10-02T00:00:00.000Z',
        },
      },
    })
  })

  it('denies follow status below the minimum interaction permission layer', async () => {
    const response = await worker.fetch(
      request('/internal/social/follows/target-1', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L1',
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
        },
        {
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
        },
        {
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

  it('updates an owned comment with a conditional version', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/comments/comment-1', {
        method: 'PATCH',
        headers: {
          ...commentHeaders,
          'X-LuckRead-Principal-User-Id': 'viewer-1',
          'X-LuckRead-Principal-Layer': 'L2',
          'If-Match': '"2026-10-02T00:01:00.000Z"',
          'Idempotency-Key': 'comment-update-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ body: '修改后的评论' }),
      }),
      {
        DB: dbFor([
          {
            id: 'comment-1',
            content_id: 'content-1',
            author_user_id: 'viewer-1',
            parent_id: null,
            body: '原评论',
            state: 'PUBLISHED',
            depth: 0,
            created_at: '2026-10-02T00:00:00.000Z',
            updated_at: '2026-10-02T00:01:00.000Z',
            content_state: 'PUBLISHED',
          },
          {
            id: 'comment-1',
            content_id: 'content-1',
            author_user_id: 'viewer-1',
            parent_id: null,
            body: '修改后的评论',
            state: 'PUBLISHED',
            depth: 0,
            created_at: '2026-10-02T00:00:00.000Z',
            updated_at: '2026-10-02T00:02:00.000Z',
          },
        ]),
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"2026-10-02T00:02:00.000Z"')
    expect(response.headers.get('X-LuckRead-Content-Id')).toBe('content-1')
  })

  it('requires If-Match for comment updates', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/comments/comment-1', {
        method: 'PATCH',
        headers: {
          ...commentHeaders,
          'X-LuckRead-Principal-User-Id': 'viewer-1',
          'X-LuckRead-Principal-Layer': 'L2',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ body: '没有版本的修改' }),
      }),
      { DB: dbFor([]) },
    )
    expect(response.status).toBe(428)
  })

  it('deletes an owned leaf comment through the internal transport', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/comments/comment-1', {
        method: 'DELETE',
        headers: {
          ...commentHeaders,
          'X-LuckRead-Principal-User-Id': 'viewer-1',
          'X-LuckRead-Principal-Layer': 'L2',
          'Idempotency-Key': 'comment-delete-1',
        },
      }),
      {
        DB: dbFor([
          { id: 'comment-1', content_id: 'content-1', author_user_id: 'viewer-1', state: 'PUBLISHED', has_replies: 0 },
        ]),
      },
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('X-LuckRead-Content-Id')).toBe('content-1')
  })

  it('requires an idempotency key for comment deletion', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/comments/comment-1', {
        method: 'DELETE',
        headers: {
          ...commentHeaders,
          'X-LuckRead-Principal-User-Id': 'viewer-1',
          'X-LuckRead-Principal-Layer': 'L2',
        },
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(428)
  })

  it('rejects unsupported comment item transport', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/comments/comment-1', {
        method: 'GET',
        headers: {
          ...commentHeaders,
          'X-LuckRead-Principal-User-Id': 'viewer-1',
          'X-LuckRead-Principal-Layer': 'L2',
          'Idempotency-Key': 'comment-unsupported-1',
        },
      }),
      { DB: dbFor([]) },
    )
    expect(response.status).toBe(405)
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
  it('rejects unauthenticated repost and profile pin writes before touching D1', async () => {
    const unauthenticatedHeaders = {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'unauthenticated-write',
      'X-LuckRead-Principal-Layer': 'L2',
      'Idempotency-Key': 'unauthenticated-write-1',
    }
    const repostDb = dbFor()
    const repostResponse = await worker.fetch(
      requestWithMethod('/internal/social/content/content-1/reposts', 'POST', unauthenticatedHeaders),
      { DB: repostDb },
    )
    expect(repostResponse.status).toBe(401)
    expect((repostDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()

    const pinDb = dbFor()
    const pinResponse = await worker.fetch(
      requestWithMethod('/internal/social/content/content-1/pin', 'POST', unauthenticatedHeaders),
      { DB: pinDb },
    )
    expect(pinResponse.status).toBe(401)
    expect((pinDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('creates a repost relation through the authenticated W01 principal', async () => {
    const response = await worker.fetch(
      requestWithMethod('/internal/social/content/content-1/reposts', 'POST', {
        ...transportHeaders,
        'Idempotency-Key': 'repost-1',
      }),
      { DB: dbFor([
        { id: 'content-1', state: 'PUBLISHED', owner_user_id: 'owner-1', blocked: 0 },
        null,
        { repost_id: 'repost-1', content_id: 'content-1', actor_user_id: 'viewer-1', created_at: '2026-10-16T00:00:00.000Z' },
      ]) },
    )
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      data: { repostId: 'repost-1', contentId: 'content-1', actorUserId: 'viewer-1' },
    })
  })

  it('requires the minimum interaction layer and idempotency key for reposts', async () => {
    const denied = await worker.fetch(
      requestWithMethod('/internal/social/content/content-1/reposts', 'POST', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L1',
        'Idempotency-Key': 'repost-denied',
      }),
      { DB: dbFor() },
    )
    expect(denied.status).toBe(403)

    const missingKey = await worker.fetch(
      requestWithMethod('/internal/social/content/content-1/reposts', 'POST', transportHeaders),
      { DB: dbFor([{ id: 'content-1', state: 'PUBLISHED', owner_user_id: 'owner-1', blocked: 0 }]) },
    )
    expect(missingKey.status).toBe(428)
  })

  it('pins only the authenticated owner content and unpins idempotently', async () => {
    const pinResponse = await worker.fetch(
      requestWithMethod('/internal/social/content/content-1/pin', 'POST', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L2',
        'Idempotency-Key': 'pin-1',
      }),
      { DB: dbFor([
        { id: 'content-1', content_type: 'post', state: 'PUBLISHED', owner_user_id: 'viewer-1' },
        { user_id: 'viewer-1', content_id: 'content-1', pinned_at: '2026-10-16T00:00:00.000Z' },
      ]) },
    )
    expect(pinResponse.status).toBe(200)
    await expect(pinResponse.json()).resolves.toMatchObject({
      data: { userId: 'viewer-1', contentId: 'content-1' },
    })

    const unpinResponse = await worker.fetch(
      requestWithMethod('/internal/social/content/content-1/pin', 'DELETE', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L2',
        'Idempotency-Key': 'unpin-1',
      }),
      { DB: dbFor() },
    )
    expect(unpinResponse.status).toBe(204)
  })

  it('rejects profile pin writes from below L2', async () => {
    const response = await worker.fetch(
      requestWithMethod('/internal/social/content/content-1/pin', 'POST', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L1',
        'Idempotency-Key': 'pin-denied',
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(403)
  })

  it('returns the public pinned-content reference without requiring a viewer', async () => {
    const response = await worker.fetch(
      request('/internal/social/users/owner-1/pinned-content', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'public-pin',
      }),
      { DB: dbFor([{ user_id: 'owner-1', content_id: 'content-1', pinned_at: '2026-10-16T00:00:00.000Z' }]) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { userId: 'owner-1', contentId: 'content-1' },
    })
  })

})

describe('W05 social poll transport', () => {
  it('rejects unauthenticated poll writes before touching D1', async () => {
    const headers = {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'poll-unauthenticated',
      'X-LuckRead-Principal-Layer': 'L2',
      'Idempotency-Key': 'poll-unauthenticated-1',
      'content-type': 'application/json',
    }
    const d1 = dbFor()
    const configure = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll', {
        method: 'POST', headers, body: JSON.stringify({ options: ['Yes', 'No'], durationHours: 24 }),
      }),
      { DB: d1 },
    )
    const vote = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll/votes', {
        method: 'POST', headers, body: JSON.stringify({ optionId: 'option-1' }),
      }),
      { DB: d1 },
    )
    expect(configure.status).toBe(401)
    expect(vote.status).toBe(401)
    expect((d1 as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('validates poll options before issuing database reads', async () => {
    const d1 = dbFor()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json', 'Idempotency-Key': 'poll-invalid-1' },
        body: JSON.stringify({ options: ['Same', ' same '], durationHours: 24 }),
      }),
      { DB: d1 },
    )
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } })
    expect((d1 as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('requires the canonical interaction layer and idempotency key before poll mutations', async () => {
    const missingLayer = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll/votes', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L1',
          'Idempotency-Key': 'poll-layer-denied',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ optionId: 'option-1' }),
      }),
      { DB: dbFor() },
    )
    expect(missingLayer.status).toBe(403)

    const missingKey = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll/votes', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ optionId: 'option-1' }),
      }),
      { DB: dbFor() },
    )
    expect(missingKey.status).toBe(428)
  })
})


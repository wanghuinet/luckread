/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'

import worker, { createW05SocialWorker } from './index.js'
import type { CommentListReadInput, CommentListReadRow, CommentListReadStore } from './comment-list-read-store.js'
import type { FollowListReadInput, FollowListReadRow, FollowListCountInput, FollowListReadStore } from './follow-list-read-store.js'
import type { FollowMutation, FollowRow, FollowStore } from './follow-store.js'
import type { RelationshipGraphReadRow, RelationshipGraphReadStore } from './relationship-graph-store.js'
import type { BlockMuteListReadInput, BlockMuteListReadRow, BlockMuteListReadStore } from './block-mute-list-read-store.js'
import type { BlockMuteRelationRow, BlockMuteRelationStore } from './block-mute-relation-store.js'
import type { ProfileChannelReadStore } from './profile-channel-read-store.js'
import type { FollowingAuthorIdRow, FollowingAuthorIdsReadStore } from './following-author-ids-read-store.js'
import type { ContentLikerReadInput, ContentLikerReadRow, ContentLikerReadStore } from './like-list-read-store.js'
import type { FavoriteListReadInput, FavoriteListReadRow, FavoriteListReadStore } from './favorite-list-read-store.js'
import type { FavoriteStatusReadStore } from './favorite-status-read-store.js'
import type { FavoriteMutationStore } from './favorite-mutation-store.js'
import type { LikeStatusReadInput, LikeStatusReadResult, LikeStatusReadStore } from './like-status-read-store.js'
import type { LikeTargetContextReadStore } from './like-target-context-read-store.js'
import type { RepostStore } from './repost-store.js'
import type { ShareStore } from './share-store.js'
import type { ProfilePinStore } from './profile-pin-store.js'
import type { SocialTokenSyncStore } from './social-token-sync-store.js'


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

const publishedContextsBatchBinding = () => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const body = await request.clone().json() as { contentIds: string[] }
    return Response.json({ data: { items: body.contentIds.map(contentId => ({
      contentId, ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED',
      title: 'Title ' + contentId,
      updatedAt: '2026-10-17T04:00:00.000Z',
    })) } })
  }),
})

const publishedContextBinding = () => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const parts = new URL(request.url).pathname.split('/').filter(Boolean)
    const contentId = decodeURIComponent(parts.at(-2) ?? '')
    return Response.json({
      data: { contentId, ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z' },
    })
  }),
})

describe('W05 follow-list PostgreSQL runtime injection', () => {
  it('uses an injected follow-list store for both HTTP routes without touching D1', async () => {
    const store: FollowListReadStore = {
      list: vi.fn(async (input: FollowListReadInput): Promise<readonly FollowListReadRow[]> => [{
        relationship_id: input.direction === 'followers' ? 'rel-follower' : 'rel-following',
        user_id: input.direction === 'followers' ? 'follower-user' : 'followed-user',
        followed_at: '2026-11-11T08:00:00.000Z',
        cursor_created_at: '2026-11-11T08:00:00.000000Z',
      }]),
      count: vi.fn(async (_input: FollowListCountInput) => 1),
    }
    const d1Prepare = vi.fn()
    const injectedWorker = createW05SocialWorker({ followListReadStore: store })
    const env = { DB: { prepare: d1Prepare } } as never

    const followers = await injectedWorker.fetch(
      request('/internal/social/users/target-user/followers', transportHeaders),
      env,
      {} as never,
    )
    const following = await injectedWorker.fetch(
      request('/internal/social/users/owner-user/following', transportHeaders),
      env,
      {} as never,
    )

    expect(followers.status).toBe(200)
    await expect(followers.json()).resolves.toMatchObject({
      data: { items: [{ relationshipId: 'rel-follower', userId: 'follower-user' }], totalCount: 1 },
    })
    expect(following.status).toBe(200)
    await expect(following.json()).resolves.toMatchObject({
      data: { items: [{ relationshipId: 'rel-following', userId: 'followed-user' }], totalCount: 1 },
    })
    expect(store.list).toHaveBeenNthCalledWith(1, {
      userId: 'target-user', direction: 'followers', cursor: null, limit: 20,
    })
    expect(store.list).toHaveBeenNthCalledWith(2, {
      userId: 'owner-user', direction: 'following', cursor: null, limit: 20,
    })
  })

  it('fails closed without the Neon follow-list Store and never touches D1', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be used') })
    const response = await worker.fetch(
      request('/internal/social/users/target-user/followers', transportHeaders),
      { DB: { prepare } as unknown as D1Database },
      {} as never,
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(prepare).not.toHaveBeenCalled()
  })
})


describe('W05 Follow/Unfollow PostgreSQL runtime injection', () => {
  it('routes Follow and Unfollow writes through the injected store while keeping notification persistence on D1', async () => {
    const row: FollowRow = {
      relationship_id: 'pg-follow-1',
      follower_user_id: 'viewer-1',
      target_user_id: 'target-1',
      created_at: '2026-11-12T00:00:00.000Z',
    }
    const store: FollowStore = {
      follow: vi.fn(async (_input: FollowMutation) => row),
      unfollow: vi.fn(async (_followerUserId: string, _targetUserId: string) => {}),
    }
    const d1Sql: string[] = []
    const d1Prepare = vi.fn((sql: string) => {
      d1Sql.push(sql)
      return {
        bind: vi.fn(() => ({
          first: vi.fn(async () => null),
          run: vi.fn(async () => ({ meta: { changes: 1 } })),
        })),
      }
    })
    const injectedWorker = createW05SocialWorker({ followStore: store })
    const env = { DB: { prepare: d1Prepare } as unknown as D1Database }

    const post = await injectedWorker.fetch(
      requestWithMethod('/internal/social/follows/target-1', 'POST', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L2',
        'Idempotency-Key': 'pg-follow-1',
      }),
      env,
      {} as never,
    )
    expect(post.status).toBe(201)
    await expect(post.json()).resolves.toMatchObject({
      data: {
        following: true,
        relationshipId: 'pg-follow-1',
        targetUserId: 'target-1',
      },
    })
    expect(store.follow).toHaveBeenCalledWith(expect.objectContaining({
      followerUserId: 'viewer-1',
      targetUserId: 'target-1',
    }))
    expect(d1Sql.some((sql) => sql.includes('social_follow_relationships'))).toBe(false)
    expect(d1Sql.some((sql) => sql.includes('social_notifications'))).toBe(true)

    const callsBeforeUnfollow = d1Prepare.mock.calls.length
    const del = await injectedWorker.fetch(
      requestWithMethod('/internal/social/follows/target-1', 'DELETE', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L2',
        'Idempotency-Key': 'pg-unfollow-1',
      }),
      env,
      {} as never,
    )
    expect(del.status).toBe(204)
    expect(store.unfollow).toHaveBeenCalledWith('viewer-1', 'target-1')
    expect(d1Prepare).toHaveBeenCalledTimes(callsBeforeUnfollow)
  })

  it('fails closed for Follow and Unfollow without the Neon Store and never touches D1', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be used for Follow/Unfollow') })
    const env = { DB: { prepare } as unknown as D1Database }
    const post = await worker.fetch(
      requestWithMethod('/internal/social/follows/target-1', 'POST', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L2',
        'Idempotency-Key': 'missing-store-follow',
      }),
      env,
      {} as never,
    )
    const del = await worker.fetch(
      requestWithMethod('/internal/social/follows/target-1', 'DELETE', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L2',
        'Idempotency-Key': 'missing-store-unfollow',
      }),
      env,
      {} as never,
    )
    expect(post.status).toBe(503)
    expect(del.status).toBe(503)
    await expect(post.json()).resolves.toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(prepare).not.toHaveBeenCalled()
  })
})


describe('W05 following-feed author PostgreSQL runtime injection', () => {
  const followingFeedHeaders = {
    'X-LuckRead-Caller': 'W04',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': 'following-feed-test',
    'X-LuckRead-Principal-User-Id': 'viewer-1',
  }

  it('uses an injected PostgreSQL-capable author store through the W04 HTTP route without touching D1', async () => {
    const store: FollowingAuthorIdsReadStore = {
      list: vi.fn(async (_viewerUserId: string, _limit: number): Promise<readonly FollowingAuthorIdRow[]> => [
        { user_id: 'postgres-author-1' },
        { user_id: 'postgres-author-2' },
      ]),
    }
    const d1Prepare = vi.fn()
    const injectedWorker = createW05SocialWorker({ followingAuthorIdsReadStore: store })
    const response = await injectedWorker.fetch(
      request('/internal/social/feed/following-authors', followingFeedHeaders),
      { DB: { prepare: d1Prepare } } as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{ userId: 'postgres-author-1' }, { userId: 'postgres-author-2' }],
        candidateWindowTruncated: false,
      },
    })
    expect(store.list).toHaveBeenCalledWith('viewer-1', 501)
  })

  it('fails closed before touching D1 when the Following-feed author Store is missing', async () => {
    const d1Prepare = vi.fn(() => { throw new Error('D1 must not be used') })
    const response = await worker.fetch(
      request('/internal/social/feed/following-authors', followingFeedHeaders),
      { DB: { prepare: d1Prepare } } as never,
      {} as never,
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(d1Prepare).not.toHaveBeenCalled()
  })
})


describe('W05 profile-channel PostgreSQL runtime injection', () => {
  it('uses the injected profile-channel store for replies and likes without touching D1', async () => {
    const store: ProfileChannelReadStore = {
      profileVisibility: vi.fn(async () => ({ blocked: false, muted: false })),
      listReplies: vi.fn(async () => [{
        id: 'reply-pg-1',
        content_id: 'content-reply-pg',
        author_user_id: 'profile-user',
        parent_id: null,
        body: 'PostgreSQL profile reply',
        state: 'PUBLISHED' as const,
        depth: 0,
        created_at: '2026-11-11T08:00:00.000000Z',
        updated_at: '2026-11-11T08:00:00.000000Z',
      }]),
      listReplyOwnerBlockRelations: vi.fn(async () => []),
      listLikedContents: vi.fn(async () => [{
        relationship_id: 'like-pg-1',
        target_id: 'content-liked-pg',
        created_at: '2026-11-11T07:00:00.000000Z',
      }]),
      listLikedContentBlockRelations: vi.fn(async () => []),
      listMutedOwners: vi.fn(async () => []),
    }
    const d1Prepare = vi.fn()
    const injectedWorker = createW05SocialWorker({ profileChannelReadStore: store })
    const env = {
      DB: { prepare: d1Prepare },
      W03_CONTENT: publishedContextsBatchBinding(),
    } as never

    const replies = await injectedWorker.fetch(
      request('/internal/social/users/profile-user/replies?limit=6', transportHeaders),
      env,
      {} as never,
    )
    const likes = await injectedWorker.fetch(
      request('/internal/social/users/profile-user/likes?limit=6', transportHeaders),
      env,
      {} as never,
    )

    expect(replies.status).toBe(200)
    await expect(replies.json()).resolves.toMatchObject({
      data: { items: [{ id: 'reply-pg-1', contentId: 'content-reply-pg' }], hasMore: false, nextCursor: null },
    })
    expect(likes.status).toBe(200)
    await expect(likes.json()).resolves.toMatchObject({
      data: { items: [{ contentId: 'content-liked-pg' }], hasMore: false, nextCursor: null },
    })
    expect(store.profileVisibility).toHaveBeenCalledWith({
      profileUserId: 'profile-user',
      viewerUserId: 'viewer-1',
    })
    expect(store.listReplies).toHaveBeenCalledWith({
      profileUserId: 'profile-user',
      cursor: null,
      limit: 7,
    })
    expect(store.listLikedContents).toHaveBeenCalledWith({
      profileUserId: 'profile-user',
      viewerUserId: 'viewer-1',
      cursor: null,
      limit: 7,
    })
    expect(store.listReplyOwnerBlockRelations).toHaveBeenCalledWith({
      profileUserId: 'profile-user',
      ownerUserIds: ['owner-1'],
    })
    expect(store.listLikedContentBlockRelations).toHaveBeenCalledWith({
      principalUserIds: ['profile-user', 'viewer-1'],
      ownerUserIds: ['owner-1'],
    })
    expect(store.listMutedOwners).toHaveBeenCalledWith({
      viewerUserId: 'viewer-1',
      ownerUserIds: ['owner-1'],
    })
    expect(d1Prepare).not.toHaveBeenCalled()
    expect(d1Prepare).not.toHaveBeenCalled()
  })

  it('fails closed for profile replies and likes when PostgreSQL Store is missing', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be used for profile channel reads') })
    const binding = publishedContextsBatchBinding()
    const env = { DB: { prepare }, W03_CONTENT: binding } as never
    const replies = await worker.fetch(request('/internal/social/users/profile-user/replies?limit=6', transportHeaders), env, {} as never)
    const likes = await worker.fetch(request('/internal/social/users/profile-user/likes?limit=6', transportHeaders), env, {} as never)
    expect(replies.status).toBe(503)
    expect(likes.status).toBe(503)
    expect(binding.fetch).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })
})

describe('W05 topic page transport', () => {
  it('loads topic IDs from W05 and resolves published cards through the bounded W03 batch', async () => {
    const queries: string[] = []
    const candidateRows = [
      { target_id: 'content-1', created_at: '2026-10-20T00:00:00.000Z' },
      { target_id: 'content-2', created_at: '2026-10-19T00:00:00.000Z' },
    ]
    const d = {
      prepare: vi.fn((sql: string) => {
        queries.push(sql)
        return {
          bind: vi.fn(() => ({
            first: async () => ({
              topic_id: 'topic-reading', normalized_name: 'reading', display_name: 'Reading', status: 'ACTIVE',
            }),
            all: async () => ({ results: candidateRows }),
          })),
        }
      }),
    } as unknown as D1Database
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const forwarded = input instanceof Request ? input : new Request(input, init)
        const body = await forwarded.clone().json() as { contentIds: string[] }
        return Response.json({ data: { items: body.contentIds.filter(id => id === 'content-1').map(contentId => ({
          contentId, ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED',
          title: 'Title from W03', updatedAt: '2026-10-17T04:00:00.000Z',
        })) } })
      }),
    }
    const response = await worker.fetch(
      request('/internal/social/topics/reading?limit=2', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'topic-page-read',
      }),
      { DB: d, W03_CONTENT: binding },
    )

    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/published-social-context-batch')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.get('X-LuckRead-Correlation-Id')).toBe('topic-page-read')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    await expect(forwarded.json()).resolves.toEqual({ contentIds: ['content-1', 'content-2'] })
    expect(queries.every(sql => !/\b(?:FROM|JOIN)\s+contents\b/i.test(sql))).toBe(true)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        topic: { topicId: 'topic-reading', name: 'reading', displayName: 'Reading', status: 'ACTIVE' },
        contents: [
          { id: 'content-1', contentType: 'post', title: 'Title from W03', updatedAt: '2026-10-17T04:00:00.000Z' },
        ],
        hasMore: false,
        nextCursor: null,
      },
    })
  })

  it('fails closed if W03 batch context is unavailable for a public topic page', async () => {
    const d = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: async () => ({ topic_id: 'topic-reading', normalized_name: 'reading', display_name: 'Reading', status: 'ACTIVE' }),
          all: async () => ({ results: [{ target_id: 'content-1', created_at: '2026-10-20T00:00:00.000Z' }] }),
        })),
      })),
    } as unknown as D1Database
    const response = await worker.fetch(
      request('/internal/social/topics/reading?limit=2', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'topic-page-no-w03',
      }),
      { DB: d },
    )
    expect(response.status).toBe(503)
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).toHaveBeenCalledTimes(2)
  })
})

describe('W05 social query transport', () => {
  it('reads content topics and mentions only after W03 confirms the target is published', async () => {
    const binding = publishedContextBinding()
    const d = dbFor()
    const response = await worker.fetch(
      request('/internal/social/contents/content-1/tokens', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'content-token-read',
      }),
      { DB: d, W03_CONTENT: binding },
    )
    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('X-LuckRead-Principal-User-Id')).toBe(false)
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(prepare.mock.calls.some(([sql]) => /(?:FROM|JOIN)\s+contents/i.test(String(sql)))).toBe(false)
    await expect(response.json()).resolves.toMatchObject({
      data: { topics: [], mentions: [] },
    })
  })

  it('fails closed before W05 D1 when W03 context is missing or content is unpublished', async () => {
    const unavailableDb = dbFor()
    const noBinding = await worker.fetch(
      request('/internal/social/contents/content-1/tokens', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'content-token-read-no-binding',
      }),
      { DB: unavailableDb },
    )
    expect(noBinding.status).toBe(503)
    expect((unavailableDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()

    const unpublishedDb = dbFor()
    const unpublishedBinding = {
      fetch: vi.fn(async () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })),
    }
    const unpublished = await worker.fetch(
      request('/internal/social/contents/content-1/tokens', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'content-token-read-unpublished',
      }),
      { DB: unpublishedDb, W03_CONTENT: unpublishedBinding },
    )
    expect(unpublished.status).toBe(404)
    expect((unpublishedDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('synchronizes content topics and mentions only after W03 validates published ownership through an injected Neon Store', async () => {
    const binding = { fetch: vi.fn(async () => Response.json({ data: { contentId: 'content-1', ownerUserId: 'viewer-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z' } })) }
    const store: SocialTokenSyncStore = {
      getCommentContext: vi.fn(async () => null),
      listMentions: vi.fn(async () => []),
      replaceTargetRelations: vi.fn(async () => undefined),
      upsertTopicAndAttach: vi.fn(async () => undefined),
      insertMention: vi.fn(async () => undefined),
    }
    const prepare = vi.fn(() => { throw new Error('D1 must not be used for Social Token Sync') })
    const neonWorker = createW05SocialWorker({ socialTokenSyncStore: store })
    const response = await neonWorker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/tokens', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'plain text', mentions: [] }),
      }),
      { DB: { prepare }, W03_CONTENT: binding } as never,
      {} as never,
    )
    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    expect(store.listMentions).toHaveBeenCalledWith('content', 'content-1')
    expect(store.replaceTargetRelations).toHaveBeenCalledWith({ targetType: 'content', targetId: 'content-1', retainedMentionIds: [] })
    expect(store.upsertTopicAndAttach).not.toHaveBeenCalled()
    expect(store.insertMention).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ data: { topics: 0, mentions: 0 } })
  })

  it('fails closed before token Store access when W03 context is missing', async () => {
    const store: SocialTokenSyncStore = {
      getCommentContext: vi.fn(async () => null),
      listMentions: vi.fn(async () => []),
      replaceTargetRelations: vi.fn(async () => undefined),
      upsertTopicAndAttach: vi.fn(async () => undefined),
      insertMention: vi.fn(async () => undefined),
    }
    const prepare = vi.fn(() => { throw new Error('D1 must not be used for Social Token Sync') })
    const neonWorker = createW05SocialWorker({ socialTokenSyncStore: store })
    const response = await neonWorker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/tokens', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'plain text', mentions: [] }),
      }),
      { DB: { prepare } } as never,
      {} as never,
    )
    expect(response.status).toBe(503)
    expect(store.listMentions).not.toHaveBeenCalled()
    expect(store.replaceTargetRelations).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails closed when the Social Token Sync Store is not composed', async () => {
    const binding = { fetch: vi.fn(async () => Response.json({ data: { contentId: 'content-1', ownerUserId: 'viewer-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z' } })) }
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/tokens', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'plain text', mentions: [] }),
      }),
      { W03_CONTENT: binding } as never,
      {} as never,
    )
    expect(response.status).toBe(503)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
  })

  it('gets content social summary through W03 and keeps canonical-content reads out of W05', async () => {
    const binding = publishedContextBinding()
    const d = dbFor()
    const response = await worker.fetch(
      request('/internal/social/contents/content-1/summary', transportHeaders),
      { DB: d, W03_CONTENT: binding },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare.mock.calls.some(([sql]) => String(sql).includes('FROM social_reposts WHERE content_id = ?'))).toBe(true)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(prepare.mock.calls.some(([sql]) => /(?:FROM|JOIN)\s+contents/i.test(String(sql)))).toBe(false)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        contentId: 'content-1',
        contentType: 'post',
        counts: { likes: 0, comments: 0, favorites: 0, shares: 0, reposts: 0 },
        pinned: false,
      },
    })
  })

  it('fails closed for social summary when W03 content context is unavailable', async () => {
    const d = dbFor()
    const response = await worker.fetch(
      request('/internal/social/contents/content-1/summary', transportHeaders),
      { DB: d },
    )
    expect(response.status).toBe(503)
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('serves profile replies through W03 batch visibility context without direct canonical reads', async () => {
    const binding = publishedContextsBatchBinding()
    const d = dbFor([{
      id: 'reply-1', content_id: 'content-1', author_user_id: 'user-1', parent_id: 'comment-0',
      body: 'Reply body', state: 'PUBLISHED', depth: 1,
      created_at: '2026-10-15T10:00:00.000Z', updated_at: '2026-10-15T10:00:00.000Z',
    }])
    const response = await worker.fetch(
      request('/internal/social/users/user-1/replies?limit=6', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'profile-replies',
      }),
      { DB: d, W03_CONTENT: binding },
    )
    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/published-social-context-batch')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    await expect(forwarded.json()).resolves.toEqual({ contentIds: ['content-1'] })
    const queries = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare.mock.calls.map(([sql]) => String(sql))
    expect(queries.every(sql => !sql.toLowerCase().includes('join contents') && !sql.toLowerCase().includes('from contents'))).toBe(true)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ id: 'reply-1', contentId: 'content-1', authorUserId: 'user-1' }], hasMore: false, nextCursor: null },
      requestId: expect.stringMatching(/^req_/),
    })
  })

  it('serves liked content identifiers through W03 batch visibility context without direct canonical reads', async () => {
    const binding = publishedContextsBatchBinding()
    const d = dbFor([{ relationship_id: 'like-1', target_id: 'content-1', created_at: '2026-10-15T10:00:00.000Z' }])
    const response = await worker.fetch(
      request('/internal/social/users/user-1/likes?limit=6', {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'profile-likes',
      }),
      { DB: d, W03_CONTENT: binding },
    )
    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/published-social-context-batch')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    const queries = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare.mock.calls.map(([sql]) => String(sql))
    expect(queries.every(sql => !sql.toLowerCase().includes('join contents') && !sql.toLowerCase().includes('from contents'))).toBe(true)
    await expect(forwarded.json()).resolves.toEqual({ contentIds: ['content-1'] })
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ contentId: 'content-1', likedAt: '2026-10-15T10:00:00.000Z' }], hasMore: false, nextCursor: null },
    })
  })

  it('uses the injected PostgreSQL-capable content-liker store without touching D1', async () => {
    const binding = publishedContextBinding()
    const store: ContentLikerReadStore = {
      list: vi.fn(async (_input: ContentLikerReadInput): Promise<readonly ContentLikerReadRow[]> => [{
        relationship_id: 'pg-like-1',
        actor_user_id: 'pg-liker-1',
        created_at: '2026-11-11T09:00:00.000Z',
      }]),
    }
    const d1Prepare = vi.fn()
    const injectedWorker = createW05SocialWorker({ contentLikerReadStore: store })
    const response = await injectedWorker.fetch(
      request('/internal/social/content/content-1/likes?limit=6', transportHeaders),
      { DB: { prepare: d1Prepare }, W03_CONTENT: binding } as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(store.list).toHaveBeenCalledWith({
      contentId: 'content-1',
      contentOwnerUserId: 'owner-1',
      viewerUserId: 'viewer-1',
      cursor: null,
      limit: 7,
    })
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{ userId: 'pg-liker-1', likedAt: '2026-11-11T09:00:00.000Z' }],
        hasMore: false,
        nextCursor: null,
      },
    })
    expect(d1Prepare).not.toHaveBeenCalled()
  })

  it('fails closed when the PostgreSQL content-liker Store is not injected', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be used for content liker reads') })
    const binding = publishedContextBinding()
    const response = await worker.fetch(
      request('/internal/social/content/content-1/likes?limit=6', transportHeaders),
      { DB: { prepare } as unknown as D1Database, W03_CONTENT: binding },
    )
    expect(response.status).toBe(503)
    expect(binding.fetch).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('allows only GET on the content likers endpoint', async () => {
    const response = await worker.fetch(
      requestWithMethod('/internal/social/content/content-1/likes', 'POST', transportHeaders),
      { DB: dbFor() },
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })

  it('sets and reads reply audience policy through the authenticated W05 route', async () => {
    const savedPolicy = {
      id: 'content-1',
      content_id: 'content-1',
      owner_user_id: 'viewer-1',
      content_type: 'post',
      audience: 'following',
      mentioned_user_ids_json: '[]',
      updated_at: '2026-10-19T00:00:00.000Z',
    }
    const contextBinding = {
      fetch: vi.fn(async () => Response.json({
        data: {
          contentId: 'content-1',
          ownerUserId: 'viewer-1',
          contentType: 'post',
          state: 'DRAFT',
          updatedAt: '2026-10-19T00:00:00.000Z',
        },
        requestId: 'req_context',
      })),
    }
    const writeDb = dbFor([savedPolicy])
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
      { DB: writeDb, W03_CONTENT: contextBinding },
    )
    expect(contextBinding.fetch).toHaveBeenCalledTimes(1)
    expect(writeDb.prepare).toHaveBeenCalledTimes(1)
    const writeBody = await write.clone().json()
    expect(write.status, JSON.stringify(writeBody)).toBe(200)
    await expect(write.json()).resolves.toMatchObject({
      data: { contentId: 'content-1', ownerUserId: 'viewer-1', replyAudience: 'following' },
    })

    const readContextBinding = {
      fetch: vi.fn(async () => Response.json({
        data: {
          contentId: 'content-1',
          ownerUserId: 'viewer-1',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-10-19T00:00:00.000Z',
        },
        requestId: 'req_context',
      })),
    }
    const read = await worker.fetch(
      request('/internal/social/contents/content-1/reply-audience', transportHeaders),
      { DB: dbFor([savedPolicy]), W03_CONTENT: readContextBinding },
    )
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({
      data: { contentId: 'content-1', ownerUserId: 'viewer-1', replyAudience: 'following' },
    })
  })

  it('fails closed on reply-audience PUT when W03 context binding is missing', async () => {
    const d = dbFor([])
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/reply-audience', {
        method: 'PUT',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'reply-audience-no-binding',
        },
        body: JSON.stringify({ replyAudience: 'following', mentionedUserIds: [] }),
      }),
      { DB: d },
    )
    expect(response.status).toBe(503)
    expect(d.prepare).not.toHaveBeenCalled()
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
  it('fails closed when Block/Mute list Store composition is missing', async () => {
    const response = await worker.fetch(request('/internal/social/interactions/blocks?limit=10', transportHeaders), {} as never)
    expect(response.status).toBe(503)
  })

  it('uses an injected Block/Mute list read store for both GET routes without touching D1', async () => {
    const store: BlockMuteListReadStore = {
      list: vi.fn(async (input: BlockMuteListReadInput): Promise<readonly BlockMuteListReadRow[]> => [{
        relationship_id: input.relationType === 'block' ? 'block-pg-1' : 'mute-pg-1',
        target_user_id: input.relationType === 'block' ? 'blocked-pg-user' : 'muted-pg-user',
        created_at: '2026-10-18T00:00:00.000Z',
        cursor_created_at: '2026-10-18T00:00:00.000000Z',
      }]),
    }
    const injectedWorker = createW05SocialWorker({ blockMuteListReadStore: store })
    const env = {} as never

    const blocks = await injectedWorker.fetch(
      request('/internal/social/interactions/blocks?limit=10', transportHeaders),
      env,
      {} as never,
    )
    const mutes = await injectedWorker.fetch(
      request('/internal/social/interactions/mutes?limit=10', transportHeaders),
      env,
      {} as never,
    )

    expect(blocks.status).toBe(200)
    await expect(blocks.json()).resolves.toMatchObject({
      data: { items: [{ relationshipId: 'block-pg-1', targetUserId: 'blocked-pg-user' }], hasMore: false, nextCursor: null },
    })
    expect(mutes.status).toBe(200)
    await expect(mutes.json()).resolves.toMatchObject({
      data: { items: [{ relationshipId: 'mute-pg-1', targetUserId: 'muted-pg-user' }], hasMore: false, nextCursor: null },
    })
    expect(store.list).toHaveBeenNthCalledWith(1, {
      actorUserId: 'viewer-1', relationType: 'block', cursor: null, limit: 10,
    })
    expect(store.list).toHaveBeenNthCalledWith(2, {
      actorUserId: 'viewer-1', relationType: 'mute', cursor: null, limit: 10,
    })
  })

  it('creates an idempotent Block relation through the injected Store', async () => {
    const row: BlockMuteRelationRow = { relationship_id: 'block-1', actor_user_id: 'viewer-1', target_user_id: 'target-1', relation_type: 'block', created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' }
    const store: BlockMuteRelationStore = { get: vi.fn(async () => null), set: vi.fn(async () => row), remove: vi.fn(async () => undefined) }
    const injectedWorker = createW05SocialWorker({ blockMuteRelationStore: store })
    const response = await injectedWorker.fetch(new Request('https://luckread-w05.internal/internal/social/interactions/blocks', { method: 'POST', headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'Idempotency-Key': 'block-1', 'content-type': 'application/json' }, body: JSON.stringify({ targetUserId: 'target-1' }) }), {} as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { relationshipId: 'block-1', relationType: 'block', targetUserId: 'target-1' } })
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'viewer-1', targetUserId: 'target-1', relationType: 'block' }))
  })

  it('creates Mute independently through the injected Store', async () => {
    const row: BlockMuteRelationRow = { relationship_id: 'mute-1', actor_user_id: 'viewer-1', target_user_id: 'target-1', relation_type: 'mute', created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' }
    const store: BlockMuteRelationStore = { get: vi.fn(async () => null), set: vi.fn(async () => row), remove: vi.fn(async () => undefined) }
    const injectedWorker = createW05SocialWorker({ blockMuteRelationStore: store })
    const response = await injectedWorker.fetch(new Request('https://luckread-w05.internal/internal/social/interactions/mutes', { method: 'POST', headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'Idempotency-Key': 'mute-1', 'content-type': 'application/json' }, body: JSON.stringify({ targetUserId: 'target-1' }) }), {} as never)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { relationshipId: 'mute-1', relationType: 'mute' } })
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'viewer-1', targetUserId: 'target-1', relationType: 'mute' }))
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

  it('unblocks and unmutes through the injected Store', async () => {
    const store: BlockMuteRelationStore = { get: vi.fn(async () => null), set: vi.fn(async () => null), remove: vi.fn(async () => undefined) }
    const injectedWorker = createW05SocialWorker({ blockMuteRelationStore: store })
    const unblock = await injectedWorker.fetch(new Request('https://luckread-w05.internal/internal/social/interactions/blocks/target-1', { method: 'DELETE', headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'Idempotency-Key': 'unblock-1' } }), {} as never)
    expect(unblock.status).toBe(204)
    const unmute = await injectedWorker.fetch(new Request('https://luckread-w05.internal/internal/social/interactions/mutes/target-1', { method: 'DELETE', headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'Idempotency-Key': 'unmute-1' } }), {} as never)
    expect(unmute.status).toBe(204)
    expect(store.remove).toHaveBeenNthCalledWith(1, { actorUserId: 'viewer-1', targetUserId: 'target-1', relationType: 'block' })
    expect(store.remove).toHaveBeenNthCalledWith(2, { actorUserId: 'viewer-1', targetUserId: 'target-1', relationType: 'mute' })
  })

  it('creates a share for published content through the injected Neon Store', async () => {
    const row = { share_id: 'share-1', content_id: 'content-1', actor_user_id: 'viewer-1', created_at: '2026-10-02T00:00:00.000Z' }
    const shareStore: ShareStore = {
      findByActorAndKey: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row),
      insertIfAbsent: vi.fn(async () => undefined),
      findById: vi.fn(async () => ({ share_id: row.share_id, content_id: row.content_id, created_at: row.created_at })),
    }
    const injectedWorker = createW05SocialWorker({ shareStore })
    const response = await injectedWorker.fetch(
      new Request('https://luckread-w05.internal/internal/social/content/content-1/shares', {
        method: 'POST',
        headers: { ...transportHeaders, 'Idempotency-Key': 'share-1' },
      }),
      { W03_CONTENT: publishedContextBinding() } as never,
      {} as never,
    )
    expect(response.status).toBe(201)
    expect(shareStore.insertIfAbsent).toHaveBeenCalledWith(expect.any(String), 'content-1', 'viewer-1', 'share-1', expect.any(String))
  })

  it('resolves a share without a viewer principal through the injected Neon Store', async () => {
    const shareStore: ShareStore = {
      findByActorAndKey: vi.fn(),
      insertIfAbsent: vi.fn(),
      findById: vi.fn(async () => ({ share_id: 'share-1', content_id: 'content-1', created_at: '2026-10-02T00:00:00.000Z' })),
    }
    const injectedWorker = createW05SocialWorker({ shareStore })
    const response = await injectedWorker.fetch(
      new Request('https://luckread-w05.internal/internal/social/shares/share-1', {
        method: 'GET',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'share-resolve',
        },
      }),
      { W03_CONTENT: publishedContextBinding() } as never,
      {} as never,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { contentId: 'content-1' } })
  })

  it('requires a share idempotency key before requiring a Neon Store', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/content/content-1/shares', {
        method: 'POST',
        headers: { ...transportHeaders },
      }),
      {} as never,
      {} as never,
    )
    expect(response.status).toBe(428)
  })

  it('fails closed for Favorite and Unfavorite without the injected Neon Store', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be used for Favorite mutations') })
    const env = { DB: { prepare } as unknown as D1Database, W03_CONTENT: publishedContextBinding() }
    const post = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'content-type': 'application/json',
          'Idempotency-Key': 'favorite-missing-store',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      env,
    )
    const del = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'content-type': 'application/json',
          'Idempotency-Key': 'unfavorite-missing-store',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      env,
    )
    expect(post.status).toBe(503)
    expect(del.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })


  it('fails closed when favorite list Store composition is missing', async () => {
    const db = dbFor()
    const response = await worker.fetch(
      request('/internal/social/interactions/bookmarks/list?limit=1', transportHeaders),
      { DB: db },
    )
    expect(response.status).toBe(503)
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('uses the injected PostgreSQL-capable favorite list store without touching D1', async () => {
    const cursor = btoa(encodeURIComponent(JSON.stringify({
      v: 1,
      actorUserId: 'viewer-1',
      createdAt: '2026-11-11T09:00:00.123456Z',
      relationshipId: 'pg-favorite-cursor',
    }))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    const store: FavoriteListReadStore = {
      list: vi.fn(async (_input: FavoriteListReadInput): Promise<readonly FavoriteListReadRow[]> => [
        {
          relationship_id: 'pg-favorite-1',
          target_id: 'content-pg-1',
          created_at: '2026-11-11T09:00:00.123Z',
          cursor_created_at: '2026-11-11T09:00:00.123456Z',
        },
        {
          relationship_id: 'pg-favorite-2',
          target_id: 'content-pg-2',
          created_at: '2026-11-10T09:00:00.000Z',
        },
      ]),
    }
    const d1Prepare = vi.fn()
    const injectedWorker = createW05SocialWorker({ favoriteListReadStore: store })
    const response = await injectedWorker.fetch(
      request(`/internal/social/interactions/bookmarks/list?limit=1&cursor=${cursor}`, transportHeaders),
      { DB: { prepare: d1Prepare } } as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(store.list).toHaveBeenCalledWith({
      actorUserId: 'viewer-1',
      cursor: {
        createdAt: '2026-11-11T09:00:00.123456Z',
        relationshipId: 'pg-favorite-cursor',
      },
      limit: 2,
    })
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{ targetId: 'content-pg-1', createdAt: '2026-11-11T09:00:00.123Z' }],
        hasMore: true,
        nextCursor: expect.any(String),
      },
    })
    expect(d1Prepare).not.toHaveBeenCalled()
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

  it('reads favorite status through the injected PostgreSQL Store without touching D1', async () => {
    const statusStore: FavoriteStatusReadStore = {
      isFavorited: vi.fn(async () => true),
    }
    const injectedWorker = createW05SocialWorker({ favoriteStatusReadStore: statusStore })
    const db = dbFor()
    const response = await injectedWorker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks?targetType=content&targetId=content-1', {
        method: 'GET',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2' },
      }),
      { DB: db, W03_CONTENT: publishedContextBinding() },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { favorited: true },
    })
    expect(statusStore.isFavorited).toHaveBeenCalledWith({ actorUserId: 'viewer-1', targetId: 'content-1' })
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('fails closed when favorite status Store composition is missing', async () => {
    const db = dbFor()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks?targetType=content&targetId=content-1', {
        method: 'GET',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2' },
      }),
      { DB: db, W03_CONTENT: publishedContextBinding() },
    )
    expect(response.status).toBe(503)
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('validates W03 before calling the injected Favorite Store', async () => {
    const mutationStore: FavoriteMutationStore = {
      create: vi.fn(async () => ({
        relationship_id: 'favorite-1',
        actor_user_id: 'viewer-1',
        target_type: 'content',
        target_id: 'content-1',
        created_at: '2026-10-02T00:00:00.000Z',
      })),
      remove: vi.fn(async () => undefined),
    }
    const injectedWorker = createW05SocialWorker({ favoriteMutationStore: mutationStore })
    const response = await injectedWorker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Layer': 'L2',
          'content-type': 'application/json',
          'Idempotency-Key': 'favorite-no-binding',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      { DB: dbFor() },
    )
    expect(response.status).toBe(503)
    expect(mutationStore.create).not.toHaveBeenCalled()
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

  it('accepts an idempotent content like and resolves its notification owner through W03', async () => {
    const contextBinding = {
      fetch: vi.fn(async (_input: RequestInfo | URL) => Response.json({
        data: {
          contentId: 'content-1',
          ownerUserId: 'owner-1',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-10-17T04:00:00.000Z',
        },
        requestId: 'req_notification_owner',
      })),
    }
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json', 'Idempotency-Key': 'like-1' },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      {
        DB: dbFor([
          { blocked: 0 },
          {
            relationship_id: 'like-1',
            actor_user_id: 'user-1',
            target_type: 'content',
            target_id: 'content-1',
            created_at: '2026-10-02T00:00:00.000Z',
          },
        ]),
        W03_CONTENT: contextBinding,
      },
    )
    expect(response.status).toBe(200)
    expect(contextBinding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = contextBinding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    await expect(response.json()).resolves.toMatchObject({
      data: { relationshipId: 'like-1', targetId: 'content-1' },
    })
  })

  it('fails closed when PostgreSQL Like status or target-context Store composition is missing', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be used for Like status reads') })
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes?targetType=content&targetId=content-1', {
        method: 'GET',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2' },
      }),
      { DB: { prepare } as unknown as D1Database, W03_CONTENT: publishedContextBinding() },
    )
    expect(response.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('uses injected PostgreSQL like-status and target-context stores without touching D1', async () => {
    const statusStore: LikeStatusReadStore = {
      read: vi.fn(async (_input: LikeStatusReadInput): Promise<LikeStatusReadResult> => ({
        liked: true,
        likeCount: 7,
      })),
    }
    const targetContextStore: LikeTargetContextReadStore = {
      readCommentTarget: vi.fn(async (_commentId: string) => ({
        id: 'comment-pg-1',
        state: 'PUBLISHED',
        author_user_id: 'comment-author-1',
        content_id: 'content-1',
      })),
      hasBidirectionalBlock: vi.fn(async (_actorUserId: string, _relatedUserIds: readonly string[]) => false),
    }
    const d1Prepare = vi.fn()
    const binding = publishedContextBinding()
    const injectedWorker = createW05SocialWorker({
      likeStatusReadStore: statusStore,
      likeTargetContextReadStore: targetContextStore,
    })
    const response = await injectedWorker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes?targetType=comment&targetId=comment-pg-1', {
        method: 'GET',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-User-Id': 'viewer-pg-1', 'X-LuckRead-Principal-Layer': 'L2' },
      }),
      { DB: { prepare: d1Prepare }, W03_CONTENT: binding } as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(targetContextStore.readCommentTarget).toHaveBeenCalledWith('comment-pg-1')
    expect(targetContextStore.hasBidirectionalBlock).toHaveBeenCalledWith(
      'viewer-pg-1',
      ['comment-author-1', 'owner-1'],
    )
    expect(statusStore.read).toHaveBeenCalledWith({
      actorUserId: 'viewer-pg-1',
      targetType: 'comment',
      targetId: 'comment-pg-1',
      includeCount: true,
    })
    await expect(response.json()).resolves.toMatchObject({
      data: { liked: true, likeCount: 7 },
    })
    expect(d1Prepare).not.toHaveBeenCalled()
  })

  it('fails closed for Like and Unlike when PostgreSQL mutation/context Stores are missing', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be used for Like mutations') })
    const env = { DB: { prepare } as unknown as D1Database }
    const post = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'POST',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'content-type': 'application/json', 'Idempotency-Key': 'like-missing-store' },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      env as never,
      {} as never,
    )
    const del = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'DELETE',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2', 'content-type': 'application/json', 'Idempotency-Key': 'unlike-missing-store' },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-1' }),
      }),
      env as never,
      {} as never,
    )
    expect(post.status).toBe(503)
    expect(del.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
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

  it('fails closed when Relationship Graph Store composition is missing', async () => {
    const response = await worker.fetch(request('/internal/social/follows/target-1', { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L2' }), {} as never)
    expect(response.status).toBe(503)
  })

  it('serves relationship graph through an injected PostgreSQL-capable store without touching D1', async () => {
    const store: RelationshipGraphReadStore = {
      read: vi.fn(async (_viewerUserId: string, _targetUserId: string): Promise<RelationshipGraphReadRow> => ({
        following: true,
        followed_by: false,
        relationship_id: 'pg-relationship-1',
        created_at: '2026-11-12T16:00:00.000Z',
        blocked: false,
        blocked_by: false,
        muted: true,
      })),
    }
    const injectedWorker = createW05SocialWorker({ relationshipGraphReadStore: store })
    const response = await injectedWorker.fetch(
      request('/internal/social/follows/pg-relationship-target-20261112', {
        ...transportHeaders,
        'X-LuckRead-Principal-Layer': 'L2',
      }),
      {} as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        following: true,
        relationshipId: 'pg-relationship-1',
        targetUserId: 'pg-relationship-target-20261112',
        createdAt: '2026-11-12T16:00:00.000Z',
        relationship: {
          viewerUserId: 'viewer-1',
          targetUserId: 'pg-relationship-target-20261112',
          following: true,
          followedBy: false,
          mutualFollow: false,
          blocked: false,
          blockedBy: false,
          muted: true,
          relationshipId: 'pg-relationship-1',
          createdAt: '2026-11-12T16:00:00.000Z',
        },
      },
    })
    expect(store.read).toHaveBeenCalledWith('viewer-1', 'pg-relationship-target-20261112')
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

  it('fails closed for public follower reads when the Neon Store is not composed', async () => {
    const publicTransportHeaders = {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'public-follow-test',
    }
    const prepare = vi.fn(() => { throw new Error('D1 must not be used') })
    const response = await worker.fetch(
      request('/internal/social/users/creator-1/followers?limit=20', publicTransportHeaders),
      { DB: { prepare } },
    )
    expect(response.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('serves followers with relationship rows and total count from Neon Store', async () => {
    const followListReadStore: FollowListReadStore = {
      list: vi.fn(async () => [{
        relationship_id: 'r1',
        user_id: 'fan-1',
        followed_at: '2026-10-02T00:00:00.000Z',
        cursor_created_at: '2026-10-02T00:00:00.000000Z',
      }]),
      count: vi.fn(async () => 1),
    }
    const injectedWorker = createW05SocialWorker({ followListReadStore })
    const response = await injectedWorker.fetch(
      request('/internal/social/users/creator-1/followers?limit=20', transportHeaders),
      { DB: dbFor([]) },
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

  it('serves following from the Neon relationship Store', async () => {
    const followListReadStore: FollowListReadStore = {
      list: vi.fn(async () => [{
        relationship_id: 'r2',
        user_id: 'creator-2',
        followed_at: '2026-10-02T00:00:00.000Z',
        cursor_created_at: '2026-10-02T00:00:00.000000Z',
      }]),
      count: vi.fn(async () => 1),
    }
    const injectedWorker = createW05SocialWorker({ followListReadStore })
    const response = await injectedWorker.fetch(
      request('/internal/social/users/user-1/following', transportHeaders),
      { DB: dbFor([]) },
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


describe('W05 PostgreSQL comment-list runtime injection', () => {
  it('uses the injected comment read store after W03 publication validation without touching D1', async () => {
    const commentListReadStore: CommentListReadStore = {
      list: vi.fn(async (input: CommentListReadInput): Promise<CommentListReadRow[]> => [{
        id: 'comment-postgres-1',
        content_id: input.contentId,
        author_user_id: 'comment-author',
        parent_id: null,
        body: 'Comment from injected PostgreSQL store',
        state: 'PUBLISHED',
        depth: 0,
        created_at: '2026-11-11T08:00:00.000Z',
        updated_at: '2026-11-11T08:00:00.000Z',
        mentions_json: '[]',
        liked_by_viewer: false,
        thread_created_at: '2026-11-11T08:00:00.000Z',
        thread_id: 'comment-postgres-1',
        thread_like_count: 0,
      }]),
    }
    const d1Prepare = vi.fn()
    const binding = publishedContextBinding()
    const injectedWorker = createW05SocialWorker({ commentListReadStore })
    const response = await injectedWorker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/comments?limit=20&sort=recent', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'comment-postgres-route',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
      }),
      { DB: { prepare: d1Prepare }, W03_CONTENT: binding } as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(commentListReadStore.list).toHaveBeenCalledWith({
      contentId: 'content-1',
      viewerUserId: 'viewer-1',
      limit: 20,
      sort: 'recent',
      cursor: null,
    })
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{
          id: 'comment-postgres-1',
          contentId: 'content-1',
          authorUserId: 'comment-author',
          body: 'Comment from injected PostgreSQL store',
          likedByViewer: false,
        }],
        hasMore: false,
        nextCursor: null,
      },
    })
    expect(d1Prepare).not.toHaveBeenCalled()
  })
})

describe('W05 social comment transport', () => {
  const commentHeaders = {
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': 'comment-test',
  }

  it('serves public comments after W03 validates publication, without direct canonical SQL', async () => {
    const binding = publishedContextBinding()
    const d = dbFor([])
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/comments?limit=20', {
        headers: commentHeaders,
      }),
      {
        DB: d,
        W03_CONTENT: binding,
      },
    )
    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    const queries = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare.mock.calls.map(([sql]) => String(sql))
    expect(queries.every(sql => !sql.toLowerCase().includes('join contents') && !sql.toLowerCase().includes('from contents'))).toBe(true)
  })

  it('fails closed before W05 D1 access when W03 cannot validate comment-list publication', async () => {
    const d = dbFor([])
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/comments?limit=20', {
        headers: commentHeaders,
      }),
      { DB: d },
    )
    expect(response.status).toBe(503)
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('updates an owned comment with a conditional version', async () => {
    const binding = publishedContextBinding()
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
            updatedAt: '2026-10-17T04:00:00.000Z',
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
            updatedAt: '2026-10-17T04:00:00.000Z',
            depth: 0,
            created_at: '2026-10-02T00:00:00.000Z',
            updated_at: '2026-10-02T00:02:00.000Z',
          },
        ]),
        W03_CONTENT: binding,
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"2026-10-02T00:02:00.000Z"')
    expect(response.headers.get('X-LuckRead-Content-Id')).toBe('content-1')
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
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
    const binding = publishedContextBinding()
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
        W03_CONTENT: binding,
      },
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('X-LuckRead-Content-Id')).toBe('content-1')
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
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

  it('resolves root comment notification recipients through W03', async () => {
    const contextBinding = {
      fetch: vi.fn(async (_input: RequestInfo | URL) => Response.json({
        data: {
          contentId: 'content-1',
          ownerUserId: 'owner-1',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-10-17T04:00:00.000Z',
        },
        requestId: 'req_comment_owner',
      })),
    }
    const d = dbFor([
      {
        existing_id: null,
        existing_content_id: null,
        existing_parent_id: null,
        existing_body: null,
        existing_author_user_id: null,
        existing_state: null,
        existing_depth: null,
        existing_created_at: null,
        existing_updated_at: null,
        content_state: 'PUBLISHED',
        content_owner_user_id: 'owner-1',
        parent_content_id: null,
        parent_author_user_id: null,
        parent_state: null,
        parent_depth: null,
        recent_count: 0,
        blocked: 0,
        reply_audience_allowed: 1,
      },
      {
        id: 'comment-1',
        content_id: 'content-1',
        author_user_id: 'viewer-1',
        parent_id: null,
        body: 'hello',
        state: 'PUBLISHED',
        updatedAt: '2026-10-17T04:00:00.000Z',
        depth: 0,
        created_at: '2026-10-20T00:00:00.000Z',
        updated_at: '2026-10-20T00:00:00.000Z',
      },
      null,
      null,
      null,
    ])
    const context = { waitUntil: vi.fn() }
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/comments', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'X-LuckRead-Principal-Verified': 'false',
          'content-type': 'application/json',
          'Idempotency-Key': 'comment-root-notification-1',
        },
        body: JSON.stringify({ body: 'hello' }),
      }),
      { DB: d, W03_CONTENT: contextBinding },
      context as never,
    )
    expect(response.status).toBe(201)
    expect(contextBinding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = contextBinding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(prepare.mock.calls.some(([sql]) => String(sql) === "SELECT owner_user_id FROM contents WHERE id = ? AND state = 'PUBLISHED' LIMIT 1")).toBe(false)
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'comment-1', contentId: 'content-1', authorUserId: 'viewer-1' },
    })
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

  it('creates a repost relation through the authenticated W01 principal using the injected Store', async () => {
    const row = { repost_id: 'repost-1', content_id: 'content-1', actor_user_id: 'viewer-1', created_at: '2026-10-16T00:00:00.000Z' }
    const repostStore: RepostStore = {
      isBlocked: vi.fn(async () => false),
      find: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row),
      insertIfAbsent: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    }
    const injectedWorker = createW05SocialWorker({ repostStore })
    const response = await injectedWorker.fetch(
      requestWithMethod('/internal/social/content/content-1/reposts', 'POST', {
        ...transportHeaders, 'Idempotency-Key': 'repost-1',
      }),
      { W03_CONTENT: publishedContextBinding() } as never,
      {} as never,
    )
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      data: { repostId: 'repost-1', contentId: 'content-1', actorUserId: 'viewer-1' },
    })
    expect(repostStore.insertIfAbsent).toHaveBeenCalledWith(expect.any(String), 'content-1', 'viewer-1', expect.any(String))
  })

  it('returns a no-store 204 when removing the caller repost through the injected Store', async () => {
    const repostStore: RepostStore = {
      isBlocked: vi.fn(async () => false), find: vi.fn(),
      insertIfAbsent: vi.fn(), remove: vi.fn(async () => undefined),
    }
    const injectedWorker = createW05SocialWorker({ repostStore })
    const response = await injectedWorker.fetch(
      requestWithMethod('/internal/social/content/content-1/reposts', 'DELETE', {
        ...transportHeaders, 'Idempotency-Key': 'repost-remove-1',
      }),
      {} as never,
      {} as never,
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(repostStore.remove).toHaveBeenCalledWith('viewer-1', 'content-1')
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

  it('pins only W03-verified owner content and unpins idempotently through the injected Store', async () => {
    const row = { user_id: 'viewer-1', content_id: 'content-1', pinned_at: '2026-10-16T00:00:00.000Z' }
    const profilePinStore: ProfilePinStore = {
      pin: vi.fn(async () => row),
      get: vi.fn(async () => row),
      unpin: vi.fn(async () => undefined),
    }
    const injectedWorker = createW05SocialWorker({ profilePinStore })
    const contextBinding = {
      fetch: vi.fn(async (_input: RequestInfo | URL) => Response.json({
        data: {
          contentId: 'content-1', ownerUserId: 'viewer-1', contentType: 'post',
          state: 'PUBLISHED', updatedAt: '2026-10-20T00:00:00.000Z',
        },
        requestId: 'req_w03',
      })),
    }
    const pinResponse = await injectedWorker.fetch(
      requestWithMethod('/internal/social/content/content-1/pin', 'POST', {
        ...transportHeaders, 'Idempotency-Key': 'pin-1',
      }),
      { W03_CONTENT: contextBinding } as never,
      {} as never,
    )
    expect(pinResponse.status).toBe(200)
    expect(contextBinding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = contextBinding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/contents/content-1/owned-post-context')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe('viewer-1')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    await expect(pinResponse.json()).resolves.toMatchObject({ data: { userId: 'viewer-1', contentId: 'content-1' } })

    const unpinResponse = await injectedWorker.fetch(
      requestWithMethod('/internal/social/content/content-1/pin', 'DELETE', {
        ...transportHeaders, 'Idempotency-Key': 'unpin-1',
      }),
      {} as never,
      {} as never,
    )
    expect(unpinResponse.status).toBe(204)
    expect(profilePinStore.unpin).toHaveBeenCalledWith('viewer-1', 'content-1')
  })

  it('fails profile pin writes closed when W03 context binding is missing', async () => {
    const profilePinStore: ProfilePinStore = {
      pin: vi.fn(), get: vi.fn(), unpin: vi.fn(),
    }
    const injectedWorker = createW05SocialWorker({ profilePinStore })
    const response = await injectedWorker.fetch(
      requestWithMethod('/internal/social/content/content-1/pin', 'POST', {
        ...transportHeaders, 'Idempotency-Key': 'pin-no-w03',
      }),
      {} as never,
      {} as never,
    )
    expect(response.status).toBe(503)
    expect(profilePinStore.pin).not.toHaveBeenCalled()
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

  it('returns public pinned-content references only after W03 confirms the post is published and owned by the profile', async () => {
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => Response.json({
        data: {
          contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'post',
          state: 'PUBLISHED', updatedAt: '2026-10-20T00:00:00.000Z',
        },
        requestId: 'req_public_pin',
      })),
    }
    const profilePinStore: ProfilePinStore = {
      pin: vi.fn(), unpin: vi.fn(),
      get: vi.fn(async () => ({ user_id: 'owner-1', content_id: 'content-1', pinned_at: '2026-10-16T00:00:00.000Z' })),
    }
    const injectedWorker = createW05SocialWorker({ profilePinStore })
    const response = await injectedWorker.fetch(
      request('/internal/social/users/owner-1/pinned-content', {
        'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'public-pin',
      }),
      { W03_CONTENT: binding } as never,
      {} as never,
    )
    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const forwarded = binding.fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/internal/content/contents/content-1/public-post-context/owner-1')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('X-LuckRead-Principal-User-Id')).toBe(false)
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(profilePinStore.get).toHaveBeenCalledWith('owner-1')
    await expect(response.json()).resolves.toMatchObject({ data: { userId: 'owner-1', contentId: 'content-1' } })
  })

  it('hides a stale profile pin when W03 no longer exposes the post as published owner content', async () => {
    const binding = {
      fetch: vi.fn(async () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })),
    }
    const profilePinStore: ProfilePinStore = {
      pin: vi.fn(), unpin: vi.fn(),
      get: vi.fn(async () => ({ user_id: 'owner-1', content_id: 'content-1', pinned_at: '2026-10-16T00:00:00.000Z' })),
    }
    const injectedWorker = createW05SocialWorker({ profilePinStore })
    const response = await injectedWorker.fetch(
      request('/internal/social/users/owner-1/pinned-content', {
        'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'stale-public-pin',
      }),
      { W03_CONTENT: binding } as never,
      {} as never,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: null })
  })

  it('fails closed on public profile pin reads when W03 is unavailable', async () => {
    const profilePinStore: ProfilePinStore = {
      pin: vi.fn(), unpin: vi.fn(),
      get: vi.fn(async () => ({ user_id: 'owner-1', content_id: 'content-1', pinned_at: '2026-10-16T00:00:00.000Z' })),
    }
    const injectedWorker = createW05SocialWorker({ profilePinStore })
    const response = await injectedWorker.fetch(
      request('/internal/social/users/owner-1/pinned-content', {
        'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'public-pin-no-w03',
      }),
      {} as never,
      {} as never,
    )
    expect(response.status).toBe(503)
    expect(profilePinStore.get).toHaveBeenCalledWith('owner-1')
  })

})

describe('W05 social poll transport', () => {
  it('reads public poll results through W03 and the injected PostgreSQL Store', async () => {
    const binding = publishedContextBinding()
    const pollReadStore = {
      isBlocked: vi.fn(async () => false),
      getPoll: vi.fn(async () => null),
      setEndsAtIfUnset: vi.fn(async () => undefined),
      listOptionsWithVoteCounts: vi.fn(async () => []),
      getViewerOptionId: vi.fn(async () => null),
    }
    const injectedWorker = createW05SocialWorker({ pollReadStore })
    const response = await injectedWorker.fetch(
      request('/internal/social/contents/content-1/poll', transportHeaders),
      { W03_CONTENT: binding },
    )
    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(pollReadStore.getPoll).toHaveBeenCalledWith('content-1')
    await expect(response.json()).resolves.toMatchObject({ data: { poll: null } })
  })

  it('preserves owner draft-poll preview through W03 and the injected Store', async () => {
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const forwarded = input instanceof Request ? input : new Request(input)
        if (new URL(forwarded.url).pathname.endsWith('/published-social-context')) {
          return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
        }
        return Response.json({ data: {
          contentId: 'content-1', ownerUserId: 'viewer-1', contentType: 'post',
          state: 'DRAFT', updatedAt: '2026-10-17T04:00:00.000Z',
        } })
      }),
    }
    const pollReadStore = {
      isBlocked: vi.fn(async () => false),
      getPoll: vi.fn(async () => null),
      setEndsAtIfUnset: vi.fn(async () => undefined),
      listOptionsWithVoteCounts: vi.fn(async () => []),
      getViewerOptionId: vi.fn(async () => null),
    }
    const injectedWorker = createW05SocialWorker({ pollReadStore })
    const response = await injectedWorker.fetch(
      request('/internal/social/contents/content-1/poll', transportHeaders),
      { W03_CONTENT: binding },
    )
    expect(response.status).toBe(200)
    expect(binding.fetch).toHaveBeenCalledTimes(2)
    expect(pollReadStore.getPoll).toHaveBeenCalledWith('content-1')
    await expect(response.json()).resolves.toMatchObject({ data: { poll: null } })
  })

  it('fails closed when Poll PostgreSQL Stores are not injected and never uses env.DB', async () => {
    const prepare = vi.fn(() => { throw new Error('Poll routes must not use D1') })
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const forwarded = input instanceof Request ? input : new Request(input)
        const path = new URL(forwarded.url).pathname
        if (path.endsWith('/published-social-context')) {
          return Response.json({ data: { contentId: 'content-1', ownerUserId: 'viewer-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z' } })
        }
        return Response.json({ data: { contentId: 'content-1', ownerUserId: 'viewer-1', contentType: 'post', state: 'DRAFT', updatedAt: '2026-10-17T04:00:00.000Z' } })
      }),
    }
    const env = { DB: { prepare }, W03_CONTENT: binding } as never
    const get = await worker.fetch(request('/internal/social/contents/content-1/poll', transportHeaders), env, {} as never)
    const headers = { ...transportHeaders, 'content-type': 'application/json', 'Idempotency-Key': 'poll-no-store' }
    const configure = await worker.fetch(new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll', {
      method: 'POST', headers, body: JSON.stringify({ options: ['Yes', 'No'], durationMinutes: 5 }),
    }), env, {} as never)
    const deletion = await worker.fetch(new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll', {
      method: 'DELETE', headers: { ...transportHeaders, 'Idempotency-Key': 'poll-delete-no-store' },
    }), env, {} as never)
    const vote = await worker.fetch(new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll/votes', {
      method: 'POST', headers, body: JSON.stringify({ optionId: 'option-1' }),
    }), env, {} as never)
    expect([get.status, configure.status, deletion.status, vote.status]).toEqual([503, 503, 503, 503])
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails closed before W05 D1 when W03 published context is unavailable for poll reads', async () => {
    const db = dbFor()
    const response = await worker.fetch(
      request('/internal/social/contents/content-1/poll', transportHeaders),
      { DB: db },
    )
    expect(response.status).toBe(503)
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('fails closed before W05 D1 when W03 owner context is unavailable for poll configure/delete', async () => {
    const headers = {
      ...transportHeaders,
      'Idempotency-Key': 'poll-context-unavailable',
      'content-type': 'application/json',
    }
    const configureDb = dbFor()
    const configure = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll', {
        method: 'POST',
        headers,
        body: JSON.stringify({ options: ['Yes', 'No'], durationMinutes: 5 }),
      }),
      { DB: configureDb },
    )
    expect(configure.status).toBe(503)
    expect((configureDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()

    const deleteDb = dbFor()
    const deletion = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll', {
        method: 'DELETE',
        headers: { ...transportHeaders, 'Idempotency-Key': 'poll-delete-context-unavailable' },
      }),
      { DB: deleteDb },
    )
    expect(deletion.status).toBe(503)
    expect((deleteDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('validates poll owner through W03 before touching W05 poll state', async () => {
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        expect(request.url).toContain('/internal/content/contents/content-1/owned-post-context')
        expect(request.headers.get('X-LuckRead-Caller')).toBe('W05')
        expect(request.headers.get('X-LuckRead-Principal-User-Id')).toBe('viewer-1')
        expect(request.headers.get('X-LuckRead-Principal-Layer')).toBe('L2')
        expect(request.headers.has('Authorization')).toBe(false)
        expect(request.headers.has('Cookie')).toBe(false)
        return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
      }),
    }
    const db = dbFor()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll', {
        method: 'POST',
        headers: { ...transportHeaders, 'Idempotency-Key': 'poll-non-owner', 'content-type': 'application/json' },
        body: JSON.stringify({ options: ['Yes', 'No'], durationHours: 24 }),
      }),
      { DB: db, W03_CONTENT: binding },
    )
    expect(response.status).toBe(404)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

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

  it('rejects mixed minute and legacy hour durations before resolving W03 or touching D1', async () => {
    const binding = { fetch: vi.fn(async () => Response.json({ error: { code: 'SHOULD_NOT_BE_CALLED' } }, { status: 500 })) }
    const db = dbFor()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/poll', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json', 'Idempotency-Key': 'poll-mixed-duration' },
        body: JSON.stringify({ options: ['Yes', 'No'], durationMinutes: 5, durationHours: 24 }),
      }),
      { DB: db, W03_CONTENT: binding },
    )
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_FAILED' } })
    expect(binding.fetch).not.toHaveBeenCalled()
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
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

  it('registers Expo push endpoints only in scoped D1-03 using the W01-derived principal', async () => {
    const token = 'ExponentPushToken[abcdefghijklmnop_1234567890]'
    const d1_02 = dbFor()
    const d1_03 = dbFor([{ endpoint_id: 'endpoint-1', permission_status: 'granted' }])
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/push-endpoints/6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c', {
        method: 'PUT',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'ios',
          permissionStatus: 'granted',
          expoPushToken: token,
          appVersion: '1.0.0',
        }),
      }),
      { DB: d1_02, D1_03: d1_03 },
    )

    expect(response.status).toBe(200)
    const responseText = await response.text()
    expect(JSON.parse(responseText)).toMatchObject({
      data: { endpointId: 'endpoint-1', status: 'ACTIVE' },
    })
    expect(responseText).not.toContain(token)
    expect((d1_02 as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
    expect((d1_03 as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).toHaveBeenCalledTimes(1)
    expect((d1_03 as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare.mock.calls[0]?.[0])
      .toContain('notification_push_endpoints')
  })

  it('rejects caller-supplied owner fields before touching D1-03', async () => {
    const d1_03 = dbFor()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/push-endpoints/6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c', {
        method: 'PUT',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          ownerUserId: 'attacker',
          platform: 'ios',
          permissionStatus: 'granted',
          expoPushToken: 'ExponentPushToken[abcdefghijklmnop_1234567890]',
        }),
      }),
      { DB: dbFor(), D1_03: d1_03 },
    )
    expect(response.status).toBe(422)
    expect((d1_03 as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('clears an endpoint token when permission is no longer granted', async () => {
    const d1_03 = dbFor([{ endpoint_id: 'endpoint-1', permission_status: 'denied' }])
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/push-endpoints/6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c', {
        method: 'PUT',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'android',
          permissionStatus: 'denied',
          expoPushToken: 'ExponentPushToken[abcdefghijklmnop_1234567890]',
        }),
      }),
      { DB: dbFor(), D1_03: d1_03 },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { endpointId: 'endpoint-1', status: 'DISABLED' },
    })
  })

  it("deletes only the current user's push endpoint from D1-03", async () => {
    const d1_03 = dbFor()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/push-endpoints/6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c', {
        method: 'DELETE',
        headers: transportHeaders,
      }),
      { DB: dbFor(), D1_03: d1_03 },
    )
    expect(response.status).toBe(204)
    expect((d1_03 as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare.mock.calls[0]?.[0])
      .toContain('WHERE owner_user_id = ? AND installation_id = ?')
  })

  it('fails closed when the scoped W05 D1-03 binding is missing', async () => {
    const socialDb = dbFor()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/push-endpoints/6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c', {
        method: 'DELETE',
        headers: transportHeaders,
      }),
      { DB: socialDb },
    )
    expect(response.status).toBe(503)
    expect((socialDb as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('requires L2 before push endpoint registration touches D1-03', async () => {
    const d1_03 = dbFor()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/push-endpoints/6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c', {
        method: 'DELETE',
        headers: { ...transportHeaders, 'X-LuckRead-Principal-Layer': 'L1' },
      }),
      { DB: dbFor(), D1_03: d1_03 },
    )
    expect(response.status).toBe(403)
    expect((d1_03 as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })


  it('applies W05 origin and authenticated-actor write limits to push endpoint registration', async () => {
    const globalLimiter = { limit: vi.fn(async () => ({ success: true })) }
    const actorLimiter = { limit: vi.fn(async () => ({ success: true })) }
    const d1_03 = dbFor([{ endpoint_id: 'endpoint-1', permission_status: 'granted' }])
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/push-endpoints/6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c', {
        method: 'PUT',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'ios',
          permissionStatus: 'granted',
          expoPushToken: 'ExponentPushToken[abcdefghijklmnop_1234567890]',
        }),
      }),
      {
        DB: dbFor(),
        D1_03: d1_03,
        SOCIAL_ORIGIN_GLOBAL_LIMITER: globalLimiter,
        SOCIAL_WRITE_LIMITER: actorLimiter,
      },
    )

    expect(response.status).toBe(200)
    expect(globalLimiter.limit).toHaveBeenCalledWith({
      key: 'origin:write:/internal/social/push-endpoints',
    })
    expect(actorLimiter.limit).toHaveBeenCalledWith({
      key: 'write:/internal/social/push-endpoints:user:viewer-1',
    })
  })

  it('rejects a push endpoint write when the authenticated-actor limiter blocks it', async () => {
    const actorLimiter = { limit: vi.fn(async () => ({ success: false })) }
    const d1_03 = dbFor()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/push-endpoints/6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c', {
        method: 'DELETE',
        headers: transportHeaders,
      }),
      {
        DB: dbFor(),
        D1_03: d1_03,
        SOCIAL_WRITE_LIMITER: actorLimiter,
      },
    )

    expect(response.status).toBe(429)
    expect(actorLimiter.limit).toHaveBeenCalledWith({
      key: 'write:/internal/social/push-endpoints:user:viewer-1',
    })
    expect((d1_03 as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

})



describe('W05 notification deep-link transport', () => {
  it('filters the notification list by both authenticated recipient and requested notification ID', async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = []
    const row = {
      notification_id: 'notification-1',
      notification_type: 'REPLY',
      actor_user_id: 'actor-1',
      target_type: 'comment',
      target_id: 'comment-1',
      payload_json: JSON.stringify({ contentId: 'content-1' }),
      read_at: null,
      created_at: '2026-11-04T10:00:00.000Z',
    }
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          statements.push({ sql, values })
          return {
            all: async () => ({ results: sql.includes('SELECT notification_id') ? [row] : [] }),
            first: async () => ({ count: 1 }),
          }
        },
      }),
    } as unknown as D1Database

    const response = await worker.fetch(
      request('/internal/social/notifications?limit=1&notificationId=notification-1', transportHeaders),
      { DB: db },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ id: 'notification-1', type: 'REPLY', payload: { contentId: 'content-1' } }] },
    })
    expect(statements[0]?.sql).toContain('recipient_user_id = ?')
    expect(statements[0]?.sql).toContain('notification_id = ?')
    expect(statements[0]?.values).toEqual(['viewer-1', 'notification-1', 2])
  })
})


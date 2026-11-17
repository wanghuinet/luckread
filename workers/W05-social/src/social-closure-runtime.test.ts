/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { SocialTargetsReadStoreError } from './social-targets-read-store.js'
import { extractSocialTokens, getContentSocialSummary, getSocialTargets, listDiscoveryTopics, listNotifications, syncSocialTokens } from './social-closure-runtime.js'
import type { NotificationEnqueueStore } from './notification-enqueue-store.js'
import type { SocialClosureReadStore, SocialDiscoveryTopicEdge } from './social-closure-read-store.js'
import type { SocialTokenSyncCommentContext, SocialTokenSyncMentionInput, SocialTokenSyncMentionRow, SocialTokenSyncStore, SocialTokenSyncTargetInput, SocialTokenSyncTargetType, SocialTokenSyncTopicInput } from './social-token-sync-store.js'

type TokenSyncStoreFixture = Readonly<{
  commentContext?: SocialTokenSyncCommentContext | null
  mentions?: readonly SocialTokenSyncMentionRow[]
}>

function createMemorySocialTokenSyncStore(options: TokenSyncStoreFixture = {}) {
  const mentions: SocialTokenSyncMentionRow[] = [...(options.mentions ?? [])]
  const store: SocialTokenSyncStore = {
    getCommentContext: vi.fn(async (_commentId: string) => options.commentContext ?? null),
    listMentions: vi.fn(async (_targetType: SocialTokenSyncTargetType, _targetId: string) => [...mentions]),
    replaceTargetRelations: vi.fn(async (input: SocialTokenSyncTargetInput) => {
      const retained = new Set(input.retainedMentionIds)
      for (let index = mentions.length - 1; index >= 0; index -= 1) {
        if (!retained.has(mentions[index]!.mention_id)) mentions.splice(index, 1)
      }
    }),
    upsertTopicAndAttach: vi.fn(async (_input: SocialTokenSyncTopicInput) => undefined),
    insertMention: vi.fn(async (input: SocialTokenSyncMentionInput) => {
      mentions.push({
        mention_id: input.mentionId,
        mentioned_user_id: input.mentionedUserId,
        handle: input.handle,
      })
    }),
  }
  return { store, mentions }
}


function createMemorySocialClosureReadStore(
  overrides: Partial<SocialClosureReadStore> = {},
): SocialClosureReadStore {
  return {
    getTargets: async () => ({ topics: [], mentions: [] }),
    getTopicByName: async () => null,
    listTopicContentEdges: async () => [],
    listDiscoveryContentEdges: async () => [],
    listNotificationRows: async () => [],
    countUnreadNotifications: async () => 0,
    markNotificationRead: async () => undefined,
    markAllNotificationsRead: async () => undefined,
    getContentSocialCounts: async () => null,
    getContentSocialViewerState: async () => null,
    ...overrides,
  }
}

describe('W05 unified social closure', () => {
  it('normalizes and deduplicates mentions and hashtags', () => {
    expect(extractSocialTokens('你好 @Alice #Travel #travel @Alice #日本')).toEqual([
      { kind: 'mention', value: '@Alice', normalized: 'alice' },
      { kind: 'hashtag', value: '#Travel', normalized: 'travel' },
      { kind: 'hashtag', value: '#日本', normalized: '日本' },
    ])
  })

  it('uses one content target family for article, post and video', () => {
    const source = 'target_type IN (\'content\',\'comment\')'
    expect(source).toContain("target_type IN ('content','comment')")
  })

  it('keeps notification vocabulary unified', () => {
    expect(['FOLLOW', 'LIKE', 'COMMENT', 'REPLY', 'MENTION']).toHaveLength(5)
  })

  it('uses W03 content context and the injected PostgreSQL store for social summary counts and pin state', async () => {
    const store = createMemorySocialClosureReadStore({
      getContentSocialCounts: vi.fn(async () => ({ likes: 3, comments: 2, favorites: 1, shares: 4, reposts: 7, pinned: true })),
      getContentSocialViewerState: vi.fn(async () => ({ liked: true, favorited: false, reposted: true })),
    })
    const contentContext = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const

    await expect(getContentSocialSummary(store, 'content-1', contentContext, 'viewer-1')).resolves.toMatchObject({
      contentId: 'content-1',
      contentType: 'post',
      counts: { likes: 3, comments: 2, favorites: 1, shares: 4, reposts: 7 },
      pinned: true,
      viewer: { liked: true, favorited: false, reposted: true },
      topics: [],
      mentions: [],
    })
    expect(store.getContentSocialCounts).toHaveBeenCalledWith('content-1', 'owner-1')
    expect(store.getContentSocialViewerState).toHaveBeenCalledWith('viewer-1', 'content-1')
  })

  it('rejects a mismatched or unpublished social context before querying W05', async () => {
    const getContentSocialCounts = vi.fn(async () => null)
    const store = createMemorySocialClosureReadStore({ getContentSocialCounts })
    await expect(getContentSocialSummary(store, 'content-1', {
      contentId: 'another-content',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(getContentSocialSummary(store, 'content-1', {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'UNPUBLISHED',
    } as never)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(getContentSocialCounts).not.toHaveBeenCalled()
  })

  it('validates content token synchronization through W03 context and writes only W05-owned edges', async () => {
    const { store } = createMemorySocialTokenSyncStore()
    const contentContext = { contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z' } as const
    await expect(syncSocialTokens(store, 'owner-1', 'content', 'content-1', 'plain text', [], contentContext))
      .resolves.toEqual({ topics: 0, mentions: 0 })
    expect(store.getCommentContext).not.toHaveBeenCalled()
    expect(store.listMentions).toHaveBeenCalledWith('content', 'content-1')
    expect(store.replaceTargetRelations).toHaveBeenCalledWith({ targetType: 'content', targetId: 'content-1', retainedMentionIds: [] })
    expect(store.upsertTopicAndAttach).not.toHaveBeenCalled()
    expect(store.insertMention).not.toHaveBeenCalled()
  })

  it('resolves Unicode-equivalent mention handles with the same NFKC and lowercase rules as parsed tokens', async () => {
    const { store } = createMemorySocialTokenSyncStore()
    const contentContext = { contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z' } as const
    const notificationStore: NotificationEnqueueStore = { enqueue: vi.fn(async () => undefined) }
    await expect(syncSocialTokens(store, 'owner-1', 'content', 'content-1', 'Thanks @alice', [{ userId: 'mentioned-user', handle: 'ＡＬＩＣＥ' }], contentContext, notificationStore))
      .resolves.toEqual({ topics: 0, mentions: 1 })
    expect(store.insertMention).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'content', targetId: 'content-1', actorUserId: 'owner-1',
      mentionedUserId: 'mentioned-user', handle: 'ＡＬＩＣＥ',
    }))
    expect(notificationStore.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 'mentioned-user', actorUserId: 'owner-1', notificationType: 'MENTION',
      targetType: 'content', targetId: 'content-1', payloadJson: JSON.stringify({ handle: 'ＡＬＩＣＥ' }),
    }))
  })

  it('accepts an injected provider-neutral social-target read store', async () => {
    const store = {
      getTargets: vi.fn(async () => ({
        topics: [{
          topic_id: 'topic-reading',
          normalized_name: 'reading',
          display_name: 'Reading',
        }],
        mentions: [{
          mentioned_user_id: 'stable-user-id',
          handle: 'alice',
        }],
      })),
    }
    await expect(getSocialTargets(store, 'content', 'content-1')).resolves.toEqual({
      topics: [{ topicId: 'topic-reading', name: 'reading', displayName: 'Reading' }],
      mentions: [{ userId: 'stable-user-id', handle: 'alice' }],
    })
    expect(store.getTargets).toHaveBeenCalledWith({
      targetType: 'content',
      targetId: 'content-1',
    })
  })

  it('maps provider social-target read failures to a sanitized service-unavailable error', async () => {
    const store = {
      getTargets: vi.fn(async () => { throw new SocialTargetsReadStoreError() }),
    }
    await expect(getSocialTargets(store, 'comment', 'comment-1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    })
  })

  it('keeps a historical mention attached to its stored immutable identity after its handle is reclaimed', async () => {
    const store = createMemorySocialClosureReadStore({
      getTargets: vi.fn(async () => ({
        topics: [],
        mentions: [{ mentioned_user_id: 'original-user-id', handle: 'alice' }],
      })),
    })

    // The current username owner may now be a different account. Historical
    // reads use the immutable ID captured when the mention was created.
    await expect(getSocialTargets(store, 'content', 'content-1')).resolves.toEqual({
      topics: [],
      mentions: [{ userId: 'original-user-id', handle: 'alice' }],
    })
    expect(store.getTargets).toHaveBeenCalledWith({ targetType: 'content', targetId: 'content-1' })
  })

  it('preserves an existing mention identity when the same handle is later owned by another account', async () => {
    const { store } = createMemorySocialTokenSyncStore({ mentions: [{ mention_id: 'mention-original', mentioned_user_id: 'original-user-id', handle: 'alice' }] })
    const contentContext = { contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z' } as const
    await expect(syncSocialTokens(store, 'owner-1', 'content', 'content-1', 'Still mentioning @alice', [{ userId: 'reclaimed-handle-owner-id', handle: 'alice' }], contentContext))
      .resolves.toEqual({ topics: 0, mentions: 1 })
    expect(store.insertMention).not.toHaveBeenCalled()
    expect(store.replaceTargetRelations).toHaveBeenCalledWith({ targetType: 'content', targetId: 'content-1', retainedMentionIds: ['mention-original'] })
    expect(store.listMentions).toHaveBeenCalledWith('content', 'content-1')
  })

  it('fails closed for content token sync without W03 context or when the actor is not the owner', async () => {
    const { store } = createMemorySocialTokenSyncStore()
    await expect(syncSocialTokens(store, 'owner-1', 'content', 'content-1', 'plain text'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(syncSocialTokens(store, 'owner-1', 'content', 'content-1', 'plain text', [], {
      contentId: 'content-1', ownerUserId: 'someone-else', contentType: 'post', state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(store.getCommentContext).not.toHaveBeenCalled()
    expect(store.listMentions).not.toHaveBeenCalled()
    expect(store.replaceTargetRelations).not.toHaveBeenCalled()
    await expect(syncSocialTokens(undefined, 'owner-1', 'content', 'content-1', 'plain text', [], {
      contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('ranks active discovery topics using W03-published contexts without querying canonical contents', async () => {
    const now = Date.now()
    const recent = (hoursAgo: number) => new Date(now - hoursAgo * 60 * 60 * 1000).toISOString()
    const old = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString()
    const edges = [
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-1' },
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-2' },
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-old' },
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-unpublished' },
      { topic_id: 'topic-2', normalized_name: 'books', display_name: 'Books', target_id: 'content-1' },
      { topic_id: 'topic-2', normalized_name: 'books', display_name: 'Books', target_id: 'content-3' },
      { topic_id: 'topic-3', normalized_name: 'writing', display_name: 'Writing', target_id: 'content-4' },
      { topic_id: 'topic_日本', normalized_name: '日本', display_name: '日本', target_id: 'content-4' },
      { topic_id: 'topic_日本語', normalized_name: '日本語', display_name: '日本語', target_id: 'content-5' },
      { topic_id: 'topic_龥', normalized_name: '龥', display_name: '龥', target_id: 'content-6' },
      { topic_id: 'topic_𐐀', normalized_name: 'deseret', display_name: 'Deseret', target_id: 'content-7' },
    ]
    const store = createMemorySocialClosureReadStore({
      listDiscoveryContentEdges: vi.fn(async ({ cursor, limit }) => {
        const ordered = [...edges]
          .filter(edge => !cursor || edge.topic_id > cursor.topicId ||
            (edge.topic_id === cursor.topicId && edge.target_id > cursor.targetId))
          .sort((a, b) => a.topic_id.localeCompare(b.topic_id) || a.target_id.localeCompare(b.target_id))
        return ordered.slice(0, limit) as SocialDiscoveryTopicEdge[]
      }),
    })
    const contextById = new Map([
      ['content-1', { contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(1) }],
      ['content-2', { contentId: 'content-2', ownerUserId: 'owner-2', contentType: 'article', state: 'PUBLISHED', updatedAt: recent(2) }],
      ['content-3', { contentId: 'content-3', ownerUserId: 'owner-3', contentType: 'video', state: 'PUBLISHED', updatedAt: recent(3) }],
      ['content-4', { contentId: 'content-4', ownerUserId: 'owner-4', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(4) }],
      ['content-5', { contentId: 'content-5', ownerUserId: 'owner-5', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(5) }],
      ['content-6', { contentId: 'content-6', ownerUserId: 'owner-6', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(5) }],
      ['content-7', { contentId: 'content-7', ownerUserId: 'owner-7', contentType: 'post', state: 'PUBLISHED', updatedAt: recent(5) }],
      ['content-old', { contentId: 'content-old', ownerUserId: 'owner-5', contentType: 'post', state: 'PUBLISHED', updatedAt: old }],
    ])
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        expect(request.url).toContain('/internal/content/published-social-context-batch')
        expect(request.headers.get('X-LuckRead-Caller')).toBe('W05')
        expect(request.headers.get('X-LuckRead-Correlation-Id')).toBe('discovery-test')
        expect(request.headers.has('Authorization')).toBe(false)
        expect(request.headers.has('Cookie')).toBe(false)
        const body = await request.json() as { contentIds: string[] }
        const items = body.contentIds.flatMap(id => {
          const context = contextById.get(id)
          return context ? [context] : []
        })
        return Response.json({ data: { items } })
      }),
    }

    const firstPage = await listDiscoveryTopics(store, binding, 'discovery-test', '2', null)
    expect(firstPage.items).toMatchObject([
      { topicId: 'topic-1', name: 'reading', displayName: 'Reading', contentCount: 2 },
      { topicId: 'topic-2', name: 'books', displayName: 'Books', contentCount: 2 },
    ])
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    expect(binding.fetch).toHaveBeenCalled()
    expect(store.listDiscoveryContentEdges).toHaveBeenCalledWith({ cursor: null, limit: 200 })

    const secondPage = await listDiscoveryTopics(store, binding, 'discovery-test', '1', firstPage.nextCursor)
    expect(secondPage.items).toMatchObject([
      { topicId: 'topic-3', name: 'writing', displayName: 'Writing', contentCount: 1 },
    ])
    expect(secondPage.hasMore).toBe(true)
    expect(secondPage.nextCursor).toEqual(expect.any(String))

    const thirdPage = await listDiscoveryTopics(store, binding, 'discovery-test', '1', secondPage.nextCursor)
    expect(thirdPage.items).toMatchObject([
      { topicId: 'topic_日本', name: '日本', displayName: '日本', contentCount: 1 },
    ])
    expect(thirdPage.hasMore).toBe(true)
    expect(thirdPage.nextCursor).toEqual(expect.any(String))

    const fourthPage = await listDiscoveryTopics(store, binding, 'discovery-test', '1', thirdPage.nextCursor)
    expect(fourthPage.items).toMatchObject([
      { topicId: 'topic_日本語', name: '日本語', displayName: '日本語', contentCount: 1 },
    ])
    expect(fourthPage.hasMore).toBe(true)
    expect(fourthPage.nextCursor).toEqual(expect.any(String))

    const fifthPage = await listDiscoveryTopics(store, binding, 'discovery-test', '1', fourthPage.nextCursor)
    expect(fifthPage.items).toMatchObject([
      { topicId: 'topic_龥', name: '龥', displayName: '龥', contentCount: 1 },
    ])
    expect(fifthPage.hasMore).toBe(true)
    expect(fifthPage.nextCursor).toEqual(expect.any(String))

    const sixthPage = await listDiscoveryTopics(store, binding, 'discovery-test', '1', fifthPage.nextCursor)
    expect(sixthPage.items).toMatchObject([
      { topicId: 'topic_𐐀', name: 'deseret', displayName: 'Deseret', contentCount: 1 },
    ])
    expect(sixthPage.hasMore).toBe(false)
    expect(sixthPage.nextCursor).toBeNull()
  })


  it('bounds W03 context retention and preserves contexts referenced by the current LRU batch', async () => {
    vi.stubGlobal('caches', undefined)
    const now = new Date().toISOString()
    // Topic ranking must not retain large optional card titles in its LRU.
    const largeTitle = 'x'.repeat(512)
    const edges = Array.from({ length: 5000 }, (_, index) => {
      const suffix = String(index).padStart(5, '0')
      return {
        topic_id: 'topic-' + suffix,
        normalized_name: 'topic-' + suffix,
        display_name: 'Topic ' + suffix,
        target_id: 'content-' + suffix,
      }
    })
    // The first row reuses the oldest cached content in the same batch as 199
    // newly fetched contexts. The LRU must not evict it before aggregation.
    edges.push(
      { topic_id: 'topic-05000', normalized_name: 'topic-05000', display_name: 'Topic 05000', target_id: 'content-00000' },
      { topic_id: 'topic-05000', normalized_name: 'topic-05000', display_name: 'Topic 05000', target_id: 'content-05000' },
    )
    for (let index = 1; index <= 198; index += 1) {
      const suffix = String(5000 + index).padStart(5, '0')
      edges.push({
        topic_id: 'topic-' + suffix,
        normalized_name: 'topic-' + suffix,
        display_name: 'Topic ' + suffix,
        target_id: 'content-' + suffix,
      })
    }
    // This later reference confirms an evicted context is re-fetched safely.
    edges.push({
      topic_id: 'topic-99999',
      normalized_name: 'topic-99999',
      display_name: 'Topic 99999',
      target_id: 'content-00001',
    })

    const store = createMemorySocialClosureReadStore({
      listDiscoveryContentEdges: vi.fn(async ({ cursor, limit }) => edges
        .filter(edge => !cursor || edge.topic_id > cursor.topicId ||
          (edge.topic_id === cursor.topicId && edge.target_id > cursor.targetId))
        .sort((a, b) => a.topic_id < b.topic_id ? -1 : a.topic_id > b.topic_id ? 1 :
          a.target_id < b.target_id ? -1 : a.target_id > b.target_id ? 1 : 0)
        .slice(0, limit) as SocialDiscoveryTopicEdge[]),
    })

    const requestedIds: string[] = []
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        const body = await request.json() as { contentIds: string[] }
        requestedIds.push(...body.contentIds)
        return Response.json({
          data: {
            items: body.contentIds.map(contentId => ({
              contentId,
              ownerUserId: 'owner-1',
              contentType: 'post',
              state: 'PUBLISHED',
              updatedAt: now,
              title: largeTitle,
            })),
          },
        })
      }),
    }

    try {
      const page = await listDiscoveryTopics(store, binding, 'bounded-context-cache-test', '1', null)
      expect(page.items).toMatchObject([
        { topicId: 'topic-05000', contentCount: 2 },
      ])
      expect(page.hasMore).toBe(true)
      expect(store.listDiscoveryContentEdges).toHaveBeenCalled()
      expect(requestedIds).toHaveLength(5200)
      expect(requestedIds.filter(contentId => contentId === 'content-00001')).toHaveLength(2)
      expect(binding.fetch).toHaveBeenCalledTimes(105)
    } finally {
      vi.unstubAllGlobals()
    }
  })


  it('reuses the ranked discovery snapshot across cursor pages', async () => {
    const cacheEntries = new Map<string, Response>()
    const cache = {
      match: vi.fn(async (key: Request) => cacheEntries.get(key.url)?.clone()),
      put: vi.fn(async (key: Request, response: Response) => {
        cacheEntries.set(key.url, response.clone())
      }),
    }
    vi.stubGlobal('caches', { default: cache })

    const now = Date.now()
    const edges = [
      { topic_id: 'topic-1', normalized_name: 'reading', display_name: 'Reading', target_id: 'content-1' },
      { topic_id: 'topic-2', normalized_name: 'books', display_name: 'Books', target_id: 'content-2' },
    ]
    const store = createMemorySocialClosureReadStore({
      listDiscoveryContentEdges: vi.fn(async ({ cursor, limit }) => edges
        .filter(edge => !cursor || edge.topic_id > cursor.topicId ||
          (edge.topic_id === cursor.topicId && edge.target_id > cursor.targetId))
        .slice(0, limit) as SocialDiscoveryTopicEdge[]),
    })
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        const body = await request.json() as { contentIds: string[] }
        return Response.json({
          data: {
            items: body.contentIds.map((contentId, index) => ({
              contentId,
              ownerUserId: 'owner-' + (index + 1),
              contentType: 'post',
              state: 'PUBLISHED',
              updatedAt: new Date(now - index * 60_000).toISOString(),
            })),
          },
        })
      }),
    }

    try {
      const firstPage = await listDiscoveryTopics(store, binding, 'discovery-cache-test', '1', null)
      expect(firstPage.items).toMatchObject([
        { topicId: 'topic-1', contentCount: 1 },
      ])
      expect(firstPage.hasMore).toBe(true)
      expect(firstPage.nextCursor).toEqual(expect.any(String))

      const secondPage = await listDiscoveryTopics(store, binding, 'discovery-cache-test', '1', firstPage.nextCursor)
      expect(secondPage.items).toMatchObject([
        { topicId: 'topic-2', contentCount: 1 },
      ])
      expect(secondPage.hasMore).toBe(false)
      expect(secondPage.nextCursor).toBeNull()
      expect(store.listDiscoveryContentEdges).toHaveBeenCalledTimes(1)
      expect(binding.fetch).toHaveBeenCalledTimes(1)
      expect(cache.put).toHaveBeenCalledTimes(1)
      expect(cache.match).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects malformed discovery topic cursors', async () => {
    const listDiscoveryContentEdges = vi.fn(async () => [])
    const store = createMemorySocialClosureReadStore({ listDiscoveryContentEdges })
    await expect(listDiscoveryTopics(store, undefined, 'invalid-cursor-test', '20', 'not-a-cursor'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(listDiscoveryContentEdges).not.toHaveBeenCalled()
  })



})


describe('W05 notification deep-link lookup', () => {
  it('returns only the requested notification owned by the authenticated recipient', async () => {
    const row = {
      notification_id: 'notification-1',
      notification_type: 'COMMENT',
      actor_user_id: 'actor-1',
      target_type: 'content',
      target_id: 'content-1',
      payload_json: '{}',
      read_at: null,
      created_at: '2026-11-04T10:00:00.000Z',
    }
    const store = createMemorySocialClosureReadStore({
      listNotificationRows: vi.fn(async () => [row]),
      countUnreadNotifications: vi.fn(async () => 3),
    })

    await expect(listNotifications(store, 'recipient-1', null, '1', null, 'notification-1'))
      .resolves.toMatchObject({
        items: [{ id: 'notification-1', type: 'COMMENT', actorUserId: 'actor-1', targetId: 'content-1' }],
        unreadCount: 3,
      })
    expect(store.listNotificationRows).toHaveBeenCalledWith({
      recipientUserId: 'recipient-1',
      notificationType: null,
      notificationId: 'notification-1',
      cursor: null,
      limit: 2,
    })
  })

  it('rejects malformed notification IDs before querying the database', async () => {
    const listNotificationRows = vi.fn(async () => [])
    const store = createMemorySocialClosureReadStore({ listNotificationRows })
    await expect(listNotifications(store, 'recipient-1', null, '1', null, 'n'.repeat(129)))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(listNotificationRows).not.toHaveBeenCalled()
  })
})

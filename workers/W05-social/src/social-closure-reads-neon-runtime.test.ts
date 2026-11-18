import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { SocialClosureReadStore, SocialTopicRow } from './social-closure-read-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const contentId = 'social-summary-neon-content'
const viewerUserId = 'social-summary-viewer'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-social-closure-read-test',
  'X-LuckRead-Principal-User-Id': viewerUserId,
  'X-LuckRead-Principal-Layer': 'L2',
}

const topic: SocialTopicRow = {
  topic_id: 'topic-reading',
  normalized_name: 'reading',
  display_name: 'Reading',
  status: 'ACTIVE',
}

function createHarness() {
  const socialClosureReadStore: SocialClosureReadStore = {
    getTargets: vi.fn(async () => ({
      topics: [{ topic_id: topic.topic_id, normalized_name: topic.normalized_name, display_name: topic.display_name }],
      mentions: [],
    })),
    getContentTargetsBatch: vi.fn(async (ids: readonly string[]) => Object.fromEntries(ids.map(id => [id, {
      topics: [{ topic_id: topic.topic_id, normalized_name: topic.normalized_name, display_name: topic.display_name }],
      mentions: [],
    }]))),
    getTopicByName: vi.fn(async () => topic),
    listTopicContentEdges: vi.fn(async () => []),
    listDiscoveryContentEdges: vi.fn(async () => []),
    listNotificationRows: vi.fn(async () => []),
    countUnreadNotifications: vi.fn(async () => 0),
    markNotificationRead: vi.fn(async () => undefined),
    markAllNotificationsRead: vi.fn(async () => undefined),
    getContentSocialCounts: vi.fn(async () => ({
      likes: 4,
      comments: 2,
      favorites: 1,
      shares: 3,
      reposts: 5,
      pinned: true,
    })),
    getContentSocialViewerState: vi.fn(async () => ({
      liked: true,
      favorited: false,
      reposted: true,
    })),
    getContentSocialBatchRows: vi.fn(async (ids: readonly string[]) => ids.map(content_id => ({
      content_id, likes: 4, comments: 2, favorites: 1, shares: 3, reposts: 5,
      pinned: true, liked: true, favorited: false, reposted: true,
    }))),
  }

  const w03Content: W03ContentBinding = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      if (new URL(req.url).pathname.endsWith('published-social-context-batch')) {
        const body = await req.json() as { contentIds: string[] }
        return Response.json({ data: { items: body.contentIds.map(id => ({
          contentId: id, ownerUserId: 'social-summary-owner', contentType: 'post',
          state: 'PUBLISHED', updatedAt: '2026-11-15T00:00:00.000Z',
        })) } })
      }
      return Response.json({
        data: {
          contentId, ownerUserId: 'social-summary-owner', contentType: 'post',
          state: 'PUBLISHED', updatedAt: '2026-11-15T00:00:00.000Z',
        },
        requestId: 'req-w03-social-summary',
      })
    }),
  }
  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon social closure read path')
  })
  const worker = createW05SocialWorker({ socialClosureReadStore })

  return {
    worker,
    env: { DB: { prepare }, W03_CONTENT: w03Content },
    prepare,
    socialClosureReadStore,
    w03Content,
  }
}

const request = (pathname: string) => new Request('https://luckread-w05.internal' + pathname, {
  method: 'GET',
  headers: transportHeaders,
})

describe('W05 Neon social-closure read route composition', () => {
  it('fails closed when the Neon closure Store is missing instead of falling back to D1', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 fallback must not execute') })
    const worker = createW05SocialWorker()
    const response = await worker.fetch(
      request('/internal/social/notifications'),
      { DB: { prepare } } as never,
      {} as never,
    )
    expect(response.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('reads content social summary and viewer state through PostgreSQL after W03 validation without D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      request('/internal/social/contents/' + contentId + '/summary'),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        contentId,
        contentType: 'post',
        counts: { likes: 4, comments: 2, favorites: 1, shares: 3, reposts: 5 },
        pinned: true,
        viewer: { liked: true, favorited: false, reposted: true },
        topics: [{ topicId: 'topic-reading', name: 'reading', displayName: 'Reading' }],
        mentions: [],
      },
    })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(h.socialClosureReadStore.getContentSocialCounts).toHaveBeenCalledWith(contentId, 'social-summary-owner')
    expect(h.socialClosureReadStore.getContentSocialViewerState).toHaveBeenCalledWith(viewerUserId, contentId)
    expect(h.socialClosureReadStore.getTargets).toHaveBeenCalledWith({ targetType: 'content', targetId: contentId })
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('reads a visible social-summary batch through one W03 context request and viewer-scoped Neon batch reads', async () => {
    const h = createHarness()
    const readLimiter = { limit: vi.fn(async () => ({ success: true })) }
    const writeLimiter = { limit: vi.fn(async () => ({ success: true })) }
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/summary-batch', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ contentIds: [contentId, 'social-summary-second'] }),
      }),
      { ...h.env, SOCIAL_READ_LIMITER: readLimiter, SOCIAL_WRITE_LIMITER: writeLimiter } as never,
      {} as never,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [
        { contentId, viewer: { liked: true, favorited: false, reposted: true } },
        { contentId: 'social-summary-second', viewer: { liked: true, favorited: false, reposted: true } },
      ] },
    })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(readLimiter.limit).toHaveBeenCalledWith({
      key: 'read:internal/social/contents/summary-batch:user:' + viewerUserId,
    })
    expect(writeLimiter.limit).not.toHaveBeenCalled()
    expect(h.socialClosureReadStore.getContentSocialBatchRows).toHaveBeenCalledWith(
      [contentId, 'social-summary-second'],
      ['social-summary-owner', 'social-summary-owner'],
      viewerUserId,
    )
    expect(h.socialClosureReadStore.getContentTargetsBatch).toHaveBeenCalledWith([contentId, 'social-summary-second'])
    expect(h.socialClosureReadStore.getContentSocialCounts).not.toHaveBeenCalled()
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('does not return viewer-specific state for anonymous batch requests', async () => {
    const h = createHarness()
    const anonymousHeaders = { ...transportHeaders }
    delete (anonymousHeaders as Record<string, string>)['X-LuckRead-Principal-User-Id']
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/summary-batch', {
        method: 'POST',
        headers: { ...anonymousHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ contentIds: [contentId] }),
      }),
      h.env as never,
      {} as never,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { items: [{ viewer: null }] } })
    expect(h.socialClosureReadStore.getContentSocialBatchRows).toHaveBeenCalledWith(
      [contentId], ['social-summary-owner'], null,
    )
  })

  it('rejects more than 50 IDs before asking W03 for published contexts', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/summary-batch', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ contentIds: Array.from({ length: 51 }, (_, index) => 'content-' + index) }),
      }),
      h.env as never,
      {} as never,
    )
    expect(response.status).toBe(422)
    expect(h.w03Content.fetch).not.toHaveBeenCalled()
  })

  it('reads discovery topic edges through PostgreSQL without touching D1', async () => {
    const h = createHarness()
    vi.stubGlobal('caches', undefined)
    try {
      const response = await h.worker.fetch(
        request('/internal/social/discovery/topics?limit=10'),
        h.env as never,
        {} as never,
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        data: { items: [], hasMore: false, nextCursor: null },
      })
      expect(h.socialClosureReadStore.listDiscoveryContentEdges).toHaveBeenCalledWith({
        cursor: null,
        limit: 200,
      })
      expect(h.prepare).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads topic metadata and content edges through PostgreSQL without touching D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      request('/internal/social/topics/reading?limit=10'),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        topic: { topicId: 'topic-reading', name: 'reading', displayName: 'Reading', status: 'ACTIVE' },
        contents: [],
        hasMore: false,
        nextCursor: null,
      },
    })
    expect(h.socialClosureReadStore.getTopicByName).toHaveBeenCalledWith('reading')
    expect(h.socialClosureReadStore.listTopicContentEdges).toHaveBeenCalledWith({
      topicId: 'topic-reading',
      cursor: null,
      limit: 50,
    })
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

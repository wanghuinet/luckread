import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { NotificationEnqueueStore } from './notification-enqueue-store.js'
import type { SocialTargetsReadStore } from './social-targets-read-store.js'
import type { SocialTokenSyncStore } from './social-token-sync-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const contentId = 'content-tokens-neon-content'
const actorUserId = 'content-tokens-owner'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-content-tokens-test',
  'X-LuckRead-Principal-User-Id': actorUserId,
  'X-LuckRead-Principal-Layer': 'L2',
}

function createHarness() {
  const socialTargetsReadStore: SocialTargetsReadStore = {
    getTargets: vi.fn(async () => ({
      topics: [{
        topic_id: 'topic-reading',
        normalized_name: 'reading',
        display_name: 'Reading',
      }],
      mentions: [{
        mentioned_user_id: 'mentioned-user',
        handle: 'alice',
      }],
    })),
  }

  const socialTokenSyncStore: SocialTokenSyncStore = {
    getCommentContext: vi.fn(async () => null),
    listMentions: vi.fn(async () => []),
    replaceTargetRelations: vi.fn(async () => undefined),
    upsertTopicAndAttach: vi.fn(async () => undefined),
    insertMention: vi.fn(async () => undefined),
  }

  const notificationEnqueueStore: NotificationEnqueueStore = {
    enqueue: vi.fn(async () => undefined),
  }

  const w03Content: W03ContentBinding = {
    fetch: vi.fn(async () => Response.json({
      data: {
        contentId,
        ownerUserId: actorUserId,
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: '2026-11-15T00:00:00.000Z',
      },
      requestId: 'req-w03-content-tokens',
    })),
  }

  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon content-token path')
  })
  const worker = createW05SocialWorker({
    socialTargetsReadStore,
    socialTokenSyncStore,
    notificationEnqueueStore,
  })

  return {
    worker,
    env: { DB: { prepare }, W03_CONTENT: w03Content },
    prepare,
    socialTargetsReadStore,
    socialTokenSyncStore,
    notificationEnqueueStore,
    w03Content,
  }
}

describe('W05 Neon Content Tokens routes', () => {
  it('reads content topics and immutable mentions through PostgreSQL after W03 publication validation', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/' + contentId + '/tokens', {
        method: 'GET',
        headers: transportHeaders,
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        topics: [{ topicId: 'topic-reading', name: 'reading', displayName: 'Reading' }],
        mentions: [{ userId: 'mentioned-user', handle: 'alice' }],
      },
    })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(h.socialTargetsReadStore.getTargets).toHaveBeenCalledWith({
      targetType: 'content',
      targetId: contentId,
    })
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('syncs content tokens and mention notifications through PostgreSQL without touching D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/' + contentId + '/tokens', {
        method: 'POST',
        headers: { ...transportHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: '#Reading @alice',
          mentions: [{ userId: 'mentioned-user', handle: 'alice' }],
        }),
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { topics: 1, mentions: 1 },
    })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(h.socialTokenSyncStore.listMentions).toHaveBeenCalledWith('content', contentId)
    expect(h.socialTokenSyncStore.replaceTargetRelations).toHaveBeenCalledWith({
      targetType: 'content',
      targetId: contentId,
      retainedMentionIds: [],
    })
    expect(h.socialTokenSyncStore.upsertTopicAndAttach).toHaveBeenCalledWith(expect.objectContaining({
      normalizedName: 'reading',
      targetType: 'content',
      targetId: contentId,
      token: '#Reading',
    }))
    expect(h.socialTokenSyncStore.insertMention).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'content',
      targetId: contentId,
      actorUserId,
      mentionedUserId: 'mentioned-user',
      handle: 'alice',
    }))
    expect(h.notificationEnqueueStore.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 'mentioned-user',
      actorUserId,
      notificationType: 'MENTION',
      targetType: 'content',
      targetId: contentId,
    }))
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

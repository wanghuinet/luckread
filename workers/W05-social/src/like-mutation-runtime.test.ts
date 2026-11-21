import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { CommentNotificationContextStore } from './comment-notification-context-store.js'
import type { LikeMutationStore } from './like-mutation-store.js'
import type { LikeTargetContextReadStore } from './like-target-context-read-store.js'
import type { NotificationEnqueueStore } from './notification-enqueue-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-like-mutation-test',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

function publishedContentBinding(): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const contentId = decodeURIComponent(new URL(request.url).pathname.split('/').at(-2) ?? '')
      return Response.json({
        data: {
          contentId,
          ownerUserId: 'content-owner-1',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-11-14T00:00:00.000Z',
        },
      })
    }),
  }
}

function createHarness() {
  const mutationStore: LikeMutationStore = {
    create: vi.fn(async (input) => ({
      relationship_id: 'like-pg-1',
      actor_user_id: input.actorUserId,
      target_type: input.targetType,
      target_id: input.targetId,
      created_at: input.createdAt,
    })),
    remove: vi.fn(async () => undefined),
  }
  const targetContextReadStore: LikeTargetContextReadStore = {
    readCommentTarget: vi.fn(async () => ({
      id: 'comment-1',
      state: 'PUBLISHED',
      author_user_id: 'comment-author-1',
      content_id: 'content-1',
    })),
    hasBidirectionalBlock: vi.fn(async () => false),
  }
  const commentNotificationContextStore: CommentNotificationContextStore = {
    getPublishedContext: vi.fn(async () => ({
      comment_id: 'comment-1',
      content_id: 'content-1',
      author_user_id: 'comment-author-1',
    })),
  }
  const notificationEnqueueStore: NotificationEnqueueStore = {
    enqueue: vi.fn(async () => undefined),
  }
  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Like path')
  })
  const db = { prepare } as unknown as D1Database
  const w03Content = publishedContentBinding()
  const worker = createW05SocialWorker({
    likeMutationStore: mutationStore,
    likeTargetContextReadStore: targetContextReadStore,
    commentNotificationContextStore,
    notificationEnqueueStore,
  })
  const env = { DB: db, W03_CONTENT: w03Content }
  return {
    worker,
    env,
    prepare,
    mutationStore,
    targetContextReadStore,
    commentNotificationContextStore,
    notificationEnqueueStore,
    w03Content,
  }
}

describe('W05 Neon Like mutation route composition', () => {
  it('creates comment Likes, resolves W03 Block context and enqueues notification without D1 access', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'comment-like-idempotency-1',
        },
        body: JSON.stringify({ targetType: 'comment', targetId: 'comment-1' }),
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        relationshipId: 'like-pg-1',
        actorUserId: 'viewer-1',
        targetType: 'comment',
        targetId: 'comment-1',
      },
    })
    expect(h.targetContextReadStore.readCommentTarget).toHaveBeenCalledWith('comment-1')
    expect(h.targetContextReadStore.hasBidirectionalBlock).toHaveBeenCalledWith(
      'viewer-1',
      ['comment-author-1', 'content-owner-1'],
    )
    expect(h.mutationStore.create).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'viewer-1',
      targetType: 'comment',
      targetId: 'comment-1',
      parentOwnerUserId: 'content-owner-1',
    }))
    expect(h.commentNotificationContextStore.getPublishedContext).toHaveBeenCalledWith('comment-1')
    expect(h.notificationEnqueueStore.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 'comment-author-1',
      actorUserId: 'viewer-1',
      notificationType: 'LIKE',
      targetType: 'comment',
      targetId: 'comment-1',
    }))
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('removes the actor-scoped Like through the injected mutation store without D1 access', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'comment-unlike-idempotency-1',
        },
        body: JSON.stringify({ targetType: 'comment', targetId: 'comment-1' }),
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(h.mutationStore.remove).toHaveBeenCalledWith({
      actorUserId: 'viewer-1',
      targetType: 'comment',
      targetId: 'comment-1',
    })
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

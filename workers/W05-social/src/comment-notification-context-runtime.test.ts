/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createW05SocialWorker } from './index.js'
import {
  CommentNotificationContextRuntimeError,
  getPublishedCommentNotificationContext,
} from './comment-notification-context-runtime.js'
import {
  CommentNotificationContextStoreError,
  type CommentNotificationContextStore,
} from './comment-notification-context-store.js'

describe('W05 comment notification context runtime', () => {
  it('uses an injected store and returns only the published comment projection', async () => {
    const row = {
      comment_id: 'comment-1',
      content_id: 'content-1',
      author_user_id: 'author-1',
    }
    const store: CommentNotificationContextStore = {
      getPublishedContext: vi.fn(async () => row),
    }
    await expect(getPublishedCommentNotificationContext(store, 'comment-1')).resolves.toEqual(row)
    expect(store.getPublishedContext).toHaveBeenCalledWith('comment-1')
  })

  it('fails closed for nested comment creation when the Neon context store is missing', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be used') })
    const worker = createW05SocialWorker()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/comments', {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'comment-context-required',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
          'X-LuckRead-Principal-Layer': 'L2',
          'Idempotency-Key': 'reply-neon-required',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ body: 'reply', parentId: 'parent-1' }),
      }),
      { DB: { prepare } } as never,
      {} as never,
    )
    expect(response.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails closed for comment likes before mutation when the Neon context store is missing', async () => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be used') })
    const worker = createW05SocialWorker()
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/likes', {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'comment-like-context-required',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
          'X-LuckRead-Principal-Layer': 'L2',
          'Idempotency-Key': 'comment-like-neon-required',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetType: 'comment', targetId: 'comment-1' }),
      }),
      { DB: { prepare } } as never,
      {} as never,
    )
    expect(response.status).toBe(503)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('maps store failures to a sanitized 503', async () => {
    const store: CommentNotificationContextStore = {
      getPublishedContext: vi.fn(async () => { throw new CommentNotificationContextStoreError() }),
    }
    await expect(getPublishedCommentNotificationContext(store, 'comment-1'))
      .rejects.toBeInstanceOf(CommentNotificationContextRuntimeError)
    await expect(getPublishedCommentNotificationContext(store, 'comment-1'))
      .rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'SERVICE_UNAVAILABLE',
      })
  })
})

/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
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

  it('uses D1 as the default data source', async () => {
    const first = vi.fn(async () => ({
      comment_id: 'comment-1',
      content_id: 'content-1',
      author_user_id: 'author-1',
    }))
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first })),
      })),
    } as unknown as D1Database

    await expect(getPublishedCommentNotificationContext(db, 'comment-1')).resolves.toMatchObject({
      comment_id: 'comment-1',
      author_user_id: 'author-1',
    })
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("state = 'PUBLISHED'"))
    expect(first).toHaveBeenCalledOnce()
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

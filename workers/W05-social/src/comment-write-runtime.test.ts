import { describe, expect, it, vi } from 'vitest'
import { createW05SocialWorker } from './index.js'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'neon-comment-route-test',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

function publishedContentBinding() {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const parts = new URL(request.url).pathname.split('/').filter(Boolean)
      const contentId = decodeURIComponent(parts.at(-2) ?? '')
      return Response.json({
        data: {
          contentId,
          ownerUserId: 'owner-1',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-10-17T04:00:00.000Z',
        },
      })
    }),
  }
}

describe('W05 Neon comment write route composition', () => {
  it('routes comment create/edit/delete and topic, mention and notification effects through injected stores', async () => {
    const oldUpdatedAt = '2026-11-14T00:00:00.000Z'
    const newUpdatedAt = '2026-11-14T00:01:00.000Z'
    const commentRow = {
      id: 'comment-1',
      content_id: 'content-1',
      author_user_id: 'viewer-1',
      parent_id: null,
      body: 'hello #Reading @alice',
      state: 'PUBLISHED' as const,
      depth: 0,
      created_at: oldUpdatedAt,
      updated_at: oldUpdatedAt,
    }
    const commentCreateStore = {
      validate: vi.fn(async () => ({
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
        blocked: false,
        reply_audience_allowed: true,
      })),
      insert: vi.fn(async () => commentRow),
      getFinalState: vi.fn(async () => ({ content_state: 'PUBLISHED', reply_audience_allowed: true })),
    }
    const commentMutationStore = {
      getForDelete: vi.fn(async () => ({
        id: 'comment-1',
        content_id: 'content-1',
        author_user_id: 'viewer-1',
        state: 'PUBLISHED' as const,
        has_replies: false,
      })),
      markDeleted: vi.fn(async () => true),
      getDeleteState: vi.fn(async () => 'AUTHOR_DELETED' as const),
      getForUpdate: vi.fn(async () => ({ ...commentRow })),
      update: vi.fn(async (input: { body: string }) => ({
        ...commentRow,
        body: input.body,
        updated_at: newUpdatedAt,
      })),
    }
    const socialTokenSyncStore = {
      getCommentContext: vi.fn(async () => ({
        content_id: 'content-1',
        author_user_id: 'viewer-1',
        state: 'PUBLISHED',
      })),
      listMentions: vi.fn(async () => []),
      replaceTargetRelations: vi.fn(async () => undefined),
      upsertTopicAndAttach: vi.fn(async () => undefined),
      insertMention: vi.fn(async () => undefined),
    }
    const socialTargetsReadStore = {
      getTargets: vi.fn(async () => ({
        topics: [],
        mentions: [{ mentioned_user_id: 'mentioned-user', handle: 'alice' }],
      })),
    }
    const commentNotificationContextStore = {
      getPublishedContext: vi.fn(async () => ({
        comment_id: 'parent-1',
        content_id: 'content-1',
        author_user_id: 'parent-author',
      })),
    }
    const notificationEnqueueStore = { enqueue: vi.fn(async () => undefined) }
    const d1Prepare = vi.fn(() => {
      throw new Error('D1 must not be touched by injected Neon comment stores')
    })
    const w03Content = publishedContentBinding()
    const worker = createW05SocialWorker({
      commentCreateStore,
      commentMutationStore,
      socialTokenSyncStore,
      socialTargetsReadStore,
      commentNotificationContextStore,
      notificationEnqueueStore,
    })

    const created = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/content-1/comments', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'comment-create-neon-1',
        },
        body: JSON.stringify({
          body: 'hello #Reading @alice',
          mentions: [{ userId: 'mentioned-user', handle: 'alice' }],
        }),
      }),
      { DB: { prepare: d1Prepare }, W03_CONTENT: w03Content } as never,
      {} as never,
    )

    expect(created.status).toBe(201)
    expect(commentCreateStore.validate).toHaveBeenCalledTimes(1)
    expect(commentCreateStore.insert).toHaveBeenCalledTimes(1)
    expect(socialTokenSyncStore.getCommentContext).toHaveBeenCalledTimes(1)
    expect(socialTokenSyncStore.replaceTargetRelations).toHaveBeenCalledTimes(1)
    expect(socialTokenSyncStore.upsertTopicAndAttach).toHaveBeenCalledTimes(1)
    expect(socialTokenSyncStore.insertMention).toHaveBeenCalledTimes(1)
    expect(socialTargetsReadStore.getTargets).toHaveBeenCalledTimes(1)
    expect(notificationEnqueueStore.enqueue).toHaveBeenCalledTimes(2)

    const updated = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/comments/comment-1', {
        method: 'PATCH',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'comment-update-neon-1',
          'If-Match': '"' + oldUpdatedAt + '"',
        },
        body: JSON.stringify({ body: 'edited' }),
      }),
      { DB: { prepare: d1Prepare }, W03_CONTENT: w03Content } as never,
      {} as never,
    )
    const updatedBody = await updated.json() as { data?: { body?: string } }
    expect(updated.status).toBe(200)
    expect(updatedBody.data?.body).toBe('edited')
    expect(commentMutationStore.getForUpdate).toHaveBeenCalledTimes(1)
    expect(commentMutationStore.update).toHaveBeenCalledTimes(1)
    expect(socialTokenSyncStore.getCommentContext).toHaveBeenCalledTimes(2)
    expect(socialTargetsReadStore.getTargets).toHaveBeenCalledTimes(2)

    const deleted = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/comments/comment-1', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'comment-delete-neon-1',
        },
      }),
      { DB: { prepare: d1Prepare }, W03_CONTENT: w03Content } as never,
      {} as never,
    )

    expect(deleted.status).toBe(204)
    expect(commentMutationStore.getForDelete).toHaveBeenCalledTimes(1)
    expect(commentMutationStore.markDeleted).toHaveBeenCalledTimes(1)
    expect(d1Prepare).not.toHaveBeenCalled()
  })
})

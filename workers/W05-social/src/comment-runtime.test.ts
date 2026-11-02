/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createComment, deleteComment, listComments, parseCommentLimit, parseCommentSort, updateComment } from './comment-runtime.js'
import { replyAudienceAllowedSql } from './reply-audience-runtime.js'
import type { PublishedContentSocialContext, W03ContentBinding } from './w03-content-context-client.js'

const db = (firstResults: unknown[] = [], allResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      all: vi.fn(async () => ({ results: allResults })),
      run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

const publishedContext = (contentId = 'content-1'): PublishedContentSocialContext => ({
  contentId,
  ownerUserId: 'owner-1',
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt: '2026-10-17T04:00:00.000Z',
})

const publishedBinding = (): W03ContentBinding => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const contentId = decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).at(-2) ?? '')
    return Response.json({ data: publishedContext(contentId) })
  }),
})

describe('comment runtime', () => {
  it('creates a published root comment after one validation read', async () => {
    const d = db([
      {
        content_state: 'PUBLISHED',
        parent_content_id: null,
        parent_state: null,
        parent_depth: null,
      },
      {
        id: 'c1',
        content_id: 'content-1',
        author_user_id: 'user-1',
        parent_id: null,
        body: '你好',
        state: 'PUBLISHED',
        depth: 0,
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
      },
    ])
    await expect(createComment(d, 'user-1', 'content-1', {
      body: '你好',
      idempotencyKey: 'idem-1',
    })).resolves.toMatchObject({
      id: 'c1',
      contentId: 'content-1',
      authorUserId: 'user-1',
      parentId: null,
      state: 'PUBLISHED',
      depth: 0,
    })
    expect(d.prepare).toHaveBeenCalledTimes(2)
  })

  it('returns the existing comment for an idempotent retry before rate-limit checks', async () => {
    const d = db([{
      existing_id: 'c-existing',
      existing_content_id: 'content-1',
      existing_parent_id: null,
      existing_body: '已经发表',
      existing_author_user_id: 'user-1',
      existing_state: 'PUBLISHED',
      existing_depth: 0,
      existing_created_at: '2026-10-02T00:00:00.000Z',
      existing_updated_at: '2026-10-02T00:00:00.000Z',
      content_state: 'DRAFT',
      recent_count: 99,
      blocked: 1,
    }])

    await expect(createComment(d, 'user-1', 'content-1', {
      body: '已经发表',
      idempotencyKey: 'same-key',
    })).resolves.toMatchObject({
      id: 'c-existing',
      contentId: 'content-1',
      authorUserId: 'user-1',
      state: 'PUBLISHED',
    })
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('rejects an idempotency key reused with a different comment payload', async () => {
    const d = db([{
      existing_id: 'c-existing',
      existing_content_id: 'content-1',
      existing_parent_id: null,
      existing_body: '原始评论',
      existing_author_user_id: 'user-1',
      existing_state: 'PUBLISHED',
      existing_depth: 0,
      existing_created_at: '2026-10-02T00:00:00.000Z',
      existing_updated_at: '2026-10-02T00:00:00.000Z',
      content_state: 'PUBLISHED',
      recent_count: 0,
      blocked: 0,
    }])

    await expect(createComment(d, 'user-1', 'content-1', {
      body: '不同评论',
      idempotencyKey: 'same-key',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('replays a deleted comment idempotency key as the original published result', async () => {
    const d = db([{
      existing_id: 'c-deleted',
      existing_content_id: 'content-1',
      existing_parent_id: null,
      existing_body: '已删除前的评论',
      existing_author_user_id: 'user-1',
      existing_state: 'AUTHOR_DELETED',
      existing_depth: 0,
      existing_created_at: '2026-10-02T00:00:00.000Z',
      existing_updated_at: '2026-10-03T00:00:00.000Z',
      content_state: 'DRAFT',
      recent_count: 99,
      blocked: 1,
    }])

    await expect(createComment(d, 'user-1', 'content-1', {
      body: '已删除前的评论',
      idempotencyKey: 'same-key',
    })).resolves.toMatchObject({
      id: 'c-deleted',
      contentId: 'content-1',
      authorUserId: 'user-1',
      state: 'PUBLISHED',
    })
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('retries an author deletion tombstone after the parent content is unpublished', async () => {
    const d = db([{
      id: 'c-deleted',
      content_id: 'content-1',
      author_user_id: 'user-1',
      state: 'AUTHOR_DELETED',
      content_state: 'DRAFT',
      has_replies: 0,
    }])

    await expect(deleteComment(d, undefined, 'user-1', 'c-deleted', 'comment-test')).resolves.toBe('content-1')
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('rejects comments when the actor is blocked by the content relationship', async () => {
    const d = db([{
      content_state: 'PUBLISHED',
      content_owner_user_id: 'user-2',
      parent_content_id: null,
      parent_author_user_id: null,
      parent_state: null,
      parent_depth: null,
      blocked: 1,
      recent_count: 0,
    }])
    await expect(createComment(d, 'user-1', 'content-1', {
      body: '被屏蔽后不能评论',
      idempotencyKey: 'blocked-1',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })

  it('rejects a reply outside the content owner’s configured audience before inserting', async () => {
    const d = db([{
      content_state: 'PUBLISHED',
      content_owner_user_id: 'owner-1',
      parent_content_id: null,
      parent_author_user_id: null,
      parent_state: null,
      parent_depth: null,
      blocked: 0,
      recent_count: 0,
      reply_audience_allowed: 0,
    }])
    await expect(createComment(d, 'viewer-1', 'content-1', {
      body: 'not allowed',
      idempotencyKey: 'reply-audience-denied',
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('rechecks published parent state in the final comment insert', async () => {
    const d = db([
      {
        content_state: 'PUBLISHED',
        parent_content_id: 'content-1',
        parent_state: 'PUBLISHED',
        parent_depth: 1,
      },
      {
        id: 'c-race-safe',
        content_id: 'content-1',
        author_user_id: 'user-2',
        parent_id: 'c1',
        body: '回复',
        state: 'PUBLISHED',
        depth: 2,
        created_at: '2026-10-02T00:01:00.000Z',
        updated_at: '2026-10-02T00:01:00.000Z',
      },
    ])

    await expect(createComment(d, 'user-2', 'content-1', {
      body: '回复',
      parentId: 'c1',
      idempotencyKey: 'idem-race-safe',
    })).resolves.toMatchObject({ id: 'c-race-safe', parentId: 'c1' })

    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(prepare.mock.calls[1]?.[0]).toContain("content.state = 'PUBLISHED'")
    expect(prepare.mock.calls[1]?.[0]).toContain("parent.state = 'PUBLISHED'")
    expect(prepare.mock.calls[1]?.[0]).toContain('parent.depth < 3')
  })

  it('rechecks reply audience eligibility if the policy changes before the final insert', async () => {
    const d = db([
      {
        content_state: 'PUBLISHED',
        content_owner_user_id: 'user-2',
        parent_content_id: null,
        parent_author_user_id: null,
        parent_state: null,
        parent_depth: null,
        blocked: 0,
        recent_count: 0,
        reply_audience_allowed: 1,
      },
      null,
      { content_state: 'PUBLISHED', reply_audience_allowed: 0 },
    ])

    await expect(createComment(d, 'user-1', 'content-1', {
      body: '权限在提交过程中收紧',
      idempotencyKey: 'reply-audience-race-1',
    })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    })

    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(String(prepare.mock.calls[1]?.[0])).toContain(replyAudienceAllowedSql)
    expect(prepare).toHaveBeenCalledTimes(3)
  })

  it('rechecks the Block policy in the final comment insert', async () => {
    const d = db([
      {
        content_state: 'PUBLISHED',
        content_owner_user_id: 'user-2',
        parent_content_id: null,
        parent_author_user_id: null,
        parent_state: null,
        parent_depth: null,
        blocked: 0,
        recent_count: 0,
      },
    ])
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    prepare.mockImplementationOnce(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({
          content_state: 'PUBLISHED',
          content_owner_user_id: 'user-2',
          parent_content_id: null,
          parent_author_user_id: null,
          parent_state: null,
          parent_depth: null,
          blocked: 0,
          recent_count: 0,
        })),
      })),
    })).mockImplementationOnce(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => null),
      })),
    })).mockImplementationOnce(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ content_state: 'PUBLISHED', reply_audience_allowed: 1 })),
      })),
    }))

    await expect(createComment(d, 'user-1', 'content-1', {
      body: '并发屏蔽期间的评论',
      idempotencyKey: 'block-race-1',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })

    expect(prepare.mock.calls[1]?.[0]).toContain("block.relation_type = 'block'")
    expect(prepare.mock.calls[1]?.[0]).toContain('block.actor_user_id = ? AND block.target_user_id = content.owner_user_id')
    expect(prepare.mock.calls[1]?.[0]).toContain('block.actor_user_id = content.owner_user_id AND block.target_user_id = ?')
  })

  it('creates a nested comment only while the parent depth is below three', async () => {
    const d = db([
      {
        content_state: 'PUBLISHED',
        parent_content_id: 'content-1',
        parent_state: 'PUBLISHED',
        parent_depth: 2,
      },
      {
        id: 'c2',
        content_id: 'content-1',
        author_user_id: 'user-2',
        parent_id: 'c1',
        body: '回复',
        state: 'PUBLISHED',
        depth: 3,
        created_at: '2026-10-02T00:01:00.000Z',
        updated_at: '2026-10-02T00:01:00.000Z',
      },
    ])
    await expect(createComment(d, 'user-2', 'content-1', {
      body: '回复',
      parentId: 'c1',
      idempotencyKey: 'idem-2',
    })).resolves.toMatchObject({ parentId: 'c1', depth: 3 })
  })

  it('rejects a parent from another content item', async () => {
    const d = db([{
      content_state: 'PUBLISHED',
      parent_content_id: 'content-2',
      parent_state: 'PUBLISHED',
      parent_depth: 0,
    }])
    await expect(createComment(d, 'user-1', 'content-1', {
      body: '错误回复',
      parentId: 'other',
      idempotencyKey: 'idem-3',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('rejects non-published content', async () => {
    const d = db([{
      content_state: 'DRAFT',
      parent_content_id: null,
      parent_state: null,
      parent_depth: null,
    }])
    await expect(createComment(d, 'user-1', 'content-1', {
      body: '不可见',
      idempotencyKey: 'idem-4',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('treats a concurrent deletion that already reached the tombstone as idempotent success', async () => {
    const d = db([
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', state: 'PUBLISHED', has_replies: 0 },
      { state: 'AUTHOR_DELETED' },
    ])
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    prepare.mockImplementationOnce(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({
          id: 'c1',
          content_id: 'content-1',
          author_user_id: 'user-1',
          state: 'PUBLISHED',
          content_state: 'PUBLISHED',
          has_replies: 0,
        })),
      })),
    })).mockImplementationOnce(() => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({ success: true, meta: { changes: 0 } })),
      })),
    })).mockImplementationOnce(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ state: 'AUTHOR_DELETED' })),
      })),
    }))

    await expect(deleteComment(d, publishedBinding(), 'user-1', 'c1', 'comment-test')).resolves.toBe('content-1')
    expect(prepare).toHaveBeenCalledTimes(3)
  })

  it('keeps comment deletion atomic against a concurrent reply', async () => {
    const d = db([
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', state: 'PUBLISHED', has_replies: 0 },
    ])
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    prepare.mockImplementationOnce(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({
          id: 'c1',
          content_id: 'content-1',
          author_user_id: 'user-1',
          state: 'PUBLISHED',
          content_state: 'PUBLISHED',
          has_replies: 0,
        })),
      })),
    })).mockImplementationOnce(() => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({ success: true, meta: { changes: 0 } })),
      })),
    }))

    await expect(deleteComment(d, publishedBinding(), 'user-1', 'c1', 'comment-test')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })

  it('deletes an owned leaf comment', async () => {
    const binding = publishedBinding()
    const d = db([
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', state: 'PUBLISHED', has_replies: 0 },
    ])
    await expect(deleteComment(d, binding, 'user-1', 'c1', 'comment-test')).resolves.toBe('content-1')
    expect(d.prepare).toHaveBeenCalledTimes(2)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const queries = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([sql]) => String(sql))
    expect(queries.every(sql => !sql.toLowerCase().includes('contents'))).toBe(true)
  })

  it('fails closed before deleting when W03 publication context is unavailable', async () => {
    const d = db([{ id: 'c1', content_id: 'content-1', author_user_id: 'user-1', state: 'PUBLISHED', has_replies: 0 }])
    await expect(deleteComment(d, undefined, 'user-1', 'c1', 'comment-test')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    const queries = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([sql]) => String(sql))
    expect(queries).toHaveLength(1)
    expect(queries[0].toLowerCase()).not.toContain('contents')
  })

  it('keeps author deletion idempotent for an existing tombstone', async () => {
    const d = db([
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', state: 'AUTHOR_DELETED', has_replies: 0 },
    ])

    await expect(deleteComment(d, publishedBinding(), 'user-1', 'c1', 'comment-test')).resolves.toBe('content-1')
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('rejects deleting another user comment', async () => {
    const d = db([
      { id: 'c1', author_user_id: 'user-2', state: 'PUBLISHED', has_replies: 0 },
    ])
    await expect(deleteComment(d, publishedBinding(), 'user-1', 'c1', 'comment-test')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    })
  })

  it('rejects deleting comments that have replies', async () => {
    const d = db([
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', state: 'PUBLISHED', has_replies: 1 },
    ])
    await expect(deleteComment(d, publishedBinding(), 'user-1', 'c1', 'comment-test')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })

  it('updates an owned published comment with the matching version', async () => {
    const binding = publishedBinding()
    const d = db([
      {
        id: 'c1',
        content_id: 'content-1',
        author_user_id: 'user-1',
        parent_id: null,
        body: '修改前',
        state: 'PUBLISHED',
        depth: 0,
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:01:00.000Z',
        content_state: 'PUBLISHED',
      },
      {
        id: 'c1',
        content_id: 'content-1',
        author_user_id: 'user-1',
        parent_id: null,
        body: '修改后',
        state: 'PUBLISHED',
        depth: 0,
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:02:00.000Z',
      },
    ])

    await expect(updateComment(d, binding, 'user-1', 'c1', {
      body: '修改后',
      ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'comment-test')).resolves.toMatchObject({
      item: { id: 'c1', body: '修改后' },
      etag: '"2026-10-02T00:02:00.000Z"',
    })
    expect(d.prepare).toHaveBeenCalledTimes(2)
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const queries = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([sql]) => String(sql))
    expect(queries.every(sql => !sql.toLowerCase().includes('contents'))).toBe(true)
  })

  it('fails closed before updating when W03 publication context is unavailable', async () => {
    const d = db([{
      id: 'c1', content_id: 'content-1', author_user_id: 'user-1', parent_id: null,
      body: '原文', state: 'PUBLISHED', depth: 0,
      created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:01:00.000Z',
    }])
    await expect(updateComment(d, undefined, 'user-1', 'c1', {
      body: '修改', ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'comment-test')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('rejects an update from another author', async () => {
    const d = db([{
      id: 'c1',
      content_id: 'content-1',
      author_user_id: 'user-2',
      body: '原文',
      state: 'PUBLISHED',
      depth: 0,
      parent_id: null,
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:01:00.000Z',
      content_state: 'PUBLISHED',
    }])

    await expect(updateComment(d, publishedBinding(), 'user-1', 'c1', {
      body: '越权修改',
      ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'comment-test')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    })
  })

  it('rejects stale comment versions', async () => {
    const d = db([{
      id: 'c1',
      content_id: 'content-1',
      author_user_id: 'user-1',
      body: '原文',
      state: 'PUBLISHED',
      depth: 0,
      parent_id: null,
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:02:00.000Z',
      content_state: 'PUBLISHED',
    }])

    await expect(updateComment(d, publishedBinding(), 'user-1', 'c1', {
      body: '旧版本修改',
      ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'comment-test')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      status: 412,
    })
  })

  it('replays a comment edit after the server committed but its response was lost', async () => {
    const d = db([{
      id: 'c1',
      content_id: 'content-1',
      author_user_id: 'user-1',
      body: 'already saved',
      state: 'PUBLISHED',
      depth: 0,
      parent_id: null,
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:02:00.000Z',
      content_state: 'PUBLISHED',
    }])

    await expect(updateComment(d, publishedBinding(), 'user-1', 'c1', {
      body: 'already saved',
      ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'comment-retry')).resolves.toMatchObject({
      item: { id: 'c1', body: 'already saved', updatedAt: '2026-10-02T00:02:00.000Z' },
      etag: '"2026-10-02T00:02:00.000Z"',
    })
    // Replay reads the canonical record but does not issue a second UPDATE.
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('requires a valid If-Match header value', async () => {
    const d = db()
    await expect(updateComment(d, publishedBinding(), 'user-1', 'c1', {
      body: '修改',
      ifMatch: '',
    }, 'comment-test')).rejects.toMatchObject({
      code: 'PRECONDITION_REQUIRED',
      status: 428,
    })
  })

  it('lists only bounded published comments with an opaque next cursor', async () => {
    const d = db([], [
      {
        id: 'c1',
        content_id: 'content-1',
        author_user_id: 'user-1',
        parent_id: null,
        body: '第一条',
        state: 'PUBLISHED',
        depth: 0,
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
        mentions_json: '[{"userId":"original-user-id","handle":"alice"}]',
      },
      {
        id: 'c2',
        content_id: 'content-1',
        author_user_id: 'user-2',
        parent_id: 'c1',
        body: '回复',
        state: 'PUBLISHED',
        depth: 1,
        created_at: '2026-10-02T00:01:00.000Z',
        updated_at: '2026-10-02T00:01:00.000Z',
      },
      {
        id: 'c3',
        content_id: 'content-1',
        author_user_id: 'user-3',
        parent_id: null,
        body: '第三条',
        state: 'PUBLISHED',
        depth: 0,
        created_at: '2026-10-02T00:02:00.000Z',
        updated_at: '2026-10-02T00:02:00.000Z',
      },
    ])
    const page = await listComments(d, 'content-1', null, 2, publishedContext())
    expect(page.items).toHaveLength(2)
    expect(page.items[0].id).toBe('c1')
    expect(page.items[0].authorUserId).toBe('user-1')
    expect(page.items[0].mentions).toEqual([{ userId: 'original-user-id', handle: 'alice' }])
    expect(page.items[1].id).toBe('c2')
    expect(page.items[1].authorUserId).toBe('user-2')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
    const queries = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([sql]) => String(sql))
    expect(queries.every(sql => !sql.toLowerCase().includes('join contents') && !sql.toLowerCase().includes('from contents'))).toBe(true)
    expect(queries[0]).toContain('mention.mentioned_user_id')
    expect(queries[0]).toContain('mention.handle')
    expect(queries[0]).toContain("mention.target_type = 'comment'")
    expect(queries[0]).not.toContain('JOIN users')
    expect(queries[0]).not.toContain('username')
  })

  it('returns the authenticated viewer like state in the same bounded comment list query', async () => {
    const d = db([], [{
      id: 'c-liked',
      content_id: 'content-1',
      author_user_id: 'author-1',
      parent_id: null,
      body: '已点赞评论',
      state: 'PUBLISHED',
      depth: 0,
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
      liked_by_viewer: 1,
    }])

    await expect(listComments(d, 'content-1', null, 20, publishedContext(), 'viewer-1')).resolves.toMatchObject({
      items: [{ id: 'c-liked', likedByViewer: true }],
      hasMore: false,
    })

    const sql = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(sql).toContain('WITH RECURSIVE viewer AS (SELECT ? AS user_id)')
    expect(sql).toContain('FROM interaction_likes liked')
    expect(sql).toContain('JOIN viewer v ON v.user_id = liked.actor_user_id')
    expect(sql).toContain("liked.target_type = 'comment'")
    expect(sql).toContain('AS liked_by_viewer')
  })

  it('rejects comment cursors reused against another content ID', async () => {
    const d = db([], [
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', parent_id: null, body: 'one', state: 'PUBLISHED', depth: 0, created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' },
      { id: 'c2', content_id: 'content-1', author_user_id: 'user-2', parent_id: null, body: 'two', state: 'PUBLISHED', depth: 0, created_at: '2026-10-02T00:01:00.000Z', updated_at: '2026-10-02T00:01:00.000Z' },
    ])
    const first = await listComments(d, 'content-1', null, 1, publishedContext())
    expect(first.nextCursor).toEqual(expect.any(String))
    const before = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    await expect(listComments(d, 'content-2', first.nextCursor, 20, publishedContext('content-2'))).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(before)
  })

  it('rejects comment cursors reused across viewer visibility scopes', async () => {
    const d = db([], [
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', parent_id: null, body: 'one', state: 'PUBLISHED', depth: 0, created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' },
      { id: 'c2', content_id: 'content-1', author_user_id: 'user-2', parent_id: null, body: 'two', state: 'PUBLISHED', depth: 0, created_at: '2026-10-02T00:01:00.000Z', updated_at: '2026-10-02T00:01:00.000Z' },
    ])
    const first = await listComments(d, 'content-1', null, 1, publishedContext(), 'viewer-1')
    expect(first.nextCursor).toEqual(expect.any(String))
    const before = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    await expect(listComments(d, 'content-1', first.nextCursor, 20, publishedContext(), 'viewer-2')).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(before)
  })

  it('applies the viewer Block and Mute policy to comment roots and replies', async () => {
    const d = db([], [{
      results: [{
        id: 'c1',
        content_id: 'content-1',
        author_user_id: 'user-2',
        parent_id: null,
        body: '公开评论',
        state: 'PUBLISHED',
        depth: 0,
        created_at: '2026-10-03T00:00:00.000Z',
        updated_at: '2026-10-03T00:00:00.000Z',
      }],
    }])

    await expect(listComments(d, 'content-1', null, 20, publishedContext(), 'viewer-1')).resolves.toMatchObject({
      items: [{ id: 'c1' }],
    })

    const sql = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(sql).toContain("block.relation_type = 'block'")
    expect(sql).toContain("mute.relation_type = 'mute'")
    expect(sql).toContain('block.actor_user_id = ? AND block.target_user_id = c.author_user_id')
    expect(sql).toContain('block.actor_user_id = c.author_user_id AND block.target_user_id = ?')
    expect(sql).toContain('mute.actor_user_id = ?')
    expect(sql).toContain('mute.target_user_id = c.author_user_id')
    expect(sql).toContain("child.author_user_id")
  })

  it('rejects mismatched or unpublished canonical context before querying W05', async () => {
    const d = db([], [])
    await expect(listComments(d, 'content-1', null, 20, {
      ...publishedContext(),
      contentId: 'another-content',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(listComments(d, 'content-1', null, 20, {
      ...publishedContext(),
      state: 'UNPUBLISHED',
    } as unknown as PublishedContentSocialContext)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(d.prepare).not.toHaveBeenCalled()
  })

  it('parses the supported comment sort modes and rejects unknown values', () => {
    expect(parseCommentSort(null)).toBe('relevant')
    expect(parseCommentSort('recent')).toBe('recent')
    expect(parseCommentSort('liked')).toBe('liked')
    let invalidSortError: unknown
    try {
      parseCommentSort('random')
    } catch (error) {
      invalidSortError = error
    }
    expect(invalidSortError).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('applies the recent and liked sort at the W05 query boundary', async () => {
    const recentDb = db([], [])
    await listComments(recentDb, 'content-1', null, 20, publishedContext(), null, 'recent')
    const recentSql = String((recentDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(recentSql).toContain('ORDER BY c.thread_created_at DESC, c.thread_id DESC, c.created_at ASC, c.id ASC')

    const likedDb = db([], [])
    await listComments(likedDb, 'content-1', null, 20, publishedContext(), null, 'liked')
    const likedSql = String((likedDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(likedSql).toContain('ORDER BY c.thread_like_count DESC, c.thread_created_at DESC, c.thread_id DESC, c.created_at ASC, c.id ASC')
    expect(likedSql).toContain('AS thread_like_count')
  })

  it('binds viewer visibility placeholders without extra parameters when sorted', async () => {
    const d = db([], [])
    await listComments(d, 'content-1', null, 20, publishedContext(), 'viewer-1', 'recent')
    const prepared = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value
    const bound = prepared?.bind as ReturnType<typeof vi.fn>
    expect(bound).toHaveBeenCalledTimes(1)
    const sql = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    const placeholderCount = (sql.match(/\?/g) ?? []).length
    const boundCount = bound.mock.calls[0]?.length ?? 0
    expect(boundCount).toBe(placeholderCount)
  })

  it('keeps liked-sort cursors stable and bound to the selected sort', async () => {
    const row = (id: string, likeCount: number, createdAt: string) => ({
      id,
      content_id: 'content-1',
      author_user_id: 'author-1',
      parent_id: null,
      body: 'comment',
      state: 'PUBLISHED' as const,
      depth: 0,
      created_at: createdAt,
      updated_at: createdAt,
      like_count: likeCount,
      liked_by_viewer: 0,
      thread_created_at: createdAt,
      thread_id: id,
      thread_like_count: likeCount,
    })
    const first = db([], [
      row('comment-a', 7, '2026-10-03T00:00:00.000Z'),
      row('comment-b', 3, '2026-10-02T00:00:00.000Z'),
    ])
    const page = await listComments(first, 'content-1', null, 1, publishedContext(), null, 'liked')
    expect(page.items.map((item) => item.id)).toEqual(['comment-a'])
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBeTruthy()

    const next = db([], [])
    await listComments(next, 'content-1', page.nextCursor, 1, publishedContext(), null, 'liked')
    const nextSql = String((next.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(nextSql).toContain('c.thread_like_count < ?')
    expect(nextSql).toContain('c.thread_like_count = ?')
    await expect(
      listComments(next, 'content-1', page.nextCursor, 1, publishedContext(), null, 'recent'),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
  })

  it('validates comment page limits', () => {
    expect(parseCommentLimit(null)).toBe(20)
    expect(parseCommentLimit('50')).toBe(50)
    expect(() => parseCommentLimit('0')).toThrow()
    expect(() => parseCommentLimit('51')).toThrow()
  })
})

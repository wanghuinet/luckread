/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createComment, deleteComment, listComments, parseCommentLimit, updateComment } from './comment-runtime.js'

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

    await expect(deleteComment(d, 'user-1', 'c-deleted')).resolves.toBe('content-1')
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
    }))

    await expect(createComment(d, 'user-1', 'content-1', {
      body: '并发屏蔽期间的评论',
      idempotencyKey: 'block-race-1',
    })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
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

    await expect(deleteComment(d, 'user-1', 'c1')).resolves.toBe('content-1')
    expect(prepare).toHaveBeenCalledTimes(3)
  })

  it('keeps comment deletion atomic against a concurrent reply', async () => {
    const d = db([
      { id: 'c1', author_user_id: 'user-1', state: 'PUBLISHED', has_replies: 0 },
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

    await expect(deleteComment(d, 'user-1', 'c1')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })

  it('deletes an owned leaf comment', async () => {
    const d = db([
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', state: 'PUBLISHED', has_replies: 0 },
    ])
    await expect(deleteComment(d, 'user-1', 'c1')).resolves.toBe('content-1')
    expect(d.prepare).toHaveBeenCalledTimes(2)
  })

  it('keeps author deletion idempotent for an existing tombstone', async () => {
    const d = db([
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', state: 'AUTHOR_DELETED', has_replies: 0 },
    ])

    await expect(deleteComment(d, 'user-1', 'c1')).resolves.toBe('content-1')
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('rejects deleting another user comment', async () => {
    const d = db([
      { id: 'c1', author_user_id: 'user-2', state: 'PUBLISHED', has_replies: 0 },
    ])
    await expect(deleteComment(d, 'user-1', 'c1')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    })
  })

  it('rejects deleting comments that have replies', async () => {
    const d = db([
      { id: 'c1', author_user_id: 'user-1', state: 'PUBLISHED', has_replies: 1 },
    ])
    await expect(deleteComment(d, 'user-1', 'c1')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })

  it('updates an owned published comment with the matching version', async () => {
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

    await expect(updateComment(d, 'user-1', 'c1', {
      body: '修改后',
      ifMatch: '"2026-10-02T00:01:00.000Z"',
    })).resolves.toMatchObject({
      item: { id: 'c1', body: '修改后' },
      etag: '"2026-10-02T00:02:00.000Z"',
    })
    expect(d.prepare).toHaveBeenCalledTimes(2)
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

    await expect(updateComment(d, 'user-1', 'c1', {
      body: '越权修改',
      ifMatch: '"2026-10-02T00:01:00.000Z"',
    })).rejects.toMatchObject({
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

    await expect(updateComment(d, 'user-1', 'c1', {
      body: '旧版本修改',
      ifMatch: '"2026-10-02T00:01:00.000Z"',
    })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      status: 412,
    })
  })

  it('requires a valid If-Match header value', async () => {
    const d = db()
    await expect(updateComment(d, 'user-1', 'c1', {
      body: '修改',
      ifMatch: '',
    })).rejects.toMatchObject({
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
    const page = await listComments(d, 'content-1', null, 2)
    expect(page.items).toHaveLength(2)
    expect(page.items[0].id).toBe('c1')
    expect(page.items[0].authorUserId).toBe('user-1')
    expect(page.items[1].id).toBe('c2')
    expect(page.items[1].authorUserId).toBe('user-2')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
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

    await expect(listComments(d, 'content-1', null, 20, 'viewer-1')).resolves.toMatchObject({
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

  it('validates comment page limits', () => {
    expect(parseCommentLimit(null)).toBe(20)
    expect(parseCommentLimit('50')).toBe(50)
    expect(() => parseCommentLimit('0')).toThrow()
    expect(() => parseCommentLimit('51')).toThrow()
  })
})

/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createComment, listComments, parseCommentLimit } from './comment-runtime.js'

const db = (firstResults: unknown[] = [], allResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      all: vi.fn(async () => ({ results: allResults })),
      run: vi.fn(async () => ({ success: true })),
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

  it('validates comment page limits', () => {
    expect(parseCommentLimit(null)).toBe(20)
    expect(parseCommentLimit('50')).toBe(50)
    expect(() => parseCommentLimit('0')).toThrow()
    expect(() => parseCommentLimit('51')).toThrow()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createComment, deleteComment, listComments, parseCommentLimit, parseCommentSort, updateComment } from './comment-runtime.js'
import { buildCommentListReadQuery, type CommentListReadStore } from './comment-list-read-store.js'
import type { CommentCreateStore, CommentCreateValidation, StoredCommentCreate } from './comment-create-store.js'
import type { CommentMutationStore, CommentDeleteRow, CommentUpdateRow, CommentMutationState } from './comment-mutation-store.js'
import type { PublishedContentSocialContext, W03ContentBinding } from './w03-content-context-client.js'

const publishedContext = (contentId = 'content-1'): PublishedContentSocialContext => ({
  contentId, ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z',
})
const publishedBinding = (): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const contentId = decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).at(-2) ?? '')
    return Response.json({ data: publishedContext(contentId) })
  }),
})
const defaultValidation: CommentCreateValidation = {
  existing_id: null, existing_content_id: null, existing_parent_id: null, existing_body: null,
  existing_author_user_id: null, existing_state: null, existing_depth: null,
  existing_created_at: null, existing_updated_at: null,
  content_state: 'PUBLISHED', content_owner_user_id: 'owner-1',
  parent_content_id: null, parent_author_user_id: null, parent_state: null, parent_depth: null,
  recent_count: 0, blocked: false, reply_audience_allowed: true,
}
const createdRow = (input: Parameters<CommentCreateStore['insert']>[0]): StoredCommentCreate => ({
  id: input.id, content_id: input.contentId, author_user_id: input.actorUserId, parent_id: input.parentId,
  body: input.body, state: 'PUBLISHED', depth: input.depth, created_at: input.now, updated_at: input.now,
})
const createStoreFor = (options: {
  validation?: CommentCreateValidation | null
  inserted?: StoredCommentCreate | null
  finalState?: { content_state: string; reply_audience_allowed: number | boolean } | null
} = {}): CommentCreateStore => ({
  validate: vi.fn(async () => options.validation === undefined ? defaultValidation : options.validation),
  insert: vi.fn(async (input) => options.inserted === undefined ? createdRow(input) : options.inserted),
  getFinalState: vi.fn(async () => options.finalState === undefined
    ? { content_state: 'PUBLISHED', reply_audience_allowed: true }
    : options.finalState),
})
const deleteRow = (overrides: Partial<CommentDeleteRow> = {}): CommentDeleteRow => ({
  id: 'comment-1', content_id: 'content-1', author_user_id: 'user-1', state: 'PUBLISHED', has_replies: false, ...overrides,
})
const updateRow = (overrides: Partial<CommentUpdateRow> = {}): CommentUpdateRow => ({
  id: 'comment-1', content_id: 'content-1', author_user_id: 'user-1', parent_id: null,
  body: 'before', state: 'PUBLISHED', depth: 0,
  created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:01:00.000Z', ...overrides,
})
const mutationStoreFor = (options: {
  deleteRow?: CommentDeleteRow | null
  markedDeleted?: boolean
  deleteState?: CommentMutationState | null
  updateRow?: CommentUpdateRow | null
  updatedRow?: CommentUpdateRow | null
} = {}): CommentMutationStore => ({
  getForDelete: vi.fn(async () => options.deleteRow === undefined ? deleteRow() : options.deleteRow),
  markDeleted: vi.fn(async () => options.markedDeleted ?? true),
  getDeleteState: vi.fn(async () => options.deleteState ?? null),
  getForUpdate: vi.fn(async () => options.updateRow === undefined ? updateRow() : options.updateRow),
  update: vi.fn(async (input) => options.updatedRow === undefined
    ? updateRow({ body: input.body, updated_at: input.now })
    : options.updatedRow),
})
// Query-builder fixture for CommentListReadStore. It captures generated PostgreSQL SQL
// for pagination assertions; the runtime itself only sees the Store.list contract.
const db = (_firstResults: unknown[] = [], allResults: unknown[] = []) => {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: allResults, sql, args })),
    })),
  }))
  const fixture: CommentListReadStore & { prepare: ReturnType<typeof vi.fn> } = {
    prepare,
    async list(input) {
      const { sql, values } = buildCommentListReadQuery(input)
      const result = await prepare(sql).bind(...values).all()
      const first = result.results[0] as { results?: unknown[] } | undefined
      return (first && Array.isArray(first.results) ? first.results : allResults) as never
    },
  }
  return fixture
}

describe('W05 comment create runtime — Store port only', () => {
  it('creates a published root comment after one validation read', async () => {
    const store = createStoreFor()
    await expect(createComment(store, 'user-1', 'content-1', { body: '你好', idempotencyKey: 'idem-1' }))
      .resolves.toMatchObject({ contentId: 'content-1', authorUserId: 'user-1', parentId: null, state: 'PUBLISHED', depth: 0 })
    expect(store.validate).toHaveBeenCalledTimes(1)
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1', contentId: 'content-1', body: '你好', depth: 0 }))
  })

  it('returns the existing comment for an idempotent retry before rate-limit checks', async () => {
    const store = createStoreFor({ validation: {
      ...defaultValidation, existing_id: 'comment-existing', existing_content_id: 'content-1',
      existing_parent_id: null, existing_body: 'same', existing_author_user_id: 'user-1',
      existing_state: 'PUBLISHED', existing_depth: 0, existing_created_at: '2026-10-02T00:00:00.000Z',
      existing_updated_at: '2026-10-02T00:01:00.000Z', recent_count: 99,
    } })
    await expect(createComment(store, 'user-1', 'content-1', { body: 'same', idempotencyKey: 'idem-retry' }))
      .resolves.toMatchObject({ id: 'comment-existing', body: 'same' })
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('rejects an idempotency key reused with a different comment payload', async () => {
    const store = createStoreFor({ validation: {
      ...defaultValidation, existing_id: 'comment-existing', existing_content_id: 'content-1',
      existing_parent_id: null, existing_body: 'original', existing_author_user_id: 'user-1',
      existing_state: 'PUBLISHED', existing_depth: 0,
    } })
    await expect(createComment(store, 'user-1', 'content-1', { body: 'different', idempotencyKey: 'idem-reuse' }))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('replays an author-deleted idempotency tombstone as the original published result', async () => {
    const store = createStoreFor({ validation: {
      ...defaultValidation, existing_id: 'comment-deleted', existing_content_id: 'content-1',
      existing_parent_id: null, existing_body: 'same', existing_author_user_id: 'user-1',
      existing_state: 'AUTHOR_DELETED', existing_depth: 0,
    } })
    await expect(createComment(store, 'user-1', 'content-1', { body: 'same', idempotencyKey: 'idem-deleted' }))
      .resolves.toMatchObject({ id: 'comment-deleted', state: 'PUBLISHED' })
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('rejects unpublished, blocked, audience-denied and rate-limited comments before insert', async () => {
    for (const validation of [
      { ...defaultValidation, content_state: 'DRAFT' },
      { ...defaultValidation, blocked: true },
      { ...defaultValidation, reply_audience_allowed: false },
      { ...defaultValidation, recent_count: 10 },
    ]) {
      const store = createStoreFor({ validation })
      await expect(createComment(store, 'user-1', 'content-1', { body: 'not allowed', idempotencyKey: 'idem-denied' }))
        .rejects.toBeInstanceOf(Error)
      expect(store.insert).not.toHaveBeenCalled()
    }
  })

  it('creates a nested reply only while the parent depth is below three and belongs to the same content', async () => {
    const store = createStoreFor({ validation: {
      ...defaultValidation, parent_content_id: 'content-1', parent_state: 'PUBLISHED', parent_depth: 2,
    } })
    await expect(createComment(store, 'user-1', 'content-1', {
      body: 'nested', parentId: 'parent-1', idempotencyKey: 'nested-1',
    })).resolves.toMatchObject({ parentId: 'parent-1', depth: 3 })
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'parent-1', depth: 3 }))
    const wrongParent = createStoreFor({ validation: {
      ...defaultValidation, parent_content_id: 'another-content', parent_state: 'PUBLISHED', parent_depth: 1,
    } })
    await expect(createComment(wrongParent, 'user-1', 'content-1', {
      body: 'wrong parent', parentId: 'parent-2', idempotencyKey: 'nested-2',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(wrongParent.insert).not.toHaveBeenCalled()
  })

  it('rechecks publication and reply audience after a final insert loses a race', async () => {
    const unpublished = createStoreFor({ inserted: null, finalState: null })
    await expect(createComment(unpublished, 'user-1', 'content-1', { body: 'race', idempotencyKey: 'race-1' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    const denied = createStoreFor({ inserted: null, finalState: { content_state: 'PUBLISHED', reply_audience_allowed: false } })
    await expect(createComment(denied, 'user-1', 'content-1', { body: 'race', idempotencyKey: 'race-2' }))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    const blocked = createStoreFor({ inserted: null, finalState: { content_state: 'PUBLISHED', reply_audience_allowed: true } })
    await expect(createComment(blocked, 'user-1', 'content-1', { body: 'race', idempotencyKey: 'race-3' }))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('maps Store failures to sanitized runtime errors', async () => {
    const store: CommentCreateStore = {
      validate: vi.fn(async () => { throw new Error('private connection details') }),
      insert: vi.fn(async () => null),
      getFinalState: vi.fn(async () => null),
    }
    await expect(createComment(store, 'user-1', 'content-1', { body: 'x', idempotencyKey: 'store-error' }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 })
  })
})

describe('W05 comment mutation runtime — Store port only', () => {
  it('deletes an owned leaf comment after W03 publication validation', async () => {
    const store = mutationStoreFor()
    const binding = publishedBinding()
    await expect(deleteComment(store, binding, 'user-1', 'comment-1', 'comment-delete'))
      .resolves.toBe('content-1')
    expect(store.getForDelete).toHaveBeenCalledWith('comment-1')
    expect(store.markDeleted).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'comment-1', actorUserId: 'user-1' }))
    expect(binding.fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps author tombstone deletion idempotent without requiring W03 after the original delete', async () => {
    const store = mutationStoreFor({ deleteRow: deleteRow({ state: 'AUTHOR_DELETED' }) })
    await expect(deleteComment(store, undefined, 'user-1', 'comment-1', 'comment-delete'))
      .resolves.toBe('content-1')
    expect(store.markDeleted).not.toHaveBeenCalled()
  })

  it('rejects deleting another author comment, non-published comments and comments with replies', async () => {
    await expect(deleteComment(mutationStoreFor({ deleteRow: deleteRow({ author_user_id: 'other-user' }) }), publishedBinding(), 'user-1', 'comment-1', 'corr'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    await expect(deleteComment(mutationStoreFor({ deleteRow: deleteRow({ state: 'PENDING' }) }), publishedBinding(), 'user-1', 'comment-1', 'corr'))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
    await expect(deleteComment(mutationStoreFor({ deleteRow: deleteRow({ has_replies: true }) }), publishedBinding(), 'user-1', 'comment-1', 'corr'))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('fails closed before marking a comment deleted when W03 publication context is unavailable', async () => {
    const store = mutationStoreFor()
    await expect(deleteComment(store, undefined, 'user-1', 'comment-1', 'corr'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(store.markDeleted).not.toHaveBeenCalled()
  })

  it('treats a concurrent author tombstone as idempotent and rejects other lost delete races', async () => {
    const replay = mutationStoreFor({ markedDeleted: false, deleteState: 'AUTHOR_DELETED' })
    await expect(deleteComment(replay, publishedBinding(), 'user-1', 'comment-1', 'corr')).resolves.toBe('content-1')
    const conflict = mutationStoreFor({ markedDeleted: false, deleteState: null })
    await expect(deleteComment(conflict, publishedBinding(), 'user-1', 'comment-1', 'corr'))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('updates an owned published comment with the matching ETag and Store compare-and-swap', async () => {
    const store = mutationStoreFor({ updatedRow: updateRow({ body: 'after', updated_at: '2026-10-02T00:02:00.000Z' }) })
    const binding = publishedBinding()
    await expect(updateComment(store, binding, 'user-1', 'comment-1', {
      body: 'after', ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'comment-update')).resolves.toMatchObject({
      item: { id: 'comment-1', body: 'after' }, etag: '"2026-10-02T00:02:00.000Z"',
    })
    expect(store.update).toHaveBeenCalledWith(expect.objectContaining({
      commentId: 'comment-1', actorUserId: 'user-1', body: 'after', expectedUpdatedAt: '2026-10-02T00:01:00.000Z',
    }))
    expect(binding.fetch).toHaveBeenCalledTimes(1)
  })

  it('fails closed when W03 cannot validate the content before comment update', async () => {
    const store = mutationStoreFor()
    await expect(updateComment(store, undefined, 'user-1', 'comment-1', {
      body: 'after', ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'comment-update')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('rejects updates from another author, stale versions, and invalid If-Match values', async () => {
    await expect(updateComment(mutationStoreFor({ updateRow: updateRow({ author_user_id: 'other-user' }) }), publishedBinding(), 'user-1', 'comment-1', {
      body: 'after', ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'corr')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    await expect(updateComment(mutationStoreFor({ updateRow: updateRow({ updated_at: '2026-10-02T00:02:00.000Z' }) }), publishedBinding(), 'user-1', 'comment-1', {
      body: 'different', ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'corr')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
    await expect(updateComment(mutationStoreFor(), publishedBinding(), 'user-1', 'comment-1', {
      body: 'after', ifMatch: '',
    }, 'corr')).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 })
  })

  it('replays a comment edit after the response was lost without issuing a second update', async () => {
    const store = mutationStoreFor({ updateRow: updateRow({ body: 'already saved', updated_at: '2026-10-02T00:02:00.000Z' }) })
    await expect(updateComment(store, publishedBinding(), 'user-1', 'comment-1', {
      body: 'already saved', ifMatch: '"2026-10-02T00:01:00.000Z"',
    }, 'corr')).resolves.toMatchObject({ item: { body: 'already saved' }, etag: '"2026-10-02T00:02:00.000Z"' })
    expect(store.update).not.toHaveBeenCalled()
  })

  it('maps mutation Store failures to sanitized 500 responses', async () => {
    const store: CommentMutationStore = {
      getForDelete: vi.fn(async () => { throw new Error('private database host') }),
      markDeleted: vi.fn(async () => false),
      getDeleteState: vi.fn(async () => null),
      getForUpdate: vi.fn(async () => null),
      update: vi.fn(async () => null),
    }
    await expect(deleteComment(store, publishedBinding(), 'user-1', 'comment-1', 'corr'))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 })
  })
})

describe('W05 comment list runtime', () => {
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

  it('maps rows from an injected PostgreSQL comment list store without accessing D1', async () => {
    const rows = [{
      id: 'pg-comment-1',
      content_id: 'content-1',
      author_user_id: 'author-1',
      parent_id: null,
      body: 'PostgreSQL comment',
      state: 'PUBLISHED' as const,
      depth: 0,
      created_at: '2026-11-11T10:00:00.123456Z',
      updated_at: '2026-11-11T10:00:00.123456Z',
      mentions_json: '[{"userId":"mentioned-1","handle":"alice"}]',
      liked_by_viewer: true,
      thread_created_at: '2026-11-11T10:00:00.123456Z',
      thread_id: 'pg-comment-1',
      thread_like_count: '3',
    }]
    const store = {
      async list(input: {
        contentId: string
        viewerUserId: string | null
        cursor: { createdAt: string; id: string; threadCreatedAt?: string; threadId?: string; threadLikeCount?: number } | null
        limit: number
        sort: 'relevant' | 'recent' | 'liked'
      }) {
        expect(input).toEqual({
          contentId: 'content-1',
          viewerUserId: 'viewer-1',
          cursor: null,
          limit: 20,
          sort: 'liked',
        })
        return rows
      },
    }

    await expect(listComments(store, 'content-1', null, 20, publishedContext(), 'viewer-1', 'liked'))
      .resolves.toMatchObject({
        items: [{
          id: 'pg-comment-1',
          createdAt: '2026-11-11T10:00:00.123456Z',
          mentions: [{ userId: 'mentioned-1', handle: 'alice' }],
          likedByViewer: true,
        }],
        hasMore: false,
        nextCursor: null,
      })
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
    expect(sql).toContain('WITH RECURSIVE viewer AS (SELECT $1::text AS user_id)')
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
    expect(sql).toContain('block.actor_user_id = $3 AND block.target_user_id = c.author_user_id')
    expect(sql).toContain('block.actor_user_id = c.author_user_id AND block.target_user_id = $4')
    expect(sql).toContain('mute.actor_user_id = $5')
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
    const placeholderCount = (sql.match(/\$\d+/g) ?? []).length
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
    expect(nextSql).toContain('c.thread_like_count < $')
    expect(nextSql).toContain('c.thread_like_count = $')
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

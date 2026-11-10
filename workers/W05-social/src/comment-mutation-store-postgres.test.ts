import { describe, expect, it, vi } from 'vitest'
import { createPostgresCommentMutationStore } from './comment-mutation-store-postgres.js'
import type { CommentMutationPostgresQueryExecutor } from './comment-mutation-store-postgres.js'

describe('W05 PostgreSQL comment mutation store', () => {
  it('loads deletion state and child existence from W05-owned comments only', async () => {
    const row = {
      id: 'comment-1',
      content_id: 'content-1',
      author_user_id: 'actor-1',
      state: 'PUBLISHED',
      has_replies: false,
    }
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresCommentMutationStore({ query } as unknown as CommentMutationPostgresQueryExecutor)

    await expect(store.getForDelete('comment-1')).resolves.toEqual(row)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('FROM social_comments child')
    expect(String(sql)).toContain('child.parent_id = c.id')
    expect(String(sql)).not.toMatch(/\b(?:FROM|JOIN)\s+contents\b/i)
    expect(values).toEqual(['comment-1'])
  })

  it('marks only an owned published leaf comment as author-deleted', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ id: 'comment-1' }] }))
    const store = createPostgresCommentMutationStore({ query } as unknown as CommentMutationPostgresQueryExecutor)

    await expect(store.markDeleted({
      commentId: 'comment-1',
      actorUserId: 'actor-1',
      now: '2026-11-10T12:00:00.000Z',
    })).resolves.toBe(true)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain("state = 'AUTHOR_DELETED'")
    expect(String(sql)).toContain("state = 'PUBLISHED'")
    expect(String(sql)).toContain('NOT EXISTS')
    expect(String(sql)).toContain('child.parent_id = social_comments.id')
    expect(values).toEqual(['2026-11-10T12:00:00.000Z', 'comment-1', 'actor-1'])
  })

  it('re-reads the post-race deletion state scoped to the author', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ state: 'AUTHOR_DELETED' }] }))
    const store = createPostgresCommentMutationStore({ query } as unknown as CommentMutationPostgresQueryExecutor)

    await expect(store.getDeleteState('comment-1', 'actor-1')).resolves.toBe('AUTHOR_DELETED')
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('author_user_id = $2')
    expect(values).toEqual(['comment-1', 'actor-1'])
  })

  it('loads edit state with stable millisecond UTC timestamps', async () => {
    const row = {
      id: 'comment-1',
      content_id: 'content-1',
      author_user_id: 'actor-1',
      parent_id: null,
      body: 'before',
      state: 'PUBLISHED',
      depth: 0,
      created_at: '2026-11-10T11:00:00.123Z',
      updated_at: '2026-11-10T11:00:00.456Z',
    }
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresCommentMutationStore({ query } as unknown as CommentMutationPostgresQueryExecutor)

    await expect(store.getForUpdate('comment-1')).resolves.toEqual(row)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('to_char(updated_at AT TIME ZONE')
    expect(values).toEqual(['comment-1'])
  })

  it('uses an author/state/version compare-and-swap for comment edits', async () => {
    const row = {
      id: 'comment-1',
      content_id: 'content-1',
      author_user_id: 'actor-1',
      parent_id: null,
      body: 'after',
      state: 'PUBLISHED',
      depth: 0,
      created_at: '2026-11-10T11:00:00.123Z',
      updated_at: '2026-11-10T12:00:00.000Z',
    }
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresCommentMutationStore({ query } as unknown as CommentMutationPostgresQueryExecutor)

    await expect(store.update({
      commentId: 'comment-1',
      actorUserId: 'actor-1',
      body: 'after',
      now: '2026-11-10T12:00:00.000Z',
      expectedUpdatedAt: '2026-11-10T11:00:00.456Z',
    })).resolves.toEqual(row)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain("state = 'PUBLISHED'")
    expect(String(sql)).toContain('updated_at = $5::timestamptz')
    expect(String(sql)).toContain('RETURNING')
    expect(values).toEqual([
      'after',
      '2026-11-10T12:00:00.000Z',
      'comment-1',
      'actor-1',
      '2026-11-10T11:00:00.456Z',
    ])
  })

  it('returns null when the edit compare-and-swap loses a race', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresCommentMutationStore({ query } as unknown as CommentMutationPostgresQueryExecutor)

    await expect(store.update({
      commentId: 'comment-1',
      actorUserId: 'actor-1',
      body: 'after',
      now: '2026-11-10T12:00:00.000Z',
      expectedUpdatedAt: '2026-11-10T11:00:00.456Z',
    })).resolves.toBeNull()
  })

  it('sanitizes all PostgreSQL provider failures', async () => {
    const store = createPostgresCommentMutationStore({
      query: vi.fn(async (_sql: string, _values?: unknown[]) => { throw new Error('secret host, password and query') }),
    } as unknown as CommentMutationPostgresQueryExecutor)

    await expect(store.getForDelete('comment-1')).rejects.toMatchObject({ message: 'COMMENT_MUTATION_STORE_UNAVAILABLE' })
    await expect(store.markDeleted({
      commentId: 'comment-1', actorUserId: 'actor-1', now: '2026-11-10T12:00:00.000Z',
    })).rejects.toMatchObject({ message: 'COMMENT_MUTATION_STORE_UNAVAILABLE' })
    await expect(store.getDeleteState('comment-1', 'actor-1')).rejects.toMatchObject({ message: 'COMMENT_MUTATION_STORE_UNAVAILABLE' })
    await expect(store.getForUpdate('comment-1')).rejects.toMatchObject({ message: 'COMMENT_MUTATION_STORE_UNAVAILABLE' })
    await expect(store.update({
      commentId: 'comment-1', actorUserId: 'actor-1', body: 'after',
      now: '2026-11-10T12:00:00.000Z', expectedUpdatedAt: '2026-11-10T11:00:00.456Z',
    })).rejects.toMatchObject({ message: 'COMMENT_MUTATION_STORE_UNAVAILABLE' })
  })
})

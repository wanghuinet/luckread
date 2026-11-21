import { describe, expect, it, vi } from 'vitest'
import { createPostgresLikeTargetContextReadStore } from './like-target-context-read-store-postgres.js'
import type { LikeTargetContextPostgresQueryExecutor } from './like-target-context-read-store-postgres.js'

function executor(rows: unknown[] = []) {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: rows as Record<string, unknown>[] }))
  const store = createPostgresLikeTargetContextReadStore({ query } as unknown as LikeTargetContextPostgresQueryExecutor)
  return { query, store }
}

describe('PostgreSQL like target context read store', () => {
  it('reads only the comment context fields with a positional parameter', async () => {
    const { query, store } = executor([{
      id: 'comment-1',
      state: 'PUBLISHED',
      author_user_id: 'author-1',
      content_id: 'content-1',
    }])
    await expect(store.readCommentTarget('comment-1')).resolves.toMatchObject({
      id: 'comment-1',
      state: 'PUBLISHED',
      author_user_id: 'author-1',
      content_id: 'content-1',
    })
    expect(query.mock.calls[0]?.[0]).toContain('WHERE id = $1')
    expect(query.mock.calls[0]?.[1]).toEqual(['comment-1'])
    expect(query.mock.calls[0]?.[0]).not.toContain('?')
  })

  it('checks both Block directions using deduplicated positional parameters', async () => {
    const { query, store } = executor([{ blocked: true }])
    await expect(store.hasBidirectionalBlock('actor-1', [
      'author-1', 'parent-owner-1', 'author-1', 'actor-1',
    ])).resolves.toBe(true)
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('block.actor_user_id = $1')
    expect(sql).toContain('block.target_user_id IN ($2, $3)')
    expect(sql).toContain('block.target_user_id = $4')
    expect(sql).toContain('block.actor_user_id IN ($5, $6)')
    expect(values).toEqual([
      'actor-1', 'author-1', 'parent-owner-1',
      'actor-1', 'author-1', 'parent-owner-1',
    ])
  })

  it('does not issue a query when there are no other related users', async () => {
    const { query, store } = executor()
    await expect(store.hasBidirectionalBlock('actor-1', ['actor-1'])).resolves.toBe(false)
    expect(query).not.toHaveBeenCalled()
  })

  it('sanitizes PostgreSQL provider errors', async () => {
    const query = vi.fn(async () => { throw new Error('password=secret SQL=...') })
    const store = createPostgresLikeTargetContextReadStore({ query } as unknown as LikeTargetContextPostgresQueryExecutor)
    await expect(store.readCommentTarget('comment-1')).rejects.toThrow('LIKE_TARGET_CONTEXT_READ_UNAVAILABLE')
    await expect(store.hasBidirectionalBlock('actor-1', ['owner-1'])).rejects.toThrow('LIKE_TARGET_CONTEXT_READ_UNAVAILABLE')
  })
})

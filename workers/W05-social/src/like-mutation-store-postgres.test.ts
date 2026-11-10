import { describe, expect, it, vi } from 'vitest'
import { createPostgresLikeMutationStore } from './like-mutation-store-postgres.js'
import type { LikeMutationPostgresQueryExecutor } from './like-mutation-store-postgres.js'
import { LikeMutationStoreError } from './like-mutation-store.js'

const saved = {
  relationship_id: 'like-1',
  actor_user_id: 'actor-1',
  target_type: 'content' as const,
  target_id: 'content-1',
  created_at: '2026-11-10T00:00:00.000Z',
}

const executor = (rows: unknown[] = []) => {
  let index = 0
  const query = vi.fn(async () => ({ rows: [rows[index++] ?? null].filter(Boolean) }))
  return { query, store: createPostgresLikeMutationStore({ query } as unknown as LikeMutationPostgresQueryExecutor) }
}

describe('PostgreSQL like mutation store', () => {
  it('inserts a content like with final published and bidirectional Block guards', async () => {
    const { query, store } = executor([saved])
    await expect(store.create({
      relationshipId: 'new-like-id',
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: '2026-11-10T00:00:00.000Z',
    })).resolves.toEqual(saved)

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain("c.state = 'PUBLISHED'")
    expect(sql).toContain("block.relation_type = 'block'")
    expect(sql).toContain('ON CONFLICT (actor_user_id, target_type, target_id)')
    expect(sql).toContain('RETURNING relationship_id')
    expect(sql).not.toMatch(/(?:FROM|JOIN)\\s+social_comments/i)
    expect(values).toEqual([
      'new-like-id',
      'actor-1',
      '2026-11-10T00:00:00.000Z',
      'content-1',
      'actor-1',
      'actor-1',
    ])
  })

  it('inserts a comment like with comment-author and W03 parent-owner Block guards', async () => {
    const { query, store } = executor([{
      ...saved,
      target_type: 'comment',
      target_id: 'comment-1',
    }])
    await expect(store.create({
      relationshipId: 'comment-like-id',
      actorUserId: 'actor-1',
      targetType: 'comment',
      targetId: 'comment-1',
      createdAt: '2026-11-10T00:00:00.000Z',
      parentOwnerUserId: 'content-owner-1',
    })).resolves.toMatchObject({ target_type: 'comment', target_id: 'comment-1' })

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('FROM social_comments c')
    expect(sql).toContain("c.state = 'PUBLISHED'")
    expect(sql.match(/block\\.relation_type = 'block'/g)).toHaveLength(1)
    expect(sql).toContain('block.target_user_id = c.author_user_id')
    expect(values).toEqual([
      'comment-like-id',
      'actor-1',
      '2026-11-10T00:00:00.000Z',
      'comment-1',
      'actor-1',
      'actor-1',
      'actor-1',
      'content-owner-1',
      'content-owner-1',
      'actor-1',
    ])
  })

  it('returns null when the final published or Block predicate rejects the write', async () => {
    const { query, store } = executor([])
    await expect(store.create({
      relationshipId: 'new-like-id',
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'unpublished-content',
      createdAt: '2026-11-10T00:00:00.000Z',
    })).resolves.toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('removes only the actor-scoped target relationship', async () => {
    const { query, store } = executor([])
    await expect(store.remove({
      actorUserId: 'actor-1',
      targetType: 'comment',
      targetId: 'comment-1',
    })).resolves.toBeUndefined()
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toBe('DELETE FROM interaction_likes WHERE actor_user_id = $1 AND target_type = $2 AND target_id = $3')
    expect(values).toEqual(['actor-1', 'comment', 'comment-1'])
  })

  it('sanitizes provider errors for both create and remove', async () => {
    const query = vi.fn(async () => { throw new Error('password=secret host=internal; SQL failed') })
    const store = createPostgresLikeMutationStore({ query } as unknown as LikeMutationPostgresQueryExecutor)
    await expect(store.create({
      relationshipId: 'new-like-id',
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: '2026-11-10T00:00:00.000Z',
    })).rejects.toBeInstanceOf(LikeMutationStoreError)
    await expect(store.remove({
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
    })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    })
    await expect(store.remove({
      actorUserId: 'actor-1',
      targetType: 'content',
      targetId: 'content-1',
    })).rejects.not.toThrow('password=secret')
  })
})

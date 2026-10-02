/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { getLikeStatus, like, unlike } from './like-runtime.js'

const db = (firstResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ sql, args })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { getLikeStatus, like, unlike } from './like-runtime.js'

const db = (firstResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ sql, args })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

describe('like runtime', () => {
  it('reads effective like status for the actor and target', async () => {
    const existing = {
      liked: 1,
      like_count: 3,
    }
    const d = db([existing])
    await expect(getLikeStatus(d, 'user-1', { targetType: 'content', targetId: 'content-1' })).resolves.toEqual({ liked: true, likeCount: 3 })
    await expect(getLikeStatus(d, 'user-1', { targetType: 'content', targetId: 'content-2' })).resolves.toEqual({ liked: false, likeCount: 0 })
    expect(d.prepare).toHaveBeenCalledTimes(2)
    const unpublished = db([null])
    await expect(getLikeStatus(unpublished, 'user-1', { targetType: 'content', targetId: 'content-1' })).resolves.toEqual({ liked: false, likeCount: 0 })
  })


  it('creates a content like after verifying published visibility', async () => {
    const d = db([
      { id: 'content-1', state: 'PUBLISHED' },
      {
        relationship_id: 'like-1',
        actor_user_id: 'user-1',
        target_type: 'content',
        target_id: 'content-1',
        created_at: '2026-10-02T00:00:00.000Z',
      },
    ])
    await expect(like(d, 'user-1', { targetType: 'content', targetId: 'content-1' })).resolves.toEqual({
      relationshipId: 'like-1',
      actorUserId: 'user-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
    expect(d.prepare).toHaveBeenCalledTimes(2)
  })

  it('rejects likes when the content owner has blocked the actor or is blocked by the actor', async () => {
    const d = db([
      { id: 'content-1', state: 'PUBLISHED', owner_user_id: 'user-2', blocked: 1 },
    ])
    await expect(like(d, 'user-1', { targetType: 'content', targetId: 'content-1' })).rejects.toMatchObject({
      code: 'RELATIONSHIP_BLOCKED',
      status: 409,
    })
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('is idempotent for an already-liked content item', async () => {
    const existing = {
      relationship_id: 'like-existing',
      actor_user_id: 'user-1',
      target_type: 'content',
      target_id: 'content-1',
      created_at: '2026-10-02T00:00:00.000Z',
    }
    const d = db([{ id: 'content-1', state: 'PUBLISHED' }, existing])
    await expect(like(d, 'user-1', { targetType: 'content', targetId: 'content-1' })).resolves.toMatchObject({
      relationshipId: 'like-existing',
      targetId: 'content-1',
    })
  })

  it('rejects unpublished content without creating a like', async () => {
    const d = db([{ id: 'content-1', state: 'DRAFT' }])
    await expect(like(d, 'user-1', { targetType: 'content', targetId: 'content-1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported target types', async () => {
    await expect(like(db(), 'user-1', { targetType: 'comment', targetId: 'comment-1' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
  })

  it('unlikes idempotently without a read', async () => {
    await expect(unlike(db(), 'user-1', { targetType: 'content', targetId: 'content-1' })).resolves.toBeUndefined()
  })

  it('rejects invalid actor ids', async () => {
    await expect(like(db(), '', { targetType: 'content', targetId: 'content-1' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
  })
})

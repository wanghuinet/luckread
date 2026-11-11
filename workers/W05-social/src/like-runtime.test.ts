/// <reference types="@cloudflare/workers-types" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLikeStatus, like, unlike } from './like-runtime.js'
import { LikeStatusReadStoreError } from './like-status-read-store.js'
import { LikeMutationStoreError } from './like-mutation-store.js'
import type { LikeTargetContextReadStore } from './like-target-context-read-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const publishedContextBinding = (
  ownerUserId = 'user-2',
  status = 200,
): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const contentId = decodeURIComponent(new URL(request.url).pathname.split('/').at(-2) ?? '')
    if (status !== 200) return Response.json({ error: { code: 'NOT_FOUND' } }, { status })
    return Response.json({ data: {
      contentId,
      ownerUserId,
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } })
  }),
})

const correlationId = 'like-runtime-test'

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
  it('invalidates aggregate cache on like/unlike mutations', () => {
    const runtime = readFileSync(resolve(process.cwd(), 'src/like-runtime.ts'), 'utf8')
    expect(runtime).toContain('invalidateCachedLikeAggregate')
    expect(runtime).toContain('likeAggregateCacheKey(targetType, targetId)')
  })

  afterEach(() => { delete (globalThis as Record<string, unknown>).caches })

  it('validates visibility and Block policy before serving cached like state', async () => {
    const cache = {
      match: vi.fn(async (request: Request) => {
        if (request.url.includes('__social-like-viewer-state')) return Response.json({ liked: true })
        if (request.url.includes('__social-like-aggregate')) return Response.json({ likeCount: 9 })
        return undefined
      }),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    }
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })
    const d = db([{ blocked: 0 }])
    await expect(getLikeStatus(d, publishedContextBinding(), 'user-1', { targetType: 'content', targetId: 'content-hot' }, correlationId)).resolves.toEqual({ liked: true, likeCount: 9 })
    expect(d.prepare).toHaveBeenCalledTimes(1)
    expect(String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain('social_user_interactions')
  })

  it('reuses a shared aggregate without executing COUNT for another viewer', async () => {
    const cache = {
      match: vi.fn(async (request: Request) => {
        if (request.url.includes('__social-like-viewer-state')) return Response.json({ liked: false })
        if (request.url.includes('__social-like-aggregate')) return Response.json({ likeCount: 21 })
        return undefined
      }),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    }
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })
    const d = db([{ blocked: 0 }])
    await expect(getLikeStatus(d, publishedContextBinding('user-3'), 'user-2', { targetType: 'content', targetId: 'content-hot' }, correlationId)).resolves.toEqual({ liked: false, likeCount: 21 })
    expect(d.prepare).toHaveBeenCalledTimes(1)
    expect(String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain('social_user_interactions')
    expect(String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).not.toContain('COUNT(*)')
  })

  it('reads effective like status from W05 relation tables after W03 visibility validation', async () => {
    const d = db([{ blocked: 0 }, { liked: 1, like_count: 3 }])
    await expect(getLikeStatus(d, publishedContextBinding('user-2'), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId))
      .resolves.toEqual({ liked: true, likeCount: 3 })
    expect(d.prepare).toHaveBeenCalledTimes(2)
    const sql = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => String(query))
    expect(sql[0]).toContain('social_user_interactions')
    expect(sql[1]).toContain('interaction_likes')
    expect(sql.every(query => !query.toLowerCase().includes('from contents') && !query.toLowerCase().includes('join contents'))).toBe(true)

    const unpublished = db([])
    await expect(getLikeStatus(unpublished, publishedContextBinding('user-2', 404), 'user-1', { targetType: 'content', targetId: 'content-3' }, correlationId))
      .resolves.toEqual({ liked: false, likeCount: 0 })
    expect(unpublished.prepare).not.toHaveBeenCalled()
  })

  it('uses an injected like status store only after W03 visibility and Block checks', async () => {
    const d = db([{ blocked: 0 }])
    const statusStore = {
      read: vi.fn(async () => ({ liked: true, likeCount: 12 })),
    }

    await expect(getLikeStatus(
      d,
      publishedContextBinding(),
      'user-1',
      { targetType: 'content', targetId: 'content-1' },
      correlationId,
      undefined,
      statusStore,
    )).resolves.toEqual({ liked: true, likeCount: 12 })

    expect(d.prepare).toHaveBeenCalledTimes(1)
    expect(String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]))
      .toContain('social_user_interactions')
    expect(statusStore.read).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      targetType: 'content',
      targetId: 'content-1',
      includeCount: true,
    })
  })

  it('does not consult the injected status store for unpublished or Blocked targets', async () => {
    const statusStore = {
      read: vi.fn(async () => ({ liked: true, likeCount: 1 })),
    }
    await expect(getLikeStatus(
      db(),
      publishedContextBinding('user-2', 404),
      'user-1',
      { targetType: 'content', targetId: 'content-hidden' },
      correlationId,
      undefined,
      statusStore,
    )).resolves.toEqual({ liked: false, likeCount: 0 })
    expect(statusStore.read).not.toHaveBeenCalled()

    await expect(getLikeStatus(
      db([{ blocked: 1 }]),
      publishedContextBinding(),
      'user-1',
      { targetType: 'content', targetId: 'content-blocked' },
      correlationId,
      undefined,
      statusStore,
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(statusStore.read).not.toHaveBeenCalled()
  })

  it('maps injected status store failures to a sanitized 503', async () => {
    const statusStore = {
      read: vi.fn(async () => { throw new LikeStatusReadStoreError() }),
    }
    await expect(getLikeStatus(
      db([{ blocked: 0 }]),
      publishedContextBinding(),
      'user-1',
      { targetType: 'content', targetId: 'content-1' },
      correlationId,
      undefined,
      statusStore,
    )).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    })
  })

  it('hides content like status when either actor or owner is blocked', async () => {
    const d = db([{ blocked: 1 }])
    await expect(getLikeStatus(d, publishedContextBinding('user-2'), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('hides comment like status when a comment-side relationship is blocked', async () => {
    const d = db([
      { id: 'comment-1', state: 'PUBLISHED', author_user_id: 'user-2', content_id: 'content-1' },
      { blocked: 1 },
    ])
    await expect(getLikeStatus(d, publishedContextBinding('user-3'), 'user-1', { targetType: 'comment', targetId: 'comment-1' }, correlationId)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    expect(d.prepare).toHaveBeenCalledTimes(2)
  })

  it('binds the final content like write to published visibility and Block policy', async () => {
    const d = db([{ blocked: 0 }, null])
    await expect(like(d, publishedContextBinding('user-2'), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    const sql = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0])
    expect(sql).toContain("c.state = 'PUBLISHED'")
    expect(sql).toContain("block.relation_type = 'block'")
    expect(sql).toContain('NOT EXISTS')
  })

  it('creates a content like after verifying published visibility', async () => {
    const d = db([
      { blocked: 0 },
      {
        relationship_id: 'like-1',
        actor_user_id: 'user-1',
        target_type: 'content',
        target_id: 'content-1',
        created_at: '2026-10-02T00:00:00.000Z',
      },
    ])
    await expect(like(d, publishedContextBinding('user-2'), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId)).resolves.toEqual({
      relationshipId: 'like-1',
      actorUserId: 'user-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
    expect(d.prepare).toHaveBeenCalledTimes(2)
  })

  it('rejects likes when the content owner has blocked the actor or is blocked by the actor', async () => {
    const d = db([{ blocked: 1 }])
    await expect(like(d, publishedContextBinding('user-2'), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId)).rejects.toMatchObject({
      code: 'CONFLICT',
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
    const d = db([{ blocked: 0 }, existing])
    await expect(like(d, publishedContextBinding('user-2'), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId)).resolves.toMatchObject({
      relationshipId: 'like-existing',
      targetId: 'content-1',
    })
  })

  it('rejects unpublished content without creating a like', async () => {
    const d = db([])
    await expect(like(d, publishedContextBinding('user-2', 404), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    expect(d.prepare).not.toHaveBeenCalled()
  })

  it('binds the final comment like write to published visibility and Block policy', async () => {
    const d = db([
      { id: 'comment-1', state: 'PUBLISHED', author_user_id: 'user-2', content_id: 'content-1' },
      { blocked: 0 },
      null,
    ])
    await expect(like(d, publishedContextBinding('user-3'), 'user-1', { targetType: 'comment', targetId: 'comment-1' }, correlationId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    const sql = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[2]?.[0])
    expect(sql).toContain("c.state = 'PUBLISHED'")
    expect(sql).toContain("block.relation_type = 'block'")
    expect(sql).toContain('NOT EXISTS')
    expect(sql).not.toMatch(/(?:FROM|JOIN)\s+contents/i)
  })

  it('creates a like on a published comment after validating its parent content', async () => {
    const d = db([
      { id: 'comment-1', state: 'PUBLISHED', author_user_id: 'user-2', content_id: 'content-1' },
      { blocked: 0 },
      {
        relationship_id: 'comment-like-1',
        actor_user_id: 'user-1',
        target_type: 'comment',
        target_id: 'comment-1',
        created_at: '2026-10-02T00:00:00.000Z',
      },
    ])
    await expect(like(d, publishedContextBinding('user-3'), 'user-1', { targetType: 'comment', targetId: 'comment-1' }, correlationId)).resolves.toEqual({
      relationshipId: 'comment-like-1',
      actorUserId: 'user-1',
      targetType: 'comment',
      targetId: 'comment-1',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
    expect(d.prepare).toHaveBeenCalledTimes(3)
    const sql = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => String(query))
    expect(sql.every(query => !/(?:FROM|JOIN)\s+contents/i.test(query))).toBe(true)
    expect(sql[2]).toContain('FROM social_comments c')
    expect(sql[2]).toContain('block.target_user_id = ?')
  })

  it('reads like status for a published comment', async () => {
    const d = db([
      { id: 'comment-1', state: 'PUBLISHED', author_user_id: 'user-2', content_id: 'content-1' },
      { blocked: 0 },
      { liked: 1, like_count: 4 },
    ])
    await expect(getLikeStatus(d, publishedContextBinding('user-3'), 'user-1', { targetType: 'comment', targetId: 'comment-1' }, correlationId)).resolves.toEqual({
      liked: true,
      likeCount: 4,
    })
  })

  it('rejects likes on comments that are no longer public', async () => {
    const d = db([{ id: 'comment-1', state: 'REJECTED', author_user_id: 'user-2', content_id: 'content-1' }])
    await expect(like(d, publishedContextBinding('user-3'), 'user-1', { targetType: 'comment', targetId: 'comment-1' }, correlationId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
  })

  it('rejects unsupported target types', async () => {
    await expect(like(db(), undefined, 'user-1', { targetType: 'media', targetId: 'media-1' }, correlationId)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
  })

  it('invalidates viewer and aggregate caches after unlike', async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async (_request: Request) => true),
    }
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })

    const database = db()
    await expect(unlike(database, 'user-1', { targetType: 'content', targetId: 'content-1' })).resolves.toBeUndefined()

    expect(database.prepare).toHaveBeenCalledTimes(1)
    expect(String((database.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]))
      .toContain('DELETE FROM interaction_likes')
    expect(cache.delete).toHaveBeenCalledTimes(2)
    const deletedKeys = cache.delete.mock.calls.map(([request]) => request.url)
    expect(deletedKeys).toEqual(expect.arrayContaining([
      expect.stringContaining('__social-like-viewer-state?v=1&actor=user-1&type=content&id=content-1'),
      expect.stringContaining('__social-like-aggregate?v=1&type=content&id=content-1'),
    ]))
  })

  it('unlikes idempotently without a read', async () => {
    await expect(unlike(db(), 'user-1', { targetType: 'content', targetId: 'content-1' })).resolves.toBeUndefined()
  })

  it('uses an injected mutation store after W03 visibility and Block checks', async () => {
    const d = db([{ blocked: 0 }])
    const mutationStore = {
      create: vi.fn(async () => ({
        relationship_id: 'pg-like-1',
        actor_user_id: 'user-1',
        target_type: 'content' as const,
        target_id: 'content-1',
        created_at: '2026-11-10T00:00:00.000Z',
      })),
      remove: vi.fn(async () => undefined),
    }

    await expect(like(
      d,
      publishedContextBinding('user-2'),
      'user-1',
      { targetType: 'content', targetId: 'content-1' },
      correlationId,
      undefined,
      mutationStore,
    )).resolves.toMatchObject({ relationshipId: 'pg-like-1', targetId: 'content-1' })

    expect(d.prepare).toHaveBeenCalledTimes(1)
    expect(String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]))
      .toContain('social_user_interactions')
    expect(mutationStore.create).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      targetType: 'content',
      targetId: 'content-1',
    }))
  })

  it('passes the W03 parent owner into the final injected comment-like guard', async () => {
    const d = db([
      { id: 'comment-1', state: 'PUBLISHED', author_user_id: 'comment-author', content_id: 'content-1' },
      { blocked: 0 },
    ])
    const mutationStore = {
      create: vi.fn(async () => ({
        relationship_id: 'pg-comment-like-1',
        actor_user_id: 'user-1',
        target_type: 'comment' as const,
        target_id: 'comment-1',
        created_at: '2026-11-10T00:00:00.000Z',
      })),
      remove: vi.fn(async () => undefined),
    }

    await expect(like(
      d,
      publishedContextBinding('content-owner'),
      'user-1',
      { targetType: 'comment', targetId: 'comment-1' },
      correlationId,
      undefined,
      mutationStore,
    )).resolves.toMatchObject({ relationshipId: 'pg-comment-like-1' })
    expect(mutationStore.create).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'comment',
      parentOwnerUserId: 'content-owner',
    }))
  })

  it('maps a missing final guarded insert and mutation-store failures safely', async () => {
    const missingStore = {
      create: vi.fn(async () => null),
      remove: vi.fn(async () => undefined),
    }
    await expect(like(
      db([{ blocked: 0 }]),
      publishedContextBinding(),
      'user-1',
      { targetType: 'content', targetId: 'content-1' },
      correlationId,
      undefined,
      missingStore,
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const failedStore = {
      create: vi.fn(async () => { throw new LikeMutationStoreError() }),
      remove: vi.fn(async () => { throw new LikeMutationStoreError() }),
    }
    await expect(like(
      db([{ blocked: 0 }]),
      publishedContextBinding(),
      'user-1',
      { targetType: 'content', targetId: 'content-1' },
      correlationId,
      undefined,
      failedStore,
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(unlike(db(), 'user-1', { targetType: 'content', targetId: 'content-1' }, failedStore))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('uses an injected mutation store for idempotent actor-scoped removal', async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    }
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })
    const mutationStore = {
      create: vi.fn(async () => null),
      remove: vi.fn(async () => undefined),
    }
    const database = db()

    await expect(unlike(
      database,
      'user-1',
      { targetType: 'comment', targetId: 'comment-1' },
      mutationStore,
    )).resolves.toBeUndefined()

    expect(database.prepare).not.toHaveBeenCalled()
    expect(mutationStore.remove).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      targetType: 'comment',
      targetId: 'comment-1',
    })
    expect(cache.delete).toHaveBeenCalledTimes(2)
  })

  it('uses an injected target context store for comment visibility and bidirectional Block preflight', async () => {
    const database = db()
    const targetContextStore: LikeTargetContextReadStore = {
      readCommentTarget: vi.fn(async () => ({
        id: 'comment-1',
        state: 'PUBLISHED',
        author_user_id: 'comment-author',
        content_id: 'content-1',
      })),
      hasBidirectionalBlock: vi.fn(async () => false),
    }
    const mutationStore = {
      create: vi.fn(async () => ({
        relationship_id: 'like-pg-context',
        actor_user_id: 'user-1',
        target_type: 'comment' as const,
        target_id: 'comment-1',
        created_at: '2026-11-11T00:00:00.000Z',
      })),
      remove: vi.fn(async () => undefined),
    }

    await expect(like(
      database,
      publishedContextBinding('content-owner'),
      'user-1',
      { targetType: 'comment', targetId: 'comment-1' },
      correlationId,
      undefined,
      mutationStore,
      targetContextStore,
    )).resolves.toMatchObject({ relationshipId: 'like-pg-context' })

    expect(database.prepare).not.toHaveBeenCalled()
    expect(targetContextStore.readCommentTarget).toHaveBeenCalledWith('comment-1')
    expect(targetContextStore.hasBidirectionalBlock).toHaveBeenCalledWith(
      'user-1',
      ['comment-author', 'content-owner'],
    )
    expect(mutationStore.create).toHaveBeenCalledWith(expect.objectContaining({
      parentOwnerUserId: 'content-owner',
    }))
  })

  it('runs injected Block preflight before like-status storage and maps store failures to 503', async () => {
    const statusStore = {
      read: vi.fn(async () => ({ liked: true, likeCount: 2 })),
    }
    const blockedContextStore: LikeTargetContextReadStore = {
      readCommentTarget: vi.fn(async () => null),
      hasBidirectionalBlock: vi.fn(async () => true),
    }
    const database = db()
    await expect(getLikeStatus(
      database,
      publishedContextBinding(),
      'user-1',
      { targetType: 'content', targetId: 'content-1' },
      correlationId,
      undefined,
      statusStore,
      blockedContextStore,
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(statusStore.read).not.toHaveBeenCalled()
    expect(database.prepare).not.toHaveBeenCalled()

    const failedContextStore: LikeTargetContextReadStore = {
      readCommentTarget: vi.fn(async () => { throw new Error('provider credentials leaked') }),
      hasBidirectionalBlock: vi.fn(async () => false),
    }
    await expect(like(
      database,
      publishedContextBinding(),
      'user-1',
      { targetType: 'comment', targetId: 'comment-1' },
      correlationId,
      undefined,
      {
        create: vi.fn(async () => null),
        remove: vi.fn(async () => undefined),
      },
      failedContextStore,
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('rejects invalid actor ids', async () => {
    await expect(like(db(), undefined, '', { targetType: 'content', targetId: 'content-1' }, correlationId)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
  })
})

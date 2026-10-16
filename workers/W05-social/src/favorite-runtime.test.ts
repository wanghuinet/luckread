/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFavoriteStatusCacheForTests, favorite, getFavoriteStatus, listFavorites, unfavorite } from './favorite-runtime.js'

const db = (firstResults: unknown[] = [], allResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      all: vi.fn(async () => ({ results: allResults })),
      run: vi.fn(async () => ({ sql, args })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

describe('favorite runtime', () => {
  beforeEach(() => clearFavoriteStatusCacheForTests())
  it('creates a content favorite after verifying published visibility', async () => {
    const d = db([
      { id: 'content-1', state: 'PUBLISHED' },
      {
        relationship_id: 'favorite-1',
        actor_user_id: 'user-1',
        target_type: 'content',
        target_id: 'content-1',
        created_at: '2026-10-02T00:00:00.000Z',
      },
    ])

    await expect(
      favorite(d, 'user-1', { targetType: 'content', targetId: 'content-1' }),
    ).resolves.toEqual({
      relationshipId: 'favorite-1',
      actorUserId: 'user-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
    expect(d.prepare).toHaveBeenCalledTimes(2)
  })

  it('binds the final bookmark write to published content', async () => {
    const d = db([
      { id: 'content-1', state: 'PUBLISHED' },
      null,
    ])

    await expect(
      favorite(d, 'user-1', { targetType: 'content', targetId: 'content-1' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })

    const sql = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0])
    expect(sql).toContain("c.state = 'PUBLISHED'")
    expect(sql).toContain('INSERT INTO interaction_favorites')
    expect(sql).toContain('SELECT')
  })

  it('is idempotent for an already-favorited content item', async () => {
    const d = db([
      { id: 'content-1', state: 'PUBLISHED' },
      {
        relationship_id: 'favorite-existing',
        actor_user_id: 'user-1',
        target_type: 'content',
        target_id: 'content-1',
        created_at: '2026-10-02T00:00:00.000Z',
      },
    ])

    await expect(
      favorite(d, 'user-1', { targetType: 'content', targetId: 'content-1' }),
    ).resolves.toMatchObject({
      relationshipId: 'favorite-existing',
      targetId: 'content-1',
    })
  })

  it('reads favorite status only for published content', async () => {
    const d = db([{ favorited: 1 }])
    await expect(
      getFavoriteStatus(d, 'user-1', { targetType: 'content', targetId: 'content-1' }),
    ).resolves.toEqual({ favorited: true })

    const unpublished = db([null])
    await expect(
      getFavoriteStatus(unpublished, 'user-1', { targetType: 'content', targetId: 'content-1' }),
    ).resolves.toEqual({ favorited: false })
  })

  
  it('serves repeated favorite status reads from the private cache', async () => {
    const first = db([{ favorited: 1 }])
    await expect(
      getFavoriteStatus(first, 'cache-user', { targetType: 'content', targetId: 'cache-content' }),
    ).resolves.toEqual({ favorited: true })
    const secondPrepare = vi.fn(() => { throw new Error('D1_SHOULD_NOT_BE_READ') })
    const second = { prepare: secondPrepare } as unknown as D1Database
    await expect(
      getFavoriteStatus(second, 'cache-user', { targetType: 'content', targetId: 'cache-content' }),
    ).resolves.toEqual({ favorited: true })
    expect(secondPrepare).not.toHaveBeenCalled()
  })

it('unfavorites idempotently without a preliminary read', async () => {
    await expect(
      unfavorite(db(), 'user-1', { targetType: 'content', targetId: 'content-1' }),
    ).resolves.toBeUndefined()
  })


  it('paginates the actor-scoped favorite list with an opaque cursor', async () => {
    const d = db([], [
      { relationship_id: 'favorite_3', target_id: 'content_3', created_at: '2026-10-03T00:00:00.000Z' },
      { relationship_id: 'favorite_2', target_id: 'content_2', created_at: '2026-10-02T00:00:00.000Z' },
    ])
    const first = await listFavorites(d, 'user_1', null, 1)
    expect(first).toMatchObject({
      items: [{ targetId: 'content_3', createdAt: '2026-10-03T00:00:00.000Z' }],
      hasMore: true,
      nextCursor: expect.any(String),
    })
    const statement = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value
    expect(String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain('ORDER BY created_at DESC, relationship_id DESC')
    expect(statement.bind).toHaveBeenCalledWith('user_1', 2)
    await expect(listFavorites(db(), 'user_2', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
  })

  it('rejects unbounded favorite-list pages and malformed cursors', async () => {
    await expect(listFavorites(db(), 'user_1', null, 51)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
    await expect(listFavorites(db(), 'user_1', 'not a cursor', 20)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
  })

  it('rejects unsupported targets and invalid actors', async () => {
    await expect(
      favorite(db(), 'user-1', { targetType: 'comment', targetId: 'comment-1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })

    await expect(
      favorite(db(), '', { targetType: 'content', targetId: 'content-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
  })

  it('rejects unpublished content without a write', async () => {
    const d = db([{ id: 'content-1', state: 'DRAFT' }])
    await expect(
      favorite(d, 'user-1', { targetType: 'content', targetId: 'content-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })
})

/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFavoriteStatusCacheForTests, favorite, getFavoriteStatus, listFavorites, unfavorite } from './favorite-runtime.js'
import type { W03ContentBinding } from './w03-content-context-client.js'
import { FavoriteStatusReadStoreError } from './favorite-status-read-store.js'
import { FavoriteMutationStoreError } from './favorite-mutation-store.js'

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

const publishedBinding = (status = 200) => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const contentId = new URL(request.url).pathname.split('/').filter(Boolean).at(-2)
    return Response.json(status === 200
      ? { data: { contentId, ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED' } }
      : { error: { code: 'NOT_FOUND' } }, { status })
  }),
}) as W03ContentBinding & { fetch: ReturnType<typeof vi.fn> }

const favoriteRow = {
  relationship_id: 'favorite-1',
  actor_user_id: 'user-1',
  target_type: 'content' as const,
  target_id: 'content-1',
  created_at: '2026-10-02T00:00:00.000Z',
}

describe('favorite runtime', () => {
  beforeEach(() => clearFavoriteStatusCacheForTests())

  it('creates a favorite through W03 and writes only the W05 relationship row', async () => {
    const d = db([favoriteRow])
    const binding = publishedBinding()
    await expect(favorite(d, binding, 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-1'))
      .resolves.toEqual({
        relationshipId: 'favorite-1',
        actorUserId: 'user-1',
        targetType: 'content',
        targetId: 'content-1',
        createdAt: favoriteRow.created_at,
      })

    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(String(prepare.mock.calls[0]?.[0])).toContain('INSERT INTO interaction_favorites')
    expect(String(prepare.mock.calls[0]?.[0])).not.toMatch(/\b(?:FROM|JOIN)\s+contents\b/i)
    expect(String(prepare.mock.calls[0]?.[0])).toContain('ON CONFLICT')
    const sent = binding.fetch.mock.calls[0]?.[0] as Request
    expect(sent.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(sent.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(sent.headers.has('Authorization')).toBe(false)
    expect(sent.headers.has('Cookie')).toBe(false)
  })

  it('fails closed before any W05 D1 access when W03 says content is not published', async () => {
    const d = db()
    await expect(favorite(d, publishedBinding(404), 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('fails closed when the W03 binding is unavailable', async () => {
    const d = db()
    await expect(favorite(d, undefined, 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-1'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('is idempotent for an already-favorited content item', async () => {
    await expect(favorite(db([favoriteRow]), publishedBinding(), 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-1'))
      .resolves.toMatchObject({ relationshipId: 'favorite-1', targetId: 'content-1' })
  })

  it('reads favorite status from W05 after W03 confirms published visibility', async () => {
    const d = db([{ favorited: 1 }])
    const binding = publishedBinding()
    await expect(getFavoriteStatus(d, binding, 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-1'))
      .resolves.toEqual({ favorited: true })
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(String(prepare.mock.calls[0]?.[0])).toContain('FROM interaction_favorites')
    expect(String(prepare.mock.calls[0]?.[0])).not.toMatch(/\b(?:FROM|JOIN)\s+contents\b/i)
  })

  it('accepts an injected favorite status store only after W03 publication validation', async () => {
    const store = { isFavorited: vi.fn(async () => true) }
    const binding = publishedBinding()

    await expect(getFavoriteStatus(
      store,
      binding,
      'pg-status-actor',
      { targetType: 'content', targetId: 'pg-status-content' },
      'corr-pg-status',
    )).resolves.toEqual({ favorited: true })

    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(store.isFavorited).toHaveBeenCalledWith({
      actorUserId: 'pg-status-actor',
      targetId: 'pg-status-content',
    })
  })

  it('does not query the injected favorite status store when W03 says content is unpublished', async () => {
    const store = { isFavorited: vi.fn(async () => true) }
    const binding = publishedBinding(404)

    await expect(getFavoriteStatus(
      store,
      binding,
      'pg-status-hidden-actor',
      { targetType: 'content', targetId: 'pg-status-hidden-content' },
      'corr-pg-status-hidden',
    )).resolves.toEqual({ favorited: false })
    expect(store.isFavorited).not.toHaveBeenCalled()
  })

  it('maps favorite status provider failures to a sanitized 503', async () => {
    const store = {
      isFavorited: vi.fn(async () => { throw new FavoriteStatusReadStoreError() }),
    }
    await expect(getFavoriteStatus(
      store,
      publishedBinding(),
      'pg-status-error-actor',
      { targetType: 'content', targetId: 'pg-status-error-content' },
      'corr-pg-status-error',
    )).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'FAVORITE_STATUS_READ_UNAVAILABLE',
    })
  })

  it('returns false for unpublished targets without reading W05 D1', async () => {
    const d = db()
    await expect(getFavoriteStatus(d, publishedBinding(404), 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-1'))
      .resolves.toEqual({ favorited: false })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('revalidates published visibility before using the local favorite-status cache', async () => {
    const first = db([{ favorited: 1 }])
    await expect(getFavoriteStatus(first, publishedBinding(), 'cache-user', { targetType: 'content', targetId: 'cache-content' }, 'corr-1'))
      .resolves.toEqual({ favorited: true })
    const secondPrepare = vi.fn(() => { throw new Error('D1_SHOULD_NOT_BE_READ') })
    const second = { prepare: secondPrepare } as unknown as D1Database
    const binding = publishedBinding()
    await expect(getFavoriteStatus(second, binding, 'cache-user', { targetType: 'content', targetId: 'cache-content' }, 'corr-2'))
      .resolves.toEqual({ favorited: true })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(secondPrepare).not.toHaveBeenCalled()
    const unpublished = db()
    await expect(getFavoriteStatus(unpublished, publishedBinding(404), 'cache-user', { targetType: 'content', targetId: 'cache-content' }, 'corr-3'))
      .resolves.toEqual({ favorited: false })
  })

  it('unfavorites idempotently without a preliminary read', async () => {
    await expect(unfavorite(db(), 'user-1', { targetType: 'content', targetId: 'content-1' })).resolves.toBeUndefined()
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
    await expect(listFavorites(db(), 'user_1', null, 51)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listFavorites(db(), 'user_1', 'not a cursor', 20)).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
  })

  it('rejects unsupported targets and invalid actors before database access', async () => {
    const d = db()
    await expect(favorite(d, publishedBinding(), 'user-1', { targetType: 'comment', targetId: 'comment-1' }, 'corr-1'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(favorite(d, publishedBinding(), '', { targetType: 'content', targetId: 'content-1' }, 'corr-1'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    await expect(favorite(d, publishedBinding(), 'user-1', { targetType: 'content', targetId: 'content/1' }, 'corr-1'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('accepts an injected favorite list read store and preserves the exact keyset cursor', async () => {
    const store = {
      list: vi.fn()
        .mockResolvedValueOnce([
          {
            relationship_id: 'favorite-newer',
            target_id: 'content-newer',
            created_at: '2026-11-10T04:00:00.900Z',
            cursor_created_at: '2026-11-10T04:00:00.900456Z',
          },
          {
            relationship_id: 'favorite-older',
            target_id: 'content-older',
            created_at: '2026-11-10T04:00:00.789Z',
            cursor_created_at: '2026-11-10T04:00:00.789123Z',
          },
        ])
        .mockResolvedValueOnce([
          {
            relationship_id: 'favorite-older',
            target_id: 'content-older',
            created_at: '2026-11-10T04:00:00.789Z',
            cursor_created_at: '2026-11-10T04:00:00.789123Z',
          },
          {
            relationship_id: 'favorite-oldest',
            target_id: 'content-oldest',
            created_at: '2026-11-10T04:00:00.456Z',
            cursor_created_at: '2026-11-10T04:00:00.456789Z',
          },
        ]),
    }

    const first = await listFavorites(store, 'actor-1', null, 1)
    expect(first).toMatchObject({
      items: [{ targetId: 'content-newer', createdAt: '2026-11-10T04:00:00.900Z' }],
      hasMore: true,
      nextCursor: expect.any(String),
    })

    const second = await listFavorites(store, 'actor-1', first.nextCursor, 1)
    expect(second).toEqual({
      items: [{ targetId: 'content-older', createdAt: '2026-11-10T04:00:00.789Z' }],
      hasMore: true,
      nextCursor: expect.any(String),
    })
    expect(store.list).toHaveBeenNthCalledWith(1, {
      actorUserId: 'actor-1',
      cursor: null,
      limit: 2,
    })
    expect(store.list).toHaveBeenNthCalledWith(2, {
      actorUserId: 'actor-1',
      cursor: {
        createdAt: '2026-11-10T04:00:00.900456Z',
        relationshipId: 'favorite-newer',
      },
      limit: 2,
    })
  })

  it('maps D1 favorite list read failures to a sanitized 503', async () => {
    const failingDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => { throw new Error('secret-d1-connection-detail') }),
        })),
      })),
    } as unknown as D1Database

    await expect(listFavorites(failingDb, 'actor-1', null, 20)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'FAVORITE_LIST_READ_UNAVAILABLE',
    })
  })


  it('uses an injected favorite mutation store after W03 publication validation', async () => {
    const store = {
      create: vi.fn(async () => favoriteRow),
      remove: vi.fn(async () => undefined),
    }
    const database = { prepare: vi.fn() } as unknown as D1Database
    const binding = publishedBinding()

    await expect(favorite(store, binding, 'user-1', {
      targetType: 'content',
      targetId: 'content-1',
    }, 'corr-pg-mutation')).resolves.toEqual({
      relationshipId: 'favorite-1',
      actorUserId: 'user-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: favoriteRow.created_at,
    })

    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      targetType: 'content',
      targetId: 'content-1',
      createdAt: expect.any(String),
      relationshipId: expect.any(String),
    }))
    expect(database.prepare).not.toHaveBeenCalled()
  })

  it('does not call the injected favorite mutation store when W03 rejects publication', async () => {
    const store = {
      create: vi.fn(async () => favoriteRow),
      remove: vi.fn(async () => undefined),
    }
    await expect(favorite(store, publishedBinding(404), 'user-1', {
      targetType: 'content',
      targetId: 'content-1',
    }, 'corr-unpublished')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.create).not.toHaveBeenCalled()
  })

  it('uses the injected mutation store for idempotent actor-scoped unfavorite', async () => {
    const store = {
      create: vi.fn(async () => favoriteRow),
      remove: vi.fn(async () => undefined),
    }
    await expect(unfavorite(store, 'user-1', {
      targetType: 'content',
      targetId: 'content-1',
    })).resolves.toBeUndefined()
    expect(store.remove).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      targetType: 'content',
      targetId: 'content-1',
    })
  })

  it('maps favorite mutation store failures to a sanitized 503', async () => {
    const createStore = {
      create: vi.fn(async () => { throw new FavoriteMutationStoreError() }),
      remove: vi.fn(async () => undefined),
    }
    await expect(favorite(createStore, publishedBinding(), 'user-1', {
      targetType: 'content',
      targetId: 'content-1',
    }, 'corr-error')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'FAVORITE_MUTATION_STORE_UNAVAILABLE',
    })

    const removeStore = {
      create: vi.fn(async () => favoriteRow),
      remove: vi.fn(async () => { throw new FavoriteMutationStoreError() }),
    }
    await expect(unfavorite(removeStore, 'user-1', {
      targetType: 'content',
      targetId: 'content-1',
    })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'FAVORITE_MUTATION_STORE_UNAVAILABLE',
    })
  })

})

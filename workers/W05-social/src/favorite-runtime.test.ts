/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFavoriteStatusCacheForTests, favorite, getFavoriteStatus, listFavorites, unfavorite } from './favorite-runtime.js'
import type { W03ContentBinding } from './w03-content-context-client.js'
import { FavoriteStatusReadStoreError } from './favorite-status-read-store.js'
import { FavoriteMutationStoreError } from './favorite-mutation-store.js'
import { FavoriteListReadStoreError, type FavoriteListReadRow, type FavoriteListReadStore } from './favorite-list-read-store.js'
import type { FavoriteMutationStore } from './favorite-mutation-store.js'
import type { FavoriteStatusReadStore } from './favorite-status-read-store.js'

const publishedBinding = (status = 200): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const contentId = new URL(request.url).pathname.split('/').filter(Boolean).at(-2)
    return Response.json(status === 200
      ? { data: { contentId, ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-11-14T00:00:00.000Z' } }
      : { error: { code: 'NOT_FOUND' } }, { status })
  }),
})
const favoriteRow = {
  relationship_id: 'favorite-1', actor_user_id: 'user-1', target_type: 'content' as const,
  target_id: 'content-1', created_at: '2026-10-02T00:00:00.000Z',
}
const mutationStore = (overrides: Partial<FavoriteMutationStore> = {}): FavoriteMutationStore => ({
  create: vi.fn(async () => favoriteRow), remove: vi.fn(async () => undefined), ...overrides,
})
const statusStore = (isFavorited = true): FavoriteStatusReadStore => ({ isFavorited: vi.fn(async () => isFavorited) })
const listStore = (rows: readonly FavoriteListReadRow[] = []): FavoriteListReadStore => ({ list: vi.fn(async () => rows) })

describe('favorite runtime — Neon Store ports only', () => {
  beforeEach(() => clearFavoriteStatusCacheForTests())

  it('creates a favorite only after W03 publication validation', async () => {
    const writer = mutationStore(), binding = publishedBinding()
    await expect(favorite(writer, binding, 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-1'))
      .resolves.toEqual({ relationshipId: 'favorite-1', actorUserId: 'user-1', targetType: 'content', targetId: 'content-1', createdAt: favoriteRow.created_at })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(writer.create).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1', targetId: 'content-1' }))
  })

  it('does not write when W03 says content is unpublished or unavailable', async () => {
    const writer = mutationStore()
    await expect(favorite(writer, publishedBinding(404), 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-404'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(favorite(writer, undefined, 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-missing'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(writer.create).not.toHaveBeenCalled()
  })

  it('preserves idempotent favorite identity from the Store', async () => {
    const writer = mutationStore({ create: vi.fn(async () => favoriteRow) })
    await expect(favorite(writer, publishedBinding(), 'user-1', { targetType: 'content', targetId: 'content-1' }, 'corr-retry'))
      .resolves.toMatchObject({ relationshipId: 'favorite-1' })
    expect(writer.create).toHaveBeenCalledTimes(1)
  })

  it('reads status from the injected Store after W03 visibility validation', async () => {
    const reader = statusStore(true), binding = publishedBinding()
    await expect(getFavoriteStatus(reader, binding, 'actor-1', { targetType: 'content', targetId: 'content-1' }, 'corr-status'))
      .resolves.toEqual({ favorited: true })
    expect(reader.isFavorited).toHaveBeenCalledWith({ actorUserId: 'actor-1', targetId: 'content-1' })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
  })

  it('returns false and clears cached state when W03 says content is unpublished', async () => {
    const reader = statusStore(true)
    await expect(getFavoriteStatus(reader, publishedBinding(404), 'actor-1', { targetType: 'content', targetId: 'content-1' }, 'corr-hidden'))
      .resolves.toEqual({ favorited: false })
    expect(reader.isFavorited).not.toHaveBeenCalled()
  })

  it('revalidates W03 visibility before using cached favorite state', async () => {
    const reader = statusStore(true)
    await expect(getFavoriteStatus(reader, publishedBinding(), 'cache-actor', { targetType: 'content', targetId: 'cache-content' }, 'corr-1'))
      .resolves.toEqual({ favorited: true })
    await expect(getFavoriteStatus(reader, publishedBinding(), 'cache-actor', { targetType: 'content', targetId: 'cache-content' }, 'corr-2'))
      .resolves.toEqual({ favorited: true })
    expect(reader.isFavorited).toHaveBeenCalledTimes(1)
  })

  it('invalidates actor-scoped status cache after Favorite and Unfavorite', async () => {
    const reader = statusStore(true), writer = mutationStore()
    await expect(getFavoriteStatus(reader, publishedBinding(), 'cache-actor', { targetType: 'content', targetId: 'content-1' }, 'corr-before'))
      .resolves.toEqual({ favorited: true })
    await favorite(writer, publishedBinding(), 'cache-actor', { targetType: 'content', targetId: 'content-1' }, 'corr-write')
    await expect(getFavoriteStatus(reader, publishedBinding(), 'cache-actor', { targetType: 'content', targetId: 'content-1' }, 'corr-after'))
      .resolves.toEqual({ favorited: true })
    expect(reader.isFavorited).toHaveBeenCalledTimes(2)
    await unfavorite(writer, 'cache-actor', { targetType: 'content', targetId: 'content-1' })
    expect(writer.remove).toHaveBeenCalledWith({ actorUserId: 'cache-actor', targetType: 'content', targetId: 'content-1' })
  })

  it('maps status and mutation provider failures to sanitized 503', async () => {
    await expect(getFavoriteStatus({ isFavorited: vi.fn(async () => { throw new FavoriteStatusReadStoreError() }) }, publishedBinding(), 'actor-1', { targetType: 'content', targetId: 'content-1' }, 'corr-error'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, message: 'FAVORITE_STATUS_READ_UNAVAILABLE' })
    await expect(favorite(mutationStore({ create: vi.fn(async () => { throw new FavoriteMutationStoreError() }) }), publishedBinding(), 'actor-1', { targetType: 'content', targetId: 'content-1' }, 'corr-error'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, message: 'FAVORITE_MUTATION_STORE_UNAVAILABLE' })
    await expect(unfavorite(mutationStore({ remove: vi.fn(async () => { throw new FavoriteMutationStoreError() }) }), 'actor-1', { targetType: 'content', targetId: 'content-1' }))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('paginates the actor-scoped favorite list with an opaque exact cursor', async () => {
    const newer = { relationship_id: 'favorite-newer', target_id: 'content-newer', created_at: '2026-11-10T04:00:00.900Z', cursor_created_at: '2026-11-10T04:00:00.900456Z' }
    const older = { relationship_id: 'favorite-older', target_id: 'content-older', created_at: '2026-11-10T04:00:00.789Z', cursor_created_at: '2026-11-10T04:00:00.789123Z' }
    const reader: FavoriteListReadStore = { list: vi.fn().mockResolvedValueOnce([newer, older]).mockResolvedValueOnce([older]) }
    const first = await listFavorites(reader, 'actor-1', null, 1)
    expect(first).toMatchObject({ items: [{ targetId: 'content-newer' }], hasMore: true, nextCursor: expect.any(String) })
    const second = await listFavorites(reader, 'actor-1', first.nextCursor, 1)
    expect(second.items).toEqual([{ targetId: 'content-older', createdAt: '2026-11-10T04:00:00.789Z' }])
    expect(reader.list).toHaveBeenNthCalledWith(1, { actorUserId: 'actor-1', cursor: null, limit: 2 })
    expect(reader.list).toHaveBeenNthCalledWith(2, { actorUserId: 'actor-1', cursor: { createdAt: '2026-11-10T04:00:00.900456Z', relationshipId: 'favorite-newer' }, limit: 2 })
  })

  it('rejects cross-actor cursors, malformed cursors and unbounded page sizes', async () => {
    const reader = listStore()
    const first = await listFavorites(reader, 'actor-1', null, 1)
    await expect(listFavorites(reader, 'actor-2', first.nextCursor, 1)).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listFavorites(reader, 'actor-1', 'not a cursor', 20)).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listFavorites(reader, 'actor-1', null, 51)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('maps favorite list provider failures to sanitized 503', async () => {
    await expect(listFavorites({ list: vi.fn(async () => { throw new FavoriteListReadStoreError() }) }, 'actor-1', null, 20))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, message: 'FAVORITE_LIST_READ_UNAVAILABLE' })
  })

  it('rejects invalid target types and actor ids before Store access', async () => {
    const writer = mutationStore()
    await expect(favorite(writer, publishedBinding(), 'actor-1', { targetType: 'comment', targetId: 'comment-1' }, 'corr-invalid'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(favorite(writer, publishedBinding(), '', { targetType: 'content', targetId: 'content-1' }, 'corr-invalid'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    expect(writer.create).not.toHaveBeenCalled()
  })
})

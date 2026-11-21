import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import { clearFavoriteStatusCacheForTests } from './favorite-runtime.js'
import type { FavoriteMutationStore } from './favorite-mutation-store.js'
import type { FavoriteStatusReadStore } from './favorite-status-read-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-favorite-test',
  'X-LuckRead-Principal-User-Id': 'viewer-favorite-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

function publishedContentBinding(): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const contentId = decodeURIComponent(new URL(request.url).pathname.split('/').at(-2) ?? '')
      return Response.json({
        data: {
          contentId,
          ownerUserId: 'favorite-content-owner',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-11-14T00:00:00.000Z',
        },
      })
    }),
  }
}

function createHarness() {
  const mutationStore: FavoriteMutationStore = {
    create: vi.fn(async (input) => ({
      relationship_id: 'favorite-pg-1',
      actor_user_id: input.actorUserId,
      target_type: input.targetType,
      target_id: input.targetId,
      created_at: input.createdAt,
    })),
    remove: vi.fn(async () => undefined),
  }
  const statusStore: FavoriteStatusReadStore = {
    isFavorited: vi.fn(async () => true),
  }
  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Favorite path')
  })
  const db = { prepare } as unknown as D1Database
  const w03Content = publishedContentBinding()
  const worker = createW05SocialWorker({
    favoriteMutationStore: mutationStore,
    favoriteStatusReadStore: statusStore,
  })
  return {
    worker,
    env: { DB: db, W03_CONTENT: w03Content },
    prepare,
    mutationStore,
    statusStore,
    w03Content,
  }
}

describe('W05 Neon Favorite route composition', () => {
  beforeEach(() => clearFavoriteStatusCacheForTests())

  it('reads bookmark status from PostgreSQL after W03 publication validation without D1 access', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks?targetType=content&targetId=content-status-1', {
        method: 'GET',
        headers: transportHeaders,
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { favorited: true } })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(h.statusStore.isFavorited).toHaveBeenCalledWith({
      actorUserId: 'viewer-favorite-1',
      targetId: 'content-status-1',
    })
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('creates a bookmark through PostgreSQL after W03 publication validation without D1 access', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'favorite-create-idempotency-1',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-create-1' }),
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        relationshipId: 'favorite-pg-1',
        actorUserId: 'viewer-favorite-1',
        targetType: 'content',
        targetId: 'content-create-1',
      },
    })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(h.mutationStore.create).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'viewer-favorite-1',
      targetType: 'content',
      targetId: 'content-create-1',
    }))
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('removes a bookmark through the actor-scoped PostgreSQL mutation store without D1 access', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/bookmarks', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'favorite-remove-idempotency-1',
        },
        body: JSON.stringify({ targetType: 'content', targetId: 'content-remove-1' }),
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(h.mutationStore.remove).toHaveBeenCalledWith({
      actorUserId: 'viewer-favorite-1',
      targetType: 'content',
      targetId: 'content-remove-1',
    })
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

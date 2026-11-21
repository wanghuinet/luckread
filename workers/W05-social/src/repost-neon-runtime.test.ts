import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { RepostStorageRow, RepostStore } from './repost-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-repost-test',
  'X-LuckRead-Principal-User-Id': 'repost-viewer-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

const storedRepost: RepostStorageRow = {
  repost_id: 'repost-pg-1',
  content_id: 'repost-content-1',
  actor_user_id: 'repost-viewer-1',
  created_at: '2026-11-14T00:00:00.000Z',
}

function createHarness() {
  const store: RepostStore = {
    isBlocked: vi.fn(async () => false),
    find: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedRepost),
    insertIfAbsent: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  }
  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Repost path')
  })
  const w03Content: W03ContentBinding = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return Response.json({
        data: {
          contentId: 'repost-content-1',
          ownerUserId: 'repost-owner-1',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-11-14T00:00:00.000Z',
        },
        requestId: 'req-w03-repost',
      })
    }),
  }
  const worker = createW05SocialWorker({ repostStore: store })
  return {
    worker,
    env: { DB: { prepare }, W03_CONTENT: w03Content },
    prepare,
    store,
    w03Content,
  }
}

describe('W05 Neon Repost route composition', () => {
  it('creates an idempotent repost through PostgreSQL after W03 publication and Block checks without D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/content/repost-content-1/reposts', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'repost-create-1',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        repostId: 'repost-pg-1',
        contentId: 'repost-content-1',
        actorUserId: 'repost-viewer-1',
        createdAt: storedRepost.created_at,
      },
    })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(h.store.isBlocked).toHaveBeenCalledWith('repost-viewer-1', 'repost-owner-1')
    expect(h.store.find).toHaveBeenCalledTimes(2)
    expect(h.store.insertIfAbsent).toHaveBeenCalledWith(
      expect.any(String),
      'repost-content-1',
      'repost-viewer-1',
      expect.any(String),
    )
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('removes only the actor-scoped repost through PostgreSQL without D1 access', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/content/repost-content-1/reposts', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'repost-delete-1',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(h.store.remove).toHaveBeenCalledWith('repost-viewer-1', 'repost-content-1')
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

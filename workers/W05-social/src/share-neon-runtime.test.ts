import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { ShareStorageRow, ShareStore } from './share-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const principalHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-share-create-test',
  'X-LuckRead-Principal-User-Id': 'share-viewer-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

const shareRow: ShareStorageRow = {
  share_id: 'share-pg-1',
  content_id: 'share-content-1',
  actor_user_id: 'share-viewer-1',
  created_at: '2026-11-14T00:00:00.000Z',
}

function createHarness() {
  const store: ShareStore = {
    findByActorAndKey: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(shareRow),
    insertIfAbsent: vi.fn(async () => undefined),
    findById: vi.fn(async () => ({
      share_id: shareRow.share_id,
      content_id: shareRow.content_id,
      created_at: shareRow.created_at,
    })),
  }
  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Share path')
  })
  const w03Content: W03ContentBinding = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const contentId = decodeURIComponent(new URL(request.url).pathname.split('/').at(-2) ?? '')
      return Response.json({
        data: {
          contentId,
          ownerUserId: 'share-content-owner',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-11-14T00:00:00.000Z',
        },
        requestId: 'req-w03-share',
      })
    }),
  }
  const worker = createW05SocialWorker({ shareStore: store })
  return {
    worker,
    env: { DB: { prepare }, W03_CONTENT: w03Content },
    prepare,
    store,
    w03Content,
  }
}

describe('W05 Neon Share route composition', () => {
  it('creates an idempotent share through PostgreSQL after W03 confirms published content', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/content/share-content-1/shares', {
        method: 'POST',
        headers: {
          ...principalHeaders,
          'Idempotency-Key': 'share-create-key-1',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        shareId: 'share-pg-1',
        contentId: 'share-content-1',
        actorUserId: 'share-viewer-1',
        createdAt: shareRow.created_at,
      },
    })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(h.store.findByActorAndKey).toHaveBeenCalledTimes(2)
    expect(h.store.insertIfAbsent).toHaveBeenCalledWith(
      expect.any(String),
      'share-content-1',
      'share-viewer-1',
      'share-create-key-1',
      expect.any(String),
    )
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('resolves a share through PostgreSQL only after W03 confirms content is still published', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/shares/share-pg-1', {
        method: 'GET',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'w05-neon-share-resolve-test',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        shareId: 'share-pg-1',
        contentId: 'share-content-1',
        createdAt: shareRow.created_at,
      },
    })
    expect(h.store.findById).toHaveBeenCalledWith('share-pg-1')
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    const forwarded = (h.w03Content.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Request
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

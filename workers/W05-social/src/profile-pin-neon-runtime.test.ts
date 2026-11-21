import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { ProfilePinStorageRow, ProfilePinStore } from './profile-pin-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-profile-pin-test',
  'X-LuckRead-Principal-User-Id': 'profile-owner-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

const storedPin: ProfilePinStorageRow = {
  user_id: 'profile-owner-1',
  content_id: 'profile-content-1',
  pinned_at: '2026-11-14T00:00:00.000Z',
}

function createHarness() {
  const store: ProfilePinStore = {
    pin: vi.fn(async () => storedPin),
    get: vi.fn(async () => storedPin),
    unpin: vi.fn(async () => undefined),
  }
  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Profile Pin path')
  })
  const w03Content: W03ContentBinding = {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const path = new URL(request.url).pathname
      return Response.json({
        data: {
          contentId: 'profile-content-1',
          ownerUserId: 'profile-owner-1',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-11-14T00:00:00.000Z',
        },
        requestId: path.includes('public-post-context') ? 'req-public-pin' : 'req-owned-pin',
      })
    }),
  }
  const worker = createW05SocialWorker({ profilePinStore: store })
  return {
    worker,
    env: { DB: { prepare }, W03_CONTENT: w03Content },
    prepare,
    store,
    w03Content,
  }
}

describe('W05 Neon Profile Pin route composition', () => {
  it('creates a profile pin through PostgreSQL after W03 verifies ownership and publication', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/content/profile-content-1/pin', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'profile-pin-create-1',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        userId: 'profile-owner-1',
        contentId: 'profile-content-1',
        pinnedAt: '2026-11-14T00:00:00.000Z',
      },
    })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    const forwarded = (h.w03Content.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/owned-post-context')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe('profile-owner-1')
    expect(h.store.pin).toHaveBeenCalledWith(
      'profile-owner-1',
      'profile-content-1',
      expect.any(String),
    )
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('removes a profile pin through the owner-scoped PostgreSQL store without D1 access', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/content/profile-content-1/pin', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'profile-pin-delete-1',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(h.store.unpin).toHaveBeenCalledWith('profile-owner-1', 'profile-content-1')
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('reads public pin references from PostgreSQL only after W03 confirms the profile owns a published post', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/users/profile-owner-1/pinned-content', {
        method: 'GET',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'w05-neon-profile-pin-public-read',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        userId: 'profile-owner-1',
        contentId: 'profile-content-1',
        pinnedAt: '2026-11-14T00:00:00.000Z',
      },
    })
    expect(h.store.get).toHaveBeenCalledWith('profile-owner-1')
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    const forwarded = (h.w03Content.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/public-post-context/profile-owner-1')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.has('X-LuckRead-Principal-User-Id')).toBe(false)
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

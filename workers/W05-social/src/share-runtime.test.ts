import { describe, expect, it, vi } from 'vitest'
import { createShare, resolveShare } from './share-runtime.js'
import { ShareStoreError, type ShareStorageRow, type ShareStore } from './share-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

function memoryStore(): ShareStore {
  const byKey = new Map<string, ShareStorageRow>()
  const byId = new Map<string, ShareStorageRow>()
  return {
    async findByActorAndKey(actorUserId, idempotencyKey) {
      return byKey.get(actorUserId + ':' + idempotencyKey) ?? null
    },
    async insertIfAbsent(shareId, contentId, actorUserId, idempotencyKey, createdAt) {
      const key = actorUserId + ':' + idempotencyKey
      if (!byKey.has(key)) {
        const row = { share_id: shareId, content_id: contentId, actor_user_id: actorUserId, created_at: createdAt }
        byKey.set(key, row)
        byId.set(shareId, row)
      }
    },
    async findById(shareId) {
      const row = byId.get(shareId)
      return row ? { share_id: row.share_id, content_id: row.content_id, created_at: row.created_at } : null
    },
  }
}

const publishedContextBinding = (status = 200): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const parts = new URL(request.url).pathname.split('/').filter(Boolean)
    const contentId = decodeURIComponent(parts.at(-2) ?? '')
    const body = { data: { contentId, ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-11-14T00:00:00.000Z' } }
    return Response.json(status === 200 ? body : { error: 'NOT_FOUND' }, { status })
  }),
})

const row: ShareStorageRow = {
  share_id: 'share-row-1', content_id: 'content-1', actor_user_id: 'user-1',
  created_at: '2026-10-02T00:00:00.000Z',
}

describe('share runtime', () => {
  it('creates an idempotent share after W03 publication validation', async () => {
    const store = memoryStore()
    const binding = publishedContextBinding()
    const first = await createShare(binding, 'user-1', 'content-1', 'same-key', 'correlation-1', store)
    const retry = await createShare(binding, 'user-1', 'content-1', 'same-key', 'retry-correlation', store)
    expect(first.shareId).toEqual(expect.any(String))
    expect(retry).toEqual(first)
    expect(binding.fetch).toHaveBeenCalledTimes(2)
    const sent = binding.fetch.mock.calls[0]?.[0] as Request
    expect(sent.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(sent.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(sent.headers.has('Authorization')).toBe(false)
    expect(sent.headers.has('Cookie')).toBe(false)
  })

  it('rejects reusing an actor idempotency key for another content item', async () => {
    const store: ShareStore = {
      findByActorAndKey: vi.fn(async () => row),
      insertIfAbsent: vi.fn(),
      findById: vi.fn(),
    }
    await expect(createShare(publishedContextBinding(), 'user-1', 'content-2', 'same-key', 'corr', store))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('resolves a share only after W03 confirms the content is still published', async () => {
    const store: ShareStore = {
      findByActorAndKey: vi.fn(), insertIfAbsent: vi.fn(),
      findById: vi.fn(async () => ({ share_id: row.share_id, content_id: row.content_id, created_at: row.created_at })),
    }
    const binding = publishedContextBinding()
    await expect(resolveShare(binding, 'share-row-1', 'correlation-1', store)).resolves.toEqual({
      shareId: 'share-row-1', contentId: 'content-1', createdAt: row.created_at,
    })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not call W03 for a missing share', async () => {
    const store = memoryStore()
    const binding = publishedContextBinding()
    await expect(resolveShare(binding, 'missing-share', 'corr', store))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('fails closed before Store access when W03 no longer publishes the content', async () => {
    const store: ShareStore = {
      findByActorAndKey: vi.fn(), insertIfAbsent: vi.fn(), findById: vi.fn(),
    }
    await expect(createShare(publishedContextBinding(404), 'user-1', 'content-1', 'key-1', 'corr', store))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.findByActorAndKey).not.toHaveBeenCalled()
  })

  it('rejects invalid actor and idempotency inputs before Store access', async () => {
    const store: ShareStore = {
      findByActorAndKey: vi.fn(), insertIfAbsent: vi.fn(), findById: vi.fn(),
    }
    await expect(createShare(publishedContextBinding(), '', 'content-1', 'key', 'corr', store))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    await expect(createShare(publishedContextBinding(), 'user-1', 'content-1', '', 'corr', store))
      .rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 })
    expect(store.findByActorAndKey).not.toHaveBeenCalled()
  })

  it('maps persistence failures to a sanitized service error', async () => {
    const store: ShareStore = {
      findByActorAndKey: vi.fn(async () => { throw new ShareStoreError() }),
      insertIfAbsent: vi.fn(), findById: vi.fn(),
    }
    await expect(createShare(publishedContextBinding(), 'user-1', 'content-1', 'key', 'corr', store))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createRepost, removeRepost } from './repost-runtime.js'
import { RepostStoreError, type RepostStorageRow, type RepostStore } from './repost-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const relation: RepostStorageRow = {
  repost_id: 'repost-1', content_id: 'content-1', actor_user_id: 'viewer-1',
  created_at: '2026-10-15T00:00:00.000Z',
}

function memoryStore(seed: RepostStorageRow[] = []): RepostStore {
  const rows = new Map(seed.map(row => [row.actor_user_id + ':' + row.content_id, row]))
  return {
    async isBlocked() { return false },
    async find(actorUserId, contentId) { return rows.get(actorUserId + ':' + contentId) ?? null },
    async insertIfAbsent(repostId, contentId, actorUserId, createdAt) {
      const key = actorUserId + ':' + contentId
      if (!rows.has(key)) rows.set(key, { repost_id: repostId, content_id: contentId, actor_user_id: actorUserId, created_at: createdAt })
    },
    async remove(actorUserId, contentId) { rows.delete(actorUserId + ':' + contentId) },
  }
}

const publishedBinding = (status = 200) => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const contentId = new URL(request.url).pathname.split('/').filter(Boolean).at(-2)
    return Response.json(status === 200 ? {
      data: { contentId, ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-11-14T00:00:00.000Z' },
    } : { error: 'NOT_FOUND' }, { status })
  }),
}) as W03ContentBinding & { fetch: ReturnType<typeof vi.fn> }

describe('repost runtime', () => {
  it('uses W03 publication context and creates one idempotent W05 relation', async () => {
    const store = memoryStore()
    const binding = publishedBinding()
    const first = await createRepost(binding, 'viewer-1', 'content-1', 'corr-1', store)
    const retry = await createRepost(binding, 'viewer-1', 'content-1', 'corr-2', store)
    expect(first).toMatchObject({ repostId: expect.any(String), contentId: 'content-1', actorUserId: 'viewer-1' })
    expect(retry).toEqual(first)
    expect(binding.fetch).toHaveBeenCalledTimes(2)
    const sent = binding.fetch.mock.calls[0]?.[0] as Request
    expect(sent.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(sent.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(sent.headers.has('Authorization')).toBe(false)
    expect(sent.headers.has('Cookie')).toBe(false)
  })

  it('rejects a blocked owner before reading or writing the relation', async () => {
    const store: RepostStore = {
      isBlocked: vi.fn(async () => true), find: vi.fn(),
      insertIfAbsent: vi.fn(), remove: vi.fn(),
    }
    await expect(createRepost(publishedBinding(), 'viewer-1', 'content-1', 'corr-1', store))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.isBlocked).toHaveBeenCalledWith('viewer-1', 'owner-1')
    expect(store.find).not.toHaveBeenCalled()
    expect(store.insertIfAbsent).not.toHaveBeenCalled()
  })

  it('fails closed before Store access when W03 does not publish the content', async () => {
    const store: RepostStore = {
      isBlocked: vi.fn(), find: vi.fn(), insertIfAbsent: vi.fn(), remove: vi.fn(),
    }
    await expect(createRepost(publishedBinding(404), 'viewer-1', 'content-1', 'corr-1', store))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.isBlocked).not.toHaveBeenCalled()
  })

  it('fails closed when the W03 binding is unavailable', async () => {
    const store: RepostStore = {
      isBlocked: vi.fn(), find: vi.fn(), insertIfAbsent: vi.fn(), remove: vi.fn(),
    }
    await expect(createRepost(undefined, 'viewer-1', 'content-1', 'corr-1', store))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(store.isBlocked).not.toHaveBeenCalled()
  })

  it('validates actor and content identifiers before Store access', async () => {
    const store: RepostStore = {
      isBlocked: vi.fn(), find: vi.fn(), insertIfAbsent: vi.fn(), remove: vi.fn(),
    }
    await expect(createRepost(publishedBinding(), '', 'content-1', 'corr-1', store))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    await expect(createRepost(publishedBinding(), 'viewer-1', 'content/1', 'corr-1', store))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(store.isBlocked).not.toHaveBeenCalled()
  })

  it('removes only the caller relation and treats repeated removal as successful', async () => {
    const own = { ...relation }
    const other = { ...relation, repost_id: 'repost-2', actor_user_id: 'other-user' }
    const store = memoryStore([own, other])
    await expect(removeRepost('viewer-1', 'content-1', store)).resolves.toBeUndefined()
    await expect(removeRepost('viewer-1', 'content-1', store)).resolves.toBeUndefined()
    await expect(store.find('other-user', 'content-1')).resolves.toEqual(other)
  })

  it('maps persistence failures to a sanitized service error', async () => {
    const store: RepostStore = {
      isBlocked: vi.fn(async () => { throw new RepostStoreError() }),
      find: vi.fn(), insertIfAbsent: vi.fn(), remove: vi.fn(),
    }
    await expect(createRepost(publishedBinding(), 'viewer-1', 'content-1', 'corr-1', store))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

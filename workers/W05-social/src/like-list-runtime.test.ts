import { describe, expect, it, vi } from 'vitest'
import { listContentLikers } from './like-list-runtime.js'
import {
  ContentLikerReadStoreError,
  type ContentLikerReadInput,
  type ContentLikerReadRow,
  type ContentLikerReadStore,
} from './like-list-read-store.js'
import type { PublishedContentSocialContext } from './w03-content-context-client.js'

const publishedContext = (
  contentId = 'content-1',
  ownerUserId: string | null = 'owner-1',
): PublishedContentSocialContext => ({
  contentId,
  ownerUserId,
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt: '2026-10-17T04:00:00.000Z',
})

const row = (relationshipId: string, actorUserId: string, createdAt: string): ContentLikerReadRow => ({
  relationship_id: relationshipId,
  actor_user_id: actorUserId,
  created_at: createdAt,
})

const storeFor = (
  rows: readonly ContentLikerReadRow[] = [],
  error?: Error,
): ContentLikerReadStore => ({
  list: vi.fn(async (_input: ContentLikerReadInput) => {
    if (error) throw error
    return rows
  }),
})

describe('W05 content like list runtime — Neon Store port only', () => {
  it('lists authoritative likes for published content in stable newest-first order', async () => {
    const store = storeFor([
      row('like-2', 'liker-2', '2026-10-19T10:00:00.000Z'),
      row('like-1', 'liker-1', '2026-10-18T10:00:00.000Z'),
    ])
    await expect(listContentLikers(store, 'content-1', null, 10, 'viewer-1', publishedContext())).resolves.toEqual({
      items: [
        { userId: 'liker-2', likedAt: '2026-10-19T10:00:00.000Z' },
        { userId: 'liker-1', likedAt: '2026-10-18T10:00:00.000Z' },
      ],
      nextCursor: null,
      hasMore: false,
    })
    expect(store.list).toHaveBeenCalledWith({
      contentId: 'content-1',
      contentOwnerUserId: 'owner-1',
      viewerUserId: 'viewer-1',
      cursor: null,
      limit: 11,
    })
  })

  it('returns a bounded next cursor and scopes it to content and viewer', async () => {
    const firstStore = storeFor([
      row('like-2', 'liker-2', '2026-10-19T10:00:00.000Z'),
      row('like-1', 'liker-1', '2026-10-18T10:00:00.000Z'),
    ])
    const page = await listContentLikers(firstStore, 'content-1', null, 1, 'viewer-1', publishedContext())
    expect(page.items).toEqual([{ userId: 'liker-2', likedAt: '2026-10-19T10:00:00.000Z' }])
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))

    const nextStore = storeFor([])
    await expect(listContentLikers(nextStore, 'content-1', page.nextCursor, 1, 'viewer-1', publishedContext()))
      .resolves.toMatchObject({ items: [], hasMore: false, nextCursor: null })
    expect(nextStore.list).toHaveBeenCalledWith({
      contentId: 'content-1',
      contentOwnerUserId: 'owner-1',
      viewerUserId: 'viewer-1',
      cursor: { createdAt: '2026-10-19T10:00:00.000Z', relationshipId: 'like-2' },
      limit: 2,
    })

    await expect(listContentLikers(storeFor([]), 'content-2', page.nextCursor, 1, 'viewer-1', publishedContext('content-2')))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listContentLikers(storeFor([]), 'content-1', page.nextCursor, 1, 'viewer-2', publishedContext()))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
  })

  it('fails closed when W03 context is mismatched before querying the Store', async () => {
    const store = storeFor()
    await expect(listContentLikers(store, 'content-1', null, 10, null, publishedContext('content-2')))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.list).not.toHaveBeenCalled()
  })

  it('validates target IDs, cursor shape, page size, and publication type before Store access', async () => {
    const store = storeFor()
    await expect(listContentLikers(store, '../content-1', null, 10, null, publishedContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listContentLikers(store, 'content-1', 'not-a-valid*cursor', 10, null, publishedContext()))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listContentLikers(store, 'content-1', null, 0, null, publishedContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listContentLikers(store, 'content-1', null, 51, null, publishedContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listContentLikers(store, 'content-1', null, 10, null, {
      ...publishedContext(), contentType: 'profile' as never,
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.list).not.toHaveBeenCalled()
  })

  it('maps Store failures to a sanitized 503', async () => {
    const store = storeFor([], new ContentLikerReadStoreError())
    await expect(listContentLikers(store, 'content-1', null, 10, 'viewer-1', publishedContext()))
      .rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'CONTENT_LIKER_READ_UNAVAILABLE',
      })
  })
})

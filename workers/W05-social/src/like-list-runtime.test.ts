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

const makeStore = (rows: readonly ContentLikerReadRow[] = []): ContentLikerReadStore => ({
  list: vi.fn(async (_input: ContentLikerReadInput) => rows),
})

describe('W05 content like list runtime', () => {
  it('lists authoritative likes for published content in stable newest-first order', async () => {
    const rows: ContentLikerReadRow[] = [
      { relationship_id: 'like-2', actor_user_id: 'liker-2', created_at: '2026-10-19T10:00:00.000Z' },
      { relationship_id: 'like-1', actor_user_id: 'liker-1', created_at: '2026-10-18T10:00:00.000Z' },
    ]
    const store = makeStore(rows)

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

  it('returns a bounded next cursor and scopes it to content and viewer before Store access', async () => {
    const store = makeStore([
      { relationship_id: 'like-2', actor_user_id: 'liker-2', created_at: '2026-10-19T10:00:00.000Z' },
      { relationship_id: 'like-1', actor_user_id: 'liker-1', created_at: '2026-10-18T10:00:00.000Z' },
    ])
    const page = await listContentLikers(store, 'content-1', null, 1, 'viewer-1', publishedContext())
    expect(page.items).toEqual([{ userId: 'liker-2', likedAt: '2026-10-19T10:00:00.000Z' }])
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
    expect(store.list).toHaveBeenCalledWith({
      contentId: 'content-1',
      contentOwnerUserId: 'owner-1',
      viewerUserId: 'viewer-1',
      cursor: null,
      limit: 2,
    })

    const rejectedStore = makeStore()
    await expect(listContentLikers(rejectedStore, 'content-2', page.nextCursor, 1, 'viewer-1', publishedContext('content-2')))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listContentLikers(rejectedStore, 'content-1', page.nextCursor, 1, 'viewer-2', publishedContext()))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(rejectedStore.list).not.toHaveBeenCalled()
  })

  it('fails closed when W03 context is mismatched before querying the injected Store', async () => {
    const store = makeStore()
    await expect(listContentLikers(store, 'content-1', null, 10, null, publishedContext('content-2')))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.list).not.toHaveBeenCalled()
  })

  it('validates target IDs, cursor shape, and page size before querying the Store', async () => {
    const store = makeStore()
    await expect(listContentLikers(store, '../content-1', null, 10, null, publishedContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listContentLikers(store, 'content-1', 'not-a-valid*cursor', 10, null, publishedContext()))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listContentLikers(store, 'content-1', null, 0, null, publishedContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listContentLikers(store, 'content-1', null, 51, null, publishedContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(store.list).not.toHaveBeenCalled()
  })

  it('maps injected content liker Store failures to a sanitized 503', async () => {
    const store: ContentLikerReadStore = {
      list: vi.fn(async () => { throw new ContentLikerReadStoreError() }),
    }
    await expect(listContentLikers(store, 'content-1', null, 10, 'viewer-1', publishedContext()))
      .rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'CONTENT_LIKER_READ_UNAVAILABLE',
      })
  })
})

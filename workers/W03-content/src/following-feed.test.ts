/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listFollowingOwnerContents } from './content-runtime.js'
import { createW03ContentWorker } from './index.js'

const rows = [
  {
    id: 'content-1',
    content_type: 'post' as const,
    owner_user_id: 'creator-1',
    creator_id: 'creator-1',
    ip_id: null,
    state: 'PUBLISHED' as const,
    scheduled_at: null,
    version: 1,
    revision: 1,
    slug: 'post-one',
    title: 'A public post',
    body_ref: 'body-one',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"1"',
    created_at: '2026-10-16T12:00:00.000Z',
    updated_at: '2026-10-16T12:00:00.000Z',
  },
  {
    id: 'content-2',
    content_type: 'article' as const,
    owner_user_id: 'creator-2',
    creator_id: 'creator-2',
    ip_id: null,
    state: 'PUBLISHED' as const,
    scheduled_at: null,
    version: 1,
    revision: 1,
    slug: 'article-two',
    title: 'A public article',
    body_ref: 'body-two',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"1"',
    created_at: '2026-10-16T11:00:00.000Z',
    updated_at: '2026-10-16T11:00:00.000Z',
  },
]


describe('W03 Following content projection', () => {
  it('queries published content through the Neon read store with stable pagination', async () => {
    const list = vi.fn(async () => rows)
    const page = await listFollowingOwnerContents({} as never, 'viewer-1', ['creator-2', 'creator-1'], null, 1, { list })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      id: 'content-1',
      ownerUserId: 'creator-1',
      creatorId: 'creator-1',
      state: 'PUBLISHED',
      contentType: 'post',
    })
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBeTruthy()
    expect(list).toHaveBeenCalledWith(['creator-1', 'creator-2'], null, 2)
  })

  it('uses the injected Neon read store without calling a fallback adapter', async () => {
    const list = vi.fn(async () => rows)
    const store = { list }
    const page = await listFollowingOwnerContents(
      {} as never,
      'viewer-1',
      ['creator-2', 'creator-1', 'creator-2'],
      null,
      1,
      store,
    )
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.id).toBe('content-1')
    expect(list).toHaveBeenCalledWith(['creator-1', 'creator-2'], null, 2)
  })

  it('binds cursors to the viewer and followed-author scope', async () => {
    const store = { list: async () => rows }
    const page = await listFollowingOwnerContents({} as never, 'viewer-1', ['creator-1', 'creator-2'], null, 1, store)
    await expect(
      listFollowingOwnerContents({} as never, 'viewer-2', ['creator-1', 'creator-2'], page.nextCursor, 1, store),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
    await expect(
      listFollowingOwnerContents({} as never, 'viewer-1', ['creator-1'], page.nextCursor, 1, store),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
  })

  it('rejects an empty or overlarge author set', async () => {
    const store = { list: async () => rows }
    await expect(listFollowingOwnerContents({} as never, 'viewer-1', [], null, 6, store))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(listFollowingOwnerContents({} as never, 'viewer-1', Array.from({ length: 501 }, (_, i) => 'creator-' + i), null, 6, store))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

describe('W03 private Following endpoint', () => {

  it('routes the authorized HTTP feed projection through the injected Neon store', async () => {
    const list = vi.fn(async () => rows)
    const neonWorker = createW03ContentWorker({
      followingOwnerContentsReadStoreProvider: () => ({ list }),
    })
    const response = await neonWorker.fetch(
      new Request('https://luckread-w03.internal/internal/content/following-feed', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W04',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'w03-following-neon-test',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
        body: JSON.stringify({ ownerUserIds: ['creator-1', 'creator-2'], limit: 1, cursor: null }),
      }),
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ id: 'content-1' }], hasMore: true },
    })
    expect(list).toHaveBeenCalledWith(
      expect.any(Array),
      null,
      2,
    )
  })

  it('rejects browser/spoofed callers and malformed author sets before data access', async () => {
    const env = {} as never
    const denied = await createW03ContentWorker().fetch(
      new Request('https://luckread-w03.internal/internal/content/following-feed', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'wrong-caller',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
        body: JSON.stringify({ ownerUserIds: ['creator-1'], limit: 6 }),
      }),
      env,
    )
    expect(denied.status).toBe(403)

    const invalid = await createW03ContentWorker().fetch(
      new Request('https://luckread-w03.internal/internal/content/following-feed', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W04',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'bad-authors',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
        body: JSON.stringify({ ownerUserIds: [], limit: 6 }),
      }),
      env,
    )
    expect(invalid.status).toBe(422)
  })
})

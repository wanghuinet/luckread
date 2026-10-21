/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listProfileLikedContents, listProfileReplies } from './profile-channel-runtime.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const publishedContextsBinding = (): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const body = await request.json() as { contentIds: string[] }
    return Response.json({ data: { items: body.contentIds.map(contentId => ({
      contentId, ownerUserId: 'owner-2', contentType: 'post', state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })) } })
  }),
})

const db = (allResults: unknown[] = []) => {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      all: vi.fn(async () => ({ results: allResults, sql, args })),
      first: vi.fn(async () => null),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
    })),
  }))
  return { prepare } as unknown as D1Database & { prepare: ReturnType<typeof vi.fn> }
}

describe('W05 profile channel runtime', () => {
  it('lists only published author comments attached to published content and applies block/mute visibility', async () => {
    const d = db([{
      id: 'comment-2',
      content_id: 'content-1',
      author_user_id: 'user-1',
      parent_id: 'comment-1',
      body: 'A reply',
      state: 'PUBLISHED',
      depth: 1,
      created_at: '2026-10-15T10:00:00.000Z',
      updated_at: '2026-10-15T10:00:00.000Z',
    }])
    const binding = publishedContextsBinding()
    const page = await listProfileReplies(d, binding, 'user-1', null, 10, 'viewer-1', 'profile-test')
    expect(page.items).toEqual([{
      id: 'comment-2',
      contentId: 'content-1',
      authorUserId: 'user-1',
      parentId: 'comment-1',
      body: 'A reply',
      state: 'PUBLISHED',
      depth: 1,
      createdAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z',
    }])
    const queries = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => String(query))
    expect(queries.some(query => query.includes("c.state = 'PUBLISHED'"))).toBe(true)
    expect(queries.every(query => !query.toLowerCase().includes('join contents') && !query.toLowerCase().includes('from contents'))).toBe(true)
    expect(queries.some(query => query.includes("block.relation_type = 'block'"))).toBe(true)
    expect(queries.some(query => query.includes("mute.relation_type = 'mute'"))).toBe(true)
    expect(queries[0]).toContain('ORDER BY c.created_at DESC, c.id DESC')
    expect(binding.fetch).toHaveBeenCalledTimes(1)
  })

  it('scopes reply cursors to the author and current viewer', async () => {
    const d = db([
      { id: 'c2', content_id: 'content-1', author_user_id: 'user-1', parent_id: null, body: 'two', state: 'PUBLISHED', depth: 0, created_at: '2026-10-15T10:00:00.000Z', updated_at: '2026-10-15T10:00:00.000Z' },
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', parent_id: null, body: 'one', state: 'PUBLISHED', depth: 0, created_at: '2026-10-14T10:00:00.000Z', updated_at: '2026-10-14T10:00:00.000Z' },
    ])
    const page = await listProfileReplies(d, publishedContextsBinding(), 'user-1', null, 1, 'viewer-1', 'profile-test')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
    await expect(listProfileReplies(db(), undefined, 'user-2', page.nextCursor, 1, 'viewer-1', 'profile-test')).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listProfileReplies(db(), undefined, 'user-1', page.nextCursor, 1, 'viewer-2', 'profile-test')).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
  })

  it('fails closed when parent content context cannot be fetched', async () => {
    const d = db([{
      id: 'comment-2', content_id: 'content-1', author_user_id: 'user-1', parent_id: null,
      body: 'Reply', state: 'PUBLISHED', depth: 0,
      created_at: '2026-10-15T10:00:00.000Z', updated_at: '2026-10-15T10:00:00.000Z',
    }])
    await expect(listProfileReplies(d, undefined, 'user-1', null, 10, null, 'profile-test'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('lists only content likes whose underlying content remains published', async () => {
    const d = db([
      { relationship_id: 'like-1', target_id: 'content-1', created_at: '2026-10-15T10:00:00.000Z' },
    ])
    await expect(listProfileLikedContents(d, 'user-1', null, 10, 'viewer-2')).resolves.toEqual({
      items: [{ contentId: 'content-1', likedAt: '2026-10-15T10:00:00.000Z' }],
      nextCursor: null,
      hasMore: false,
    })
    const query = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(query).toContain('FROM interaction_likes il')
    expect(query).toContain("il.target_type = 'content'")
    expect(query).toContain("content.state = 'PUBLISHED'")
    expect(query).toContain("block.relation_type = 'block'")
    expect(query).toContain("mute.relation_type = 'mute'")
    expect(query).toContain('ORDER BY il.created_at DESC, il.relationship_id DESC')
  })

  it('uses a viewer- and profile-scoped opaque likes cursor and validates limits', async () => {
    const d = db([
      { relationship_id: 'like-2', target_id: 'content-2', created_at: '2026-10-15T10:00:00.000Z' },
      { relationship_id: 'like-1', target_id: 'content-1', created_at: '2026-10-14T10:00:00.000Z' },
    ])
    const page = await listProfileLikedContents(d, 'user-1', null, 1, 'viewer-1')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
    await expect(listProfileLikedContents(db(), 'user-2', page.nextCursor, 1, 'viewer-1')).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listProfileLikedContents(db(), 'user-1', null, 51)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })
})

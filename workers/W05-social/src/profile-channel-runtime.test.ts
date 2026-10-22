/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listProfileLikedContents, listProfileReplies } from './profile-channel-runtime.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const publishedContextsBinding = (): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const body = await request.clone().json() as { contentIds: string[] }
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
    expect(queries[1]).toContain('ORDER BY c.created_at DESC, c.id DESC')
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

  it('validates profile liked-content visibility through one W03 batch and keeps W05 owner Block/Mute filtering', async () => {
    const d = db([
      { relationship_id: 'like-1', target_id: 'content-1', created_at: '2026-10-15T10:00:00.000Z' },
    ])
    const binding = publishedContextsBinding()
    await expect(listProfileLikedContents(d, binding, 'user-1', null, 10, 'viewer-2', 'profile-likes-test')).resolves.toEqual({
      items: [{ contentId: 'content-1', likedAt: '2026-10-15T10:00:00.000Z' }],
      nextCursor: null,
      hasMore: false,
    })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const sent = binding.fetch.mock.calls[0]?.[0] as Request
    expect(sent.url).toContain('/internal/content/published-social-context-batch')
    expect(sent.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(sent.headers.has('Authorization')).toBe(false)
    expect(sent.headers.has('Cookie')).toBe(false)
    await expect(sent.json()).resolves.toEqual({ contentIds: ['content-1'] })
    const queries = (d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => String(query))
    expect(queries.some(query => query.includes('FROM interaction_likes il'))).toBe(true)
    expect(queries.some(query => query.includes("relation_type = 'block'"))).toBe(true)
    expect(queries.some(query => query.includes("relation_type = 'mute'"))).toBe(true)
    expect(queries.every(query => !query.toLowerCase().includes('join contents') && !query.toLowerCase().includes('from contents'))).toBe(true)
    expect(queries.find(query => query.includes('FROM interaction_likes il'))).toContain('ORDER BY il.created_at DESC, il.relationship_id DESC')
  })

  it('fails closed when W03 cannot validate a liked content target', async () => {
    const d = db([
      { relationship_id: 'like-1', target_id: 'content-1', created_at: '2026-10-15T10:00:00.000Z' },
    ])
    const binding = { fetch: vi.fn(async () => Response.json({ error: { code: 'SERVICE_UNAVAILABLE' } }, { status: 503 })) }
    await expect(listProfileLikedContents(d, binding, 'user-1', null, 10, null, 'profile-likes-unavailable'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('filters unpublished, blocked-owner and muted-owner liked content after W03 context validation', async () => {
    const candidates = [
      { relationship_id: 'like-1', target_id: 'content-blocked', created_at: '2026-10-15T12:00:00.000Z' },
      { relationship_id: 'like-2', target_id: 'content-muted', created_at: '2026-10-15T11:00:00.000Z' },
      { relationship_id: 'like-3', target_id: 'content-unpublished', created_at: '2026-10-15T10:00:00.000Z' },
      { relationship_id: 'like-4', target_id: 'content-visible', created_at: '2026-10-15T09:00:00.000Z' },
    ]
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((..._args: unknown[]) => ({
        all: vi.fn(async () => {
          if (sql.includes('FROM interaction_likes il')) return { results: candidates }
          if (sql.includes("relation_type = 'block'")) return { results: [{ actor_user_id: 'user-1', target_user_id: 'owner-blocked' }] }
          if (sql.includes("relation_type = 'mute'")) return { results: [{ target_user_id: 'owner-muted' }] }
          return { results: [] }
        }),
        first: vi.fn(async () => null),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      })),
    }))
    const d = { prepare } as unknown as D1Database
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const body = await request.json() as { contentIds: string[] }
        const ownerByContentId: Record<string, string | null> = {
          'content-blocked': 'owner-blocked',
          'content-muted': 'owner-muted',
          'content-unpublished': 'owner-missing',
          'content-visible': 'owner-visible',
        }
        return Response.json({ data: { items: body.contentIds
          .filter(contentId => contentId !== 'content-unpublished')
          .map(contentId => ({
            contentId,
            ownerUserId: ownerByContentId[contentId] ?? null,
            contentType: 'post',
            state: 'PUBLISHED',
            updatedAt: '2026-10-17T04:00:00.000Z',
          })) } })
      }),
    } as W03ContentBinding & { fetch: ReturnType<typeof vi.fn> }
    const page = await listProfileLikedContents(d, binding, 'user-1', null, 10, 'viewer-2', 'profile-likes-visibility')
    expect(page.items).toEqual([{ contentId: 'content-visible', likedAt: '2026-10-15T09:00:00.000Z' }])
    expect(page.hasMore).toBe(false)
    expect(prepare.mock.calls.some(([sql]) => String(sql).toLowerCase().includes('join contents') || String(sql).toLowerCase().includes('from contents'))).toBe(false)
  })

  it('uses a viewer- and profile-scoped opaque likes cursor and validates limits', async () => {
    const d = db([
      { relationship_id: 'like-2', target_id: 'content-2', created_at: '2026-10-15T10:00:00.000Z' },
      { relationship_id: 'like-1', target_id: 'content-1', created_at: '2026-10-14T10:00:00.000Z' },
    ])
    const page = await listProfileLikedContents(d, publishedContextsBinding(), 'user-1', null, 1, 'viewer-1', 'profile-likes-cursor')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
    await expect(listProfileLikedContents(db(), undefined, 'user-2', page.nextCursor, 1, 'viewer-1', 'profile-likes-cursor')).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listProfileLikedContents(db(), undefined, 'user-1', null, 51, null, 'profile-likes-cursor')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })
})

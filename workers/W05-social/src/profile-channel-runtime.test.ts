/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listProfileLikedContents, listProfileReplies } from './profile-channel-runtime.js'

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
    const page = await listProfileReplies(d, 'user-1', null, 10, 'viewer-1')
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
    const query = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(query).toContain("c.state = 'PUBLISHED'")
    expect(query).toContain("content.state = 'PUBLISHED'")
    expect(query).toContain("block.relation_type = 'block'")
    expect(query).toContain("mute.relation_type = 'mute'")
    expect(query).toContain('ORDER BY c.created_at DESC, c.id DESC')
  })

  it('scopes reply cursors to the author and current viewer', async () => {
    const d = db([
      { id: 'c2', content_id: 'content-1', author_user_id: 'user-1', parent_id: null, body: 'two', state: 'PUBLISHED', depth: 0, created_at: '2026-10-15T10:00:00.000Z', updated_at: '2026-10-15T10:00:00.000Z' },
      { id: 'c1', content_id: 'content-1', author_user_id: 'user-1', parent_id: null, body: 'one', state: 'PUBLISHED', depth: 0, created_at: '2026-10-14T10:00:00.000Z', updated_at: '2026-10-14T10:00:00.000Z' },
    ])
    const page = await listProfileReplies(d, 'user-1', null, 1, 'viewer-1')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
    await expect(listProfileReplies(db(), 'user-2', page.nextCursor, 1, 'viewer-1')).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listProfileReplies(db(), 'user-1', page.nextCursor, 1, 'viewer-2')).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
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

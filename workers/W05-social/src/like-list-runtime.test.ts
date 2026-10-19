/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listContentLikers } from './like-list-runtime.js'

const db = (allResults: unknown[] = []) => {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      all: vi.fn(async () => ({ results: allResults, sql, args })),
    })),
  }))
  return { prepare } as unknown as D1Database & { prepare: ReturnType<typeof vi.fn> }
}

describe('W05 content like list runtime', () => {
  it('lists authoritative likes for published content in stable newest-first order', async () => {
    const d = db([
      { relationship_id: 'like-2', actor_user_id: 'liker-2', created_at: '2026-10-19T10:00:00.000Z' },
      { relationship_id: 'like-1', actor_user_id: 'liker-1', created_at: '2026-10-18T10:00:00.000Z' },
    ])
    await expect(listContentLikers(d, 'content-1', null, 10, 'viewer-1')).resolves.toEqual({
      items: [
        { userId: 'liker-2', likedAt: '2026-10-19T10:00:00.000Z' },
        { userId: 'liker-1', likedAt: '2026-10-18T10:00:00.000Z' },
      ],
      nextCursor: null,
      hasMore: false,
    })
    const query = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(query).toContain('FROM interaction_likes il')
    expect(query).toContain("il.target_type = 'content'")
    expect(query).toContain("content.state = 'PUBLISHED'")
    expect(query).toContain("content_block.relation_type = 'block'")
    expect(query).toContain("viewer_block.relation_type = 'block'")
    expect(query).toContain("liker_block.relation_type = 'block'")
    expect(query).toContain('ORDER BY il.created_at DESC, il.relationship_id DESC')
    expect(query).not.toContain('INSERT INTO')
    expect(query).not.toContain('UPDATE interaction_likes')
  })

  it('returns a bounded next cursor and scopes it to content and viewer', async () => {
    const page = await listContentLikers(db([
      { relationship_id: 'like-2', actor_user_id: 'liker-2', created_at: '2026-10-19T10:00:00.000Z' },
      { relationship_id: 'like-1', actor_user_id: 'liker-1', created_at: '2026-10-18T10:00:00.000Z' },
    ]), 'content-1', null, 1, 'viewer-1')
    expect(page.items).toEqual([{ userId: 'liker-2', likedAt: '2026-10-19T10:00:00.000Z' }])
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
    await expect(listContentLikers(db(), 'content-2', page.nextCursor, 1, 'viewer-1'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listContentLikers(db(), 'content-1', page.nextCursor, 1, 'viewer-2'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
  })

  it('validates target IDs, cursor shape, and page size', async () => {
    await expect(listContentLikers(db(), '../content-1', null, 10)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listContentLikers(db(), 'content-1', 'not-a-valid*cursor', 10)).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listContentLikers(db(), 'content-1', null, 0)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listContentLikers(db(), 'content-1', null, 51)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })
})

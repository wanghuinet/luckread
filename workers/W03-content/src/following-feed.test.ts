/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listFollowingCreatorContents } from './content-runtime.js'

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

const mockDb = () => {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...values: unknown[]) => ({
      all: vi.fn(async () => ({ results: rows })),
      sql,
      values,
    })),
  }))
  return { db: { prepare } as unknown as D1Database, prepare }
}

describe('W03 Following content projection', () => {
  it('queries only published content for the W05-supplied creator set and returns stable pagination', async () => {
    const { db, prepare } = mockDb()
    const page = await listFollowingCreatorContents(db, 'viewer-1', ['creator-2', 'creator-1'], null, 1)
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
    const sql = String(prepare.mock.calls[0]?.[0] ?? '')
    expect(sql).toContain("c.state = 'PUBLISHED'")
    expect(sql).toContain('json_each(?)')
    expect(sql).not.toContain('social_follow_relationships')
    expect(sql).not.toContain('social_user_interactions')
  })

  it('binds cursors to the viewer and followed-author scope', async () => {
    const { db } = mockDb()
    const page = await listFollowingCreatorContents(db, 'viewer-1', ['creator-1', 'creator-2'], null, 1)
    await expect(
      listFollowingCreatorContents(db, 'viewer-2', ['creator-1', 'creator-2'], page.nextCursor, 1),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
    await expect(
      listFollowingCreatorContents(db, 'viewer-1', ['creator-1'], page.nextCursor, 1),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
  })

  it('rejects an empty or overlarge author set', async () => {
    const { db } = mockDb()
    await expect(listFollowingCreatorContents(db, 'viewer-1', [], null, 6))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(listFollowingCreatorContents(db, 'viewer-1', Array.from({ length: 501 }, (_, i) => 'creator-' + i), null, 6))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

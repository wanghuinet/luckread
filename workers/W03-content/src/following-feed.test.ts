/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listFollowingCreatorContents } from './content-runtime.js'
import worker from './index.js'

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

describe('W03 private Following endpoint', () => {
  it('accepts only W04 service transport and projects published content', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        all: vi.fn(async () => ({ results: rows })),
        sql,
        values,
      })),
    }))
    const env = { D1_02: { prepare } as unknown as D1Database }
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/following-feed', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W04',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'w03-following-test',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
        body: JSON.stringify({ creatorIds: ['creator-1', 'creator-2'], limit: 1, cursor: null }),
      }),
      env,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{ id: 'content-1', creatorId: 'creator-1', state: undefined }],
        hasMore: true,
      },
    })
    expect(String(prepare.mock.calls[0]?.[0] ?? '')).toContain("c.state = 'PUBLISHED'")
  })

  it('rejects browser/spoofed callers and malformed author sets before querying D1', async () => {
    const prepare = vi.fn()
    const env = { D1_02: { prepare } as unknown as D1Database }
    const denied = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/following-feed', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'wrong-caller',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
        body: JSON.stringify({ creatorIds: ['creator-1'], limit: 6 }),
      }),
      env,
    )
    expect(denied.status).toBe(403)

    const invalid = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/following-feed', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W04',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'bad-authors',
          'X-LuckRead-Principal-User-Id': 'viewer-1',
        },
        body: JSON.stringify({ creatorIds: [], limit: 6 }),
      }),
      env,
    )
    expect(invalid.status).toBe(422)
    expect(prepare).not.toHaveBeenCalled()
  })
})

/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createRepost, removeRepost } from './repost-runtime.js'

const db = (firstResults: unknown[] = [], changes = 1) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ sql, args, meta: { changes } })),
    })),
  }))
  return { prepare } as unknown as D1Database
}
const content = { id: 'content-1', state: 'PUBLISHED', owner_user_id: 'owner-1', blocked: 0 }
const relation = {
  repost_id: 'repost-1', content_id: 'content-1', actor_user_id: 'viewer-1',
  created_at: '2026-10-15T00:00:00.000Z',
}

describe('repost runtime', () => {
  it('stores a small relation to canonical content rather than copying it', async () => {
    const d = db([content, null, relation])
    await expect(createRepost(d, 'viewer-1', 'content-1')).resolves.toEqual({
      repostId: 'repost-1', contentId: 'content-1', actorUserId: 'viewer-1',
      createdAt: relation.created_at,
    })
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(String(prepare.mock.calls[2]?.[0])).toContain('INSERT OR IGNORE INTO social_reposts')
    expect(String(prepare.mock.calls[2]?.[0])).toContain('SELECT ?, c.id')
    expect(String(prepare.mock.calls[2]?.[0])).not.toContain('body')
  })
  it('returns the existing relation for a repeated repost', async () => {
    const d = db([content, relation])
    await expect(createRepost(d, 'viewer-1', 'content-1')).resolves.toMatchObject({
      repostId: 'repost-1', contentId: 'content-1',
    })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).toHaveBeenCalledTimes(2)
  })
  it('rejects unpublished, absent, and blocked content', async () => {
    await expect(createRepost(db([{ ...content, state: 'DRAFT' }]), 'viewer-1', 'content-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(createRepost(db([{ ...content, blocked: 1 }]), 'viewer-1', 'content-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(createRepost(db([null]), 'viewer-1', 'content-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })
  it('validates actor identity and content identifiers', async () => {
    await expect(createRepost(db(), '', 'content-1')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    await expect(createRepost(db(), 'viewer-1', ' ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })
  it('rejects path separators before querying D1', async () => {
    const d = db()
    await expect(createRepost(d, 'viewer-1', 'content/1'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('removes only the caller relation and tolerates a repeated remove', async () => {
    const d = db([], 0)
    await expect(removeRepost(d, 'viewer-1', 'content-1')).resolves.toBeUndefined()
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(String(prepare.mock.calls[0]?.[0])).toContain('DELETE FROM social_reposts WHERE actor_user_id = ? AND content_id = ?')
  })
})

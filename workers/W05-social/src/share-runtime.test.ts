/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createShare, resolveShare } from './share-runtime.js'

const db = (firstResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ sql, args })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

describe('share runtime', () => {
  it('creates a share token for published content', async () => {
    const d = db([
      { id: 'content-1', state: 'PUBLISHED' },
      {
        share_id: 'share-1',
        content_id: 'content-1',
        actor_user_id: 'user-1',
        created_at: '2026-10-02T00:00:00.000Z',
      },
    ])
    const result = await createShare(d, 'user-1', 'content-1', 'share-request-1')
    expect(result).toMatchObject({ shareId: 'share-1', contentId: 'content-1', actorUserId: 'user-1' })
  })

  it('is idempotent for the same actor and key', async () => {
    const d = db([
      { id: 'content-1', state: 'PUBLISHED' },
      {
        share_id: 'share-existing',
        content_id: 'content-1',
        actor_user_id: 'user-1',
        created_at: '2026-10-02T00:00:00.000Z',
      },
    ])
    await expect(createShare(d, 'user-1', 'content-1', 'same-key')).resolves.toMatchObject({
      shareId: 'share-existing',
      contentId: 'content-1',
    })
  })

  it('rejects reuse of the same key for another content item', async () => {
    const d = db([
      { id: 'content-2', state: 'PUBLISHED' },
      {
        share_id: 'share-existing',
        content_id: 'content-1',
        actor_user_id: 'user-1',
        created_at: '2026-10-02T00:00:00.000Z',
      },
    ])
    await expect(createShare(d, 'user-1', 'content-2', 'same-key')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })

  it('resolves only shares whose content is still published', async () => {
    const d = db([{
      share_id: 'share-1',
      content_id: 'content-1',
      created_at: '2026-10-02T00:00:00.000Z',
      state: 'PUBLISHED',
    }])
    await expect(resolveShare(d, 'share-1')).resolves.toEqual({
      shareId: 'share-1',
      contentId: 'content-1',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
  })

  it('fails closed for an unpublished or missing share', async () => {
    await expect(resolveShare(db([null]), 'share-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
  })

  it('rejects invalid actor and idempotency inputs', async () => {
    await expect(createShare(db(), '', 'content-1', 'key')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
    await expect(createShare(db(), 'user-1', 'content-1', '')).rejects.toMatchObject({
      code: 'PRECONDITION_REQUIRED',
      status: 428,
    })
  })
})

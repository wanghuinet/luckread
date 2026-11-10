import { describe, expect, it, vi } from 'vitest'
import { createD1ReplyAudienceStore, type ReplyAudienceD1QueryExecutor } from './reply-audience-store.js'

const row = {
  content_id: 'content-1',
  owner_user_id: 'owner-1',
  audience: 'mentioned' as const,
  mentioned_user_ids_json: '["user-2"]',
  updated_at: '2026-11-10T00:00:00.000Z',
}

describe('W05 D1 reply-audience store', () => {
  it('upserts an owner-scoped policy and maps the returned row', async () => {
    const first = vi.fn(async () => row)
    const bind = vi.fn(() => ({ first }))
    const prepare = vi.fn(() => ({ bind }))
    const store = createD1ReplyAudienceStore({ prepare } as unknown as ReplyAudienceD1QueryExecutor)

    await expect(store.set({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      audience: 'mentioned',
      mentionedUserIdsJson: '["user-2"]',
      now: row.updated_at,
    })).resolves.toEqual({
      contentId: row.content_id,
      ownerUserId: row.owner_user_id,
      audience: row.audience,
      mentionedUserIdsJson: row.mentioned_user_ids_json,
      updatedAt: row.updated_at,
    })
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(content_id) DO UPDATE'))
    expect(bind).toHaveBeenCalledWith(
      'content-1', 'owner-1', 'mentioned', '["user-2"]', row.updated_at, row.updated_at,
    )
  })

  it('uses both content and owner predicates for reads', async () => {
    const first = vi.fn(async () => row)
    const bind = vi.fn(() => ({ first }))
    const prepare = vi.fn(() => ({ bind }))
    const store = createD1ReplyAudienceStore({ prepare } as unknown as ReplyAudienceD1QueryExecutor)

    await expect(store.get('content-1', 'owner-1')).resolves.toMatchObject({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
    })
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE content_id = ? AND owner_user_id = ?'))
    expect(bind).toHaveBeenCalledWith('content-1', 'owner-1')
  })

  it('returns null for owner-conflict upserts and sanitizes adapter errors', async () => {
    const noRow = createD1ReplyAudienceStore({
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    })
    await expect(noRow.set({
      contentId: 'content-1',
      ownerUserId: 'other-owner',
      audience: 'everyone',
      mentionedUserIdsJson: '[]',
      now: row.updated_at,
    })).resolves.toBeNull()

    const broken = createD1ReplyAudienceStore({
      prepare: () => ({ bind: () => ({ first: async () => { throw new Error('private-database-detail') } }) }),
    })
    await expect(broken.get('content-1', 'owner-1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'REPLY_AUDIENCE_STORE_UNAVAILABLE',
    })
  })
})

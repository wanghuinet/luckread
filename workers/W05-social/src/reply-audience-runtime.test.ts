/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import {
  getContentReplyAudience,
  replyAudienceAllowedParams,
  replyAudienceAllowedSql,
  setContentReplyAudience,
} from './reply-audience-runtime.js'

const db = (firstResults: unknown[] = []) => {
  let index = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[index++] ?? null),
      run: vi.fn(async () => ({ success: true, meta: { changes: 1 }, sql, args })),
    })),
  }))
  return { prepare } as unknown as D1Database & { prepare: ReturnType<typeof vi.fn> }
}

describe('W05 reply audience runtime', () => {
  it('persists a verified-only policy only for the authenticated post owner', async () => {
    const d = db([
      { id: 'content-1', owner_user_id: 'owner-1', content_type: 'post', state: 'DRAFT' },
      {
        content_id: 'content-1',
        owner_user_id: 'owner-1',
        audience: 'verified',
        mentioned_user_ids_json: '[]',
        updated_at: '2026-10-19T00:00:00.000Z',
      },
    ])
    await expect(setContentReplyAudience(d, 'owner-1', 'content-1', 'verified')).resolves.toMatchObject({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      replyAudience: 'verified',
      mentionedUserIds: [],
    })
    const prepare = d.prepare as unknown as ReturnType<typeof vi.fn>
    expect(String(prepare.mock.calls[1]?.[0])).toContain('ON CONFLICT(content_id) DO UPDATE')
    expect(String(prepare.mock.calls[1]?.[0])).toContain("content.state IN ('DRAFT','PUBLISHED','UNPUBLISHED')")
  })

  it('rejects a non-owner without attempting a policy write', async () => {
    const d = db([{ id: 'content-1', owner_user_id: 'someone-else', content_type: 'post', state: 'PUBLISHED' }])
    await expect(setContentReplyAudience(d, 'viewer-1', 'content-1', 'following'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect((d.prepare as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })

  it('rejects non-post and invalid audience values', async () => {
    await expect(setContentReplyAudience(
      db([{ id: 'content-1', owner_user_id: 'owner-1', content_type: 'article', state: 'DRAFT' }]),
      'owner-1', 'content-1', 'everyone',
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    await expect(setContentReplyAudience(
      db([{ id: 'content-1', owner_user_id: 'owner-1', content_type: 'post', state: 'DRAFT' }]),
      'owner-1', 'content-1', 'anyone',
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('stores only a bounded, de-duplicated mention allowlist for mentioned-only replies', async () => {
    const d = db([
      { id: 'content-1', owner_user_id: 'owner-1', content_type: 'post', state: 'DRAFT' },
      {
        content_id: 'content-1',
        owner_user_id: 'owner-1',
        audience: 'mentioned',
        mentioned_user_ids_json: '["user-2"]',
        updated_at: '2026-10-19T00:00:00.000Z',
      },
    ])
    await setContentReplyAudience(d, 'owner-1', 'content-1', 'mentioned', ['user-2', 'user-2'])
    const prepare = d.prepare as unknown as ReturnType<typeof vi.fn>
    expect(prepare.mock.calls[1]?.[0]).toContain('mentioned_user_ids_json')
    expect(prepare.mock.calls[1]?.[0]).toContain('RETURNING')
  })

  it('returns the persisted owner policy and defaults existing posts to everyone', async () => {
    await expect(getContentReplyAudience(db([{
      id: 'content-1',
      owner_user_id: 'owner-1',
      content_type: 'post',
      audience: 'followingNetwork',
      mentioned_user_ids_json: '[]',
      updated_at: '2026-10-19T00:00:00.000Z',
    }]), 'owner-1', 'content-1')).resolves.toMatchObject({ replyAudience: 'followingNetwork' })

    await expect(getContentReplyAudience(db([{
      id: 'content-1',
      owner_user_id: 'owner-1',
      content_type: 'post',
      audience: 'everyone',
      mentioned_user_ids_json: '[]',
      updated_at: '2026-10-19T00:00:00.000Z',
    }]), 'owner-1', 'content-1')).resolves.toMatchObject({ replyAudience: 'everyone' })
  })

  it('uses W05 follow, mention, second-degree, and trusted verified facts in the final SQL predicate', () => {
    expect(replyAudienceAllowedSql).toContain('social_follow_relationships')
    expect(replyAudienceAllowedSql).toContain('json_each')
    expect(replyAudienceAllowedSql).toContain('second_degree')
    expect(replyAudienceAllowedSql).toContain("= 'verified'")
    expect(replyAudienceAllowedParams('reply-1', true)).toEqual(['reply-1', 1, 'reply-1', 'reply-1', 'reply-1', 'reply-1'])
  })
})

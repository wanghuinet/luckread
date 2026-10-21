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
  const bindCalls: unknown[][] = []
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => {
      bindCalls.push(args)
      return {
        first: vi.fn(async () => firstResults[index++] ?? null),
        run: vi.fn(async () => ({ success: true, meta: { changes: 1 }, sql, args })),
      }
    }),
  }))
  return { prepare, bindCalls } as unknown as D1Database & { prepare: ReturnType<typeof vi.fn>; bindCalls: unknown[][] }
}

describe('W05 reply audience runtime', () => {
  it('persists a verified-only policy using W03-validated content context and only writes W05-owned state', async () => {
    const d = db([{
      content_id: 'content-1',
      owner_user_id: 'owner-1',
      audience: 'verified',
      mentioned_user_ids_json: '[]',
      updated_at: '2026-10-19T00:00:00.000Z',
    }])
    const context = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post' as const,
      state: 'DRAFT' as const,
      updatedAt: '2026-10-19T00:00:00.000Z',
    }
    await expect(setContentReplyAudience(d, 'owner-1', 'content-1', 'verified', [], context)).resolves.toMatchObject({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      replyAudience: 'verified',
      mentionedUserIds: [],
    })
    const prepare = d.prepare as unknown as ReturnType<typeof vi.fn>
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(String(prepare.mock.calls[0]?.[0])).toContain('INSERT INTO social_content_reply_policies')
    expect(String(prepare.mock.calls[0]?.[0])).not.toContain('FROM contents')
    expect(String(prepare.mock.calls[0]?.[0])).toContain('ON CONFLICT(content_id) DO UPDATE')
  })

  it('rejects a non-owner context without attempting a W05 policy write', async () => {
    const d = db([])
    await expect(setContentReplyAudience(d, 'viewer-1', 'content-1', 'following', [], {
      contentId: 'content-1',
      ownerUserId: 'someone-else',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-19T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(d.prepare).not.toHaveBeenCalled()
  })

  it('rejects invalid content context and invalid audience values', async () => {
    const context = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post' as const,
      state: 'DRAFT' as const,
      updatedAt: '2026-10-19T00:00:00.000Z',
    }
    const d = db([])
    await expect(setContentReplyAudience(d, 'owner-1', 'content-1', 'everyone', [], {
      ...context,
      contentType: 'article',
    } as never)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(setContentReplyAudience(d, 'owner-1', 'content-1', 'anyone', [], context))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(d.prepare).not.toHaveBeenCalled()
  })

  it('stores a bounded, de-duplicated mention allowlist for every reply audience', async () => {
    const d = db([
      {
        content_id: 'content-1',
        owner_user_id: 'owner-1',
        audience: 'following',
        mentioned_user_ids_json: '["user-2"]',
        updated_at: '2026-10-19T00:00:00.000Z',
      },
    ])
    await setContentReplyAudience(d, 'owner-1', 'content-1', 'following', ['user-2', 'user-2'], {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-19T00:00:00.000Z',
    })
    const prepare = d.prepare as unknown as ReturnType<typeof vi.fn>
    expect(prepare.mock.calls[0]?.[0]).toContain('mentioned_user_ids_json')
    expect(prepare.mock.calls[0]?.[0]).toContain('RETURNING')
    expect(d.bindCalls[0]?.[3]).toBe('["user-2"]')
  })

  it('returns the persisted owner policy and defaults existing posts to everyone', async () => {
    const context = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post' as const,
      state: 'PUBLISHED' as const,
      updatedAt: '2026-10-19T00:00:00.000Z',
    }
    await expect(getContentReplyAudience(db([{
      content_id: 'content-1',
      owner_user_id: 'owner-1',
      audience: 'followingNetwork',
      mentioned_user_ids_json: '[]',
      updated_at: '2026-10-19T00:00:00.000Z',
    }]), 'owner-1', 'content-1', context)).resolves.toMatchObject({ replyAudience: 'followingNetwork' })

    const emptyDb = db([])
    await expect(getContentReplyAudience(emptyDb, 'owner-1', 'content-1', context)).resolves.toMatchObject({
      replyAudience: 'everyone',
      updatedAt: '2026-10-19T00:00:00.000Z',
    })
    expect(String((emptyDb.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).not.toContain('FROM contents')
  })

  it('rejects a reply-policy context that does not match the actor and content before querying W05 policy state', async () => {
    const d = db([])
    await expect(getContentReplyAudience(d, 'viewer-1', 'content-1', {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-19T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect((d.prepare as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('uses W05 follow, mention, second-degree, and trusted verified facts in the final SQL predicate', () => {
    expect(replyAudienceAllowedSql).toContain('social_follow_relationships')
    expect(replyAudienceAllowedSql).toContain('json_each')
    expect(replyAudienceAllowedSql).toContain('second_degree')
    expect(replyAudienceAllowedSql).toContain("= 'verified'")
    expect(replyAudienceAllowedSql).toContain('mentioned_override')
    expect(replyAudienceAllowedParams('reply-1', true)).toEqual(['reply-1', 1, 'reply-1', 'reply-1', 'reply-1', 'reply-1', 'reply-1', 'reply-1', 'reply-1'])
  })
})

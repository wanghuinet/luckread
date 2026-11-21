import { describe, expect, it, vi } from 'vitest'
import type { ReplyAudienceStore, StoredReplyAudiencePolicy, WriteReplyAudiencePolicy } from './reply-audience-store.js'
import {
  getContentReplyAudience,
  setContentReplyAudience,
} from './reply-audience-runtime.js'

const ownerContext = (ownerUserId = 'owner-1', state: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' = 'DRAFT') => ({
  contentId: 'content-1',
  ownerUserId,
  contentType: 'post' as const,
  state,
  updatedAt: '2026-10-19T00:00:00.000Z',
})
const storeFor = (initial: StoredReplyAudiencePolicy | null = null): ReplyAudienceStore => {
  let stored = initial
  return {
    set: vi.fn(async (input: WriteReplyAudiencePolicy) => {
      if (stored && stored.ownerUserId !== input.ownerUserId) return null
      stored = {
        contentId: input.contentId,
        ownerUserId: input.ownerUserId,
        audience: input.audience,
        mentionedUserIdsJson: input.mentionedUserIdsJson,
        updatedAt: input.now,
      }
      return stored
    }),
    get: vi.fn(async (contentId: string, ownerUserId: string) =>
      stored?.contentId === contentId && stored.ownerUserId === ownerUserId ? stored : null),
  }
}

describe('W05 reply audience runtime — Neon Store port only', () => {
  it('persists a verified-only policy using W03-validated owner context', async () => {
    const store = storeFor()
    await expect(setContentReplyAudience(store, 'owner-1', 'content-1', 'verified', [], ownerContext()))
      .resolves.toMatchObject({
        contentId: 'content-1', ownerUserId: 'owner-1', replyAudience: 'verified', mentionedUserIds: [],
      })
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 'content-1', ownerUserId: 'owner-1', audience: 'verified', mentionedUserIdsJson: '[]',
    }))
  })

  it('rejects a non-owner context before attempting a policy write', async () => {
    const store = storeFor()
    await expect(setContentReplyAudience(store, 'viewer-1', 'content-1', 'following', [], ownerContext('someone-else', 'PUBLISHED')))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.set).not.toHaveBeenCalled()
  })

  it('rejects invalid content context and invalid audience values before Store access', async () => {
    const store = storeFor()
    await expect(setContentReplyAudience(store, 'owner-1', 'content-1', 'everyone', [], {
      ...ownerContext(), contentType: 'article',
    } as never)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(setContentReplyAudience(store, 'owner-1', 'content-1', 'anyone', [], ownerContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(store.set).not.toHaveBeenCalled()
  })

  it('stores a bounded, de-duplicated mention allowlist for every reply audience', async () => {
    const store = storeFor()
    await expect(setContentReplyAudience(store, 'owner-1', 'content-1', 'following', ['user-2', 'user-2'], ownerContext('owner-1', 'PUBLISHED')))
      .resolves.toMatchObject({ replyAudience: 'following', mentionedUserIds: ['user-2'] })
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({ mentionedUserIdsJson: '["user-2"]' }))
    await expect(setContentReplyAudience(store, 'owner-1', 'content-1', 'mentioned', Array.from({ length: 21 }, (_, i) => 'user-' + i), ownerContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('returns the persisted owner policy and defaults existing posts to everyone', async () => {
    const stored: StoredReplyAudiencePolicy = {
      contentId: 'content-1', ownerUserId: 'owner-1', audience: 'followingNetwork',
      mentionedUserIdsJson: '[]', updatedAt: '2026-10-19T00:00:00.000Z',
    }
    await expect(getContentReplyAudience(storeFor(stored), 'owner-1', 'content-1', ownerContext('owner-1', 'PUBLISHED')))
      .resolves.toMatchObject({ replyAudience: 'followingNetwork' })
    await expect(getContentReplyAudience(storeFor(), 'owner-1', 'content-1', ownerContext('owner-1', 'PUBLISHED')))
      .resolves.toMatchObject({ replyAudience: 'everyone', mentionedUserIds: [], updatedAt: '2026-10-19T00:00:00.000Z' })
  })

  it('rejects a reply-policy context mismatch before reading Store state', async () => {
    const store = storeFor()
    await expect(getContentReplyAudience(store, 'viewer-1', 'content-1', ownerContext('owner-1', 'PUBLISHED')))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.get).not.toHaveBeenCalled()
  })


  it('keeps owner conflicts and provider failures distinct at the runtime boundary', async () => {
    const conflictStore: ReplyAudienceStore = { set: vi.fn(async () => null), get: vi.fn(async () => null) }
    await expect(setContentReplyAudience(conflictStore, 'owner-1', 'content-1', 'everyone', [], ownerContext()))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    const unavailableStore: ReplyAudienceStore = {
      set: vi.fn(async () => { throw new Error('private database connection detail') }),
      get: vi.fn(async () => { throw new Error('private database connection detail') }),
    }
    await expect(setContentReplyAudience(unavailableStore, 'owner-1', 'content-1', 'everyone', [], ownerContext()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 })
    await expect(getContentReplyAudience(unavailableStore, 'owner-1', 'content-1', ownerContext()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 })
  })

  it('rejects malformed persisted mention JSON without exposing storage details', async () => {
    const store: ReplyAudienceStore = {
      set: vi.fn(async () => null),
      get: vi.fn(async () => ({
        contentId: 'content-1', ownerUserId: 'owner-1', audience: 'mentioned',
        mentionedUserIdsJson: '{bad json', updatedAt: '2026-10-19T00:00:00.000Z',
      })),
    }
    await expect(getContentReplyAudience(store, 'owner-1', 'content-1', ownerContext('owner-1', 'PUBLISHED')))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 })
  })
})

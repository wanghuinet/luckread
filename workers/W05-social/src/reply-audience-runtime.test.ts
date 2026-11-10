import { describe, expect, it, vi } from 'vitest'
import type { OwnedPostContext } from './owned-post-context.js'
import {
  getContentReplyAudience,
  ReplyAudienceRuntimeError,
  setContentReplyAudience,
} from './reply-audience-runtime.js'
import type { ReplyAudienceStore } from './reply-audience-store.js'

const context = (ownerUserId: string): OwnedPostContext => ({
  contentId: 'content-1',
  ownerUserId,
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt: '2026-11-10T00:00:00.000Z',
})

describe('W05 reply-audience runtime store injection', () => {
  it('uses an injected PostgreSQL-compatible store for owner-scoped writes and reads', async () => {
    let stored = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      audience: 'mentioned' as const,
      mentionedUserIdsJson: '["user-2"]',
      updatedAt: '2026-11-10T00:00:00.000Z',
    }
    const store: ReplyAudienceStore = {
      async set(input) {
        stored = { ...stored, ...input, updatedAt: input.now }
        return stored
      },
      async get(contentId, ownerUserId) {
        return contentId === stored.contentId && ownerUserId === stored.ownerUserId ? stored : null
      },
    }
    const d1 = { prepare: () => { throw new Error('D1 must not be accessed by injected store') } } as unknown as D1Database

    await expect(setContentReplyAudience(
      d1, 'owner-1', 'content-1', 'mentioned', ['user-2', 'user-2'], context('owner-1'), store,
    )).resolves.toMatchObject({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      replyAudience: 'mentioned',
      mentionedUserIds: ['user-2'],
    })

    await expect(getContentReplyAudience(
      d1, 'owner-1', 'content-1', context('owner-1'), store,
    )).resolves.toMatchObject({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      replyAudience: 'mentioned',
      mentionedUserIds: ['user-2'],
    })
  })

  it('keeps the W03 owner check ahead of persistence', async () => {
    const store: ReplyAudienceStore = {
      set: vi.fn(async () => null),
      get: vi.fn(async () => null),
    }
    const d1 = { prepare: () => { throw new Error('unexpected D1 access') } } as unknown as D1Database
    await expect(setContentReplyAudience(
      d1, 'actor-1', 'content-1', 'everyone', [], context('owner-1'), store,
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(store.set).not.toHaveBeenCalled()
  })

  it('keeps owner conflicts distinct from store failures', async () => {
    const store: ReplyAudienceStore = {
      set: async () => null,
      get: async () => null,
    }
    const d1 = { prepare: () => { throw new Error('unexpected D1 access') } } as unknown as D1Database
    await expect(setContentReplyAudience(
      d1, 'other-owner', 'content-1', 'everyone', [], context('other-owner'), store,
    )).rejects.toBeInstanceOf(ReplyAudienceRuntimeError)
    await expect(setContentReplyAudience(
      d1, 'other-owner', 'content-1', 'everyone', [], context('other-owner'), store,
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })
})

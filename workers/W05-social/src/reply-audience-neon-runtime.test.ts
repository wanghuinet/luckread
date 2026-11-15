/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createW05SocialWorker } from './index.js'
import type {
  ReplyAudienceStore,
  StoredReplyAudiencePolicy,
  WriteReplyAudiencePolicy,
} from './reply-audience-store.js'

const headers = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'reply-audience-neon-test',
  'X-LuckRead-Principal-User-Id': 'owner-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

describe('W05 reply-audience Neon HTTP runtime', () => {
  it('routes GET and PUT through the injected store after W03 owner validation without touching D1', async () => {
    let saved: StoredReplyAudiencePolicy = {
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      audience: 'everyone',
      mentionedUserIdsJson: '[]',
      updatedAt: '2026-11-15T00:00:00.000Z',
    }
    const store: ReplyAudienceStore = {
      get: vi.fn(async (contentId: string, ownerUserId: string) =>
        contentId === saved.contentId && ownerUserId === saved.ownerUserId ? saved : null),
      set: vi.fn(async (input: WriteReplyAudiencePolicy) => {
        saved = {
          contentId: input.contentId,
          ownerUserId: input.ownerUserId,
          audience: input.audience,
          mentionedUserIdsJson: input.mentionedUserIdsJson,
          updatedAt: input.now,
        }
        return saved
      }),
    }
    const d1Prepare = vi.fn(() => { throw new Error('D1 must not be accessed by Neon reply-audience routes') })
    const w03Fetch = vi.fn(async () => Response.json({
      data: {
        contentId: 'content-1',
        ownerUserId: 'owner-1',
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: '2026-11-14T00:00:00.000Z',
      },
    }))
    const worker = createW05SocialWorker({ replyAudienceStore: store })
    const env = { DB: { prepare: d1Prepare }, W03_CONTENT: { fetch: w03Fetch } } as never
    const ctx = {} as never

    const get = await worker.fetch(new Request(
      'https://luckread-w05.internal/internal/social/contents/content-1/reply-audience',
      { headers },
    ), env, ctx)
    expect(get.status).toBe(200)
    await expect(get.json()).resolves.toMatchObject({
      data: { contentId: 'content-1', ownerUserId: 'owner-1', replyAudience: 'everyone' },
    })

    const put = await worker.fetch(new Request(
      'https://luckread-w05.internal/internal/social/contents/content-1/reply-audience',
      {
        method: 'PUT',
        headers: { ...headers, 'Idempotency-Key': 'reply-policy-1', 'content-type': 'application/json' },
        body: JSON.stringify({ replyAudience: 'mentioned', mentionedUserIds: ['user-2', 'user-2'] }),
      },
    ), env, ctx)
    expect(put.status).toBe(200)
    await expect(put.json()).resolves.toMatchObject({
      data: { contentId: 'content-1', ownerUserId: 'owner-1', replyAudience: 'mentioned', mentionedUserIds: ['user-2'] },
    })

    expect(w03Fetch).toHaveBeenCalledTimes(2)
    expect(store.get).toHaveBeenCalledWith('content-1', 'owner-1')
    expect(store.set).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      audience: 'mentioned',
      mentionedUserIdsJson: '["user-2"]',
    }))
    expect(d1Prepare).not.toHaveBeenCalled()
  })
})

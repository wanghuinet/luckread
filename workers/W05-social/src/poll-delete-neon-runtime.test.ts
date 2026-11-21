import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { PollDeleteStore } from './poll-delete-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const ownerUserId = 'poll-owner-1'
const contentId = 'poll-content-delete-1'
const pollId = 'poll-pg-delete-1'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-poll-delete-test',
  'X-LuckRead-Principal-User-Id': ownerUserId,
  'X-LuckRead-Principal-Layer': 'L2',
}

function createHarness(voteCount = 0) {
  const deleteStore: PollDeleteStore = {
    getPoll: vi.fn(async () => ({
      poll_id: pollId,
      content_id: contentId,
      owner_user_id: ownerUserId,
    })),
    countVotes: vi.fn(async () => voteCount),
    deleteDraftPoll: vi.fn(async () => true),
  }

  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Poll Delete path')
  })
  const batch = vi.fn(async () => {
    throw new Error('D1 batch must not be accessed by the injected Neon Poll Delete path')
  })

  const forwardedRequests: Request[] = []
  const w03Content: W03ContentBinding = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      forwardedRequests.push(request)
      return Response.json({
        data: {
          contentId,
          ownerUserId,
          contentType: 'post',
          state: 'DRAFT',
          updatedAt: '2026-11-15T00:00:00.000Z',
        },
        requestId: 'req-w03-poll-delete',
      })
    }),
  }

  const worker = createW05SocialWorker({ pollDeleteStore: deleteStore })

  return {
    worker,
    env: { DB: { prepare, batch }, W03_CONTENT: w03Content },
    prepare,
    batch,
    deleteStore,
    w03Content,
    forwardedRequests,
  }
}

describe('W05 Neon Poll Delete route composition', () => {
  it('deletes an unvoted draft poll through PostgreSQL after W03 owner validation without D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request(`https://luckread-w05.internal/internal/social/contents/${contentId}/poll`, {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'poll-delete-key-1',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    const forwarded = h.forwardedRequests[0] as Request
    expect(forwarded.url).toContain(`/internal/content/contents/${contentId}/owned-post-context`)
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe(ownerUserId)

    expect(h.deleteStore.getPoll).toHaveBeenCalledWith(contentId)
    expect(h.deleteStore.countVotes).toHaveBeenCalledWith(pollId)
    expect(h.deleteStore.deleteDraftPoll).toHaveBeenCalledWith({
      pollId,
      actorUserId: ownerUserId,
      contentId,
    })
    expect(h.prepare).not.toHaveBeenCalled()
    expect(h.batch).not.toHaveBeenCalled()
  })

  it('preserves a draft poll when the PostgreSQL store reports existing votes', async () => {
    const h = createHarness(1)
    const response = await h.worker.fetch(
      new Request(`https://luckread-w05.internal/internal/social/contents/${contentId}/poll`, {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'poll-delete-key-with-votes',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(409)
    expect(h.deleteStore.getPoll).toHaveBeenCalledWith(contentId)
    expect(h.deleteStore.countVotes).toHaveBeenCalledWith(pollId)
    expect(h.deleteStore.deleteDraftPoll).not.toHaveBeenCalled()
    expect(h.prepare).not.toHaveBeenCalled()
    expect(h.batch).not.toHaveBeenCalled()
  })
})

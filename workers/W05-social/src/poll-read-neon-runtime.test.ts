import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { PollReadRow, PollReadStore } from './poll-read-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const contentId = 'poll-content-read-1'
const ownerUserId = 'poll-owner-1'
const viewerUserId = 'poll-viewer-1'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-poll-read-test',
  'X-LuckRead-Principal-User-Id': viewerUserId,
}

const pollRow: PollReadRow = {
  poll_id: 'poll-pg-read-1',
  content_id: contentId,
  owner_user_id: ownerUserId,
  duration_minutes: 1440,
  ends_at: '2099-12-31T23:59:59.000Z',
  created_at: '2026-11-15T00:00:00.000Z',
  updated_at: '2026-11-15T00:00:00.000Z',
}

function createHarness() {
  const readStore: PollReadStore = {
    isBlocked: vi.fn(async () => false),
    getPoll: vi.fn(async () => pollRow),
    setEndsAtIfUnset: vi.fn(async () => undefined),
    listOptionsWithVoteCounts: vi.fn(async () => [
      { option_id: 'poll-option-1', option_text: 'Yes', position: 0, votes: 2 },
      { option_id: 'poll-option-2', option_text: 'No', position: 1, votes: 1 },
    ]),
    getViewerOptionId: vi.fn(async () => 'poll-option-2'),
  }

  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Poll Read path')
  })
  const batch = vi.fn(async () => {
    throw new Error('D1 batch must not be accessed by the injected Neon Poll Read path')
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
          state: 'PUBLISHED',
          updatedAt: '2026-11-15T00:00:00.000Z',
        },
        requestId: 'req-w03-poll-read',
      })
    }),
  }

  const worker = createW05SocialWorker({ pollReadStore: readStore })

  return {
    worker,
    env: { DB: { prepare, batch }, W03_CONTENT: w03Content },
    prepare,
    batch,
    readStore,
    w03Content,
    forwardedRequests,
  }
}

describe('W05 Neon Poll Read route composition', () => {
  it('reads the public poll and viewer vote through PostgreSQL after W03 context validation without D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request(`https://luckread-w05.internal/internal/social/contents/${contentId}/poll`, {
        method: 'GET',
        headers: transportHeaders,
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        poll: {
          pollId: 'poll-pg-read-1',
          contentId,
          durationMinutes: 1440,
          viewerOptionId: 'poll-option-2',
          totalVotes: 3,
          closed: false,
          options: [
            { optionId: 'poll-option-1', text: 'Yes', position: 0, votes: 2 },
            { optionId: 'poll-option-2', text: 'No', position: 1, votes: 1 },
          ],
        },
      },
    })

    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    expect(h.forwardedRequests[0]?.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(h.readStore.isBlocked).toHaveBeenCalledWith(viewerUserId, ownerUserId)
    expect(h.readStore.getPoll).toHaveBeenCalledWith(contentId)
    expect(h.readStore.listOptionsWithVoteCounts).toHaveBeenCalledWith(pollRow.poll_id)
    expect(h.readStore.getViewerOptionId).toHaveBeenCalledWith(pollRow.poll_id, viewerUserId)
    expect(h.prepare).not.toHaveBeenCalled()
    expect(h.batch).not.toHaveBeenCalled()
  })
})

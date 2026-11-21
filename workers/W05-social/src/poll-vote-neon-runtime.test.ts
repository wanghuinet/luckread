import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { PollReadRow, PollReadStore } from './poll-read-store.js'
import type { PollVoteStore } from './poll-vote-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-poll-vote-test',
  'X-LuckRead-Principal-User-Id': 'poll-voter-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

const pollRow: PollReadRow = {
  poll_id: 'poll-pg-1',
  content_id: 'poll-content-1',
  owner_user_id: 'poll-owner-1',
  duration_minutes: 1440,
  ends_at: '2099-12-31T23:59:59.000Z',
  created_at: '2026-11-14T00:00:00.000Z',
  updated_at: '2026-11-14T00:00:00.000Z',
}

function createHarness() {
  let savedOptionId: string | null = null
  const readStore: PollReadStore = {
    isBlocked: vi.fn(async () => false),
    getPoll: vi.fn(async () => pollRow),
    setEndsAtIfUnset: vi.fn(async () => undefined),
    listOptionsWithVoteCounts: vi.fn(async () => [
      { option_id: 'poll-option-1', option_text: 'Yes', position: 0, votes: savedOptionId === 'poll-option-1' ? 1 : 0 },
      { option_id: 'poll-option-2', option_text: 'No', position: 1, votes: savedOptionId === 'poll-option-2' ? 1 : 0 },
    ]),
    getViewerOptionId: vi.fn(async () => savedOptionId),
  }
  const voteStore: PollVoteStore = {
    getVote: vi.fn(async () => savedOptionId
      ? { option_id: savedOptionId, created_at: '2026-11-14T00:01:00.000Z' }
      : null),
    insertVote: vi.fn(async (input) => { savedOptionId = input.optionId }),
  }
  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Poll Vote path')
  })
  const w03Content: W03ContentBinding = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return Response.json({
        data: {
          contentId: 'poll-content-1',
          ownerUserId: 'poll-owner-1',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-11-14T00:00:00.000Z',
        },
        requestId: 'req-w03-poll-vote',
      })
    }),
  }
  const worker = createW05SocialWorker({
    pollReadStore: readStore,
    pollVoteStore: voteStore,
  })
  return {
    worker,
    env: { DB: { prepare }, W03_CONTENT: w03Content },
    prepare,
    readStore,
    voteStore,
    w03Content,
  }
}

describe('W05 Neon Poll Vote route composition', () => {
  it('writes a vote through PostgreSQL after W03 publication and bidirectional Block checks without D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/contents/poll-content-1/poll/votes', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'poll-vote-key-1',
        },
        body: JSON.stringify({ optionId: 'poll-option-1' }),
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        poll: {
          pollId: 'poll-pg-1',
          contentId: 'poll-content-1',
          viewerOptionId: 'poll-option-1',
          totalVotes: 1,
          closed: false,
          options: [
            { optionId: 'poll-option-1', votes: 1 },
            { optionId: 'poll-option-2', votes: 0 },
          ],
        },
      },
    })
    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    const forwarded = (h.w03Content.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain('/public-post-context/poll-owner-1')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(h.readStore.getPoll).toHaveBeenCalled()
    expect(h.readStore.isBlocked).toHaveBeenCalledWith('poll-voter-1', 'poll-owner-1')
    expect(h.voteStore.getVote).toHaveBeenCalledTimes(2)
    expect(h.voteStore.insertVote).toHaveBeenCalledWith(expect.objectContaining({
      pollId: 'poll-pg-1',
      contentId: 'poll-content-1',
      ownerUserId: 'poll-owner-1',
      optionId: 'poll-option-1',
      userId: 'poll-voter-1',
    }))
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

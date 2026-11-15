import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { PollConfigurationStore } from './poll-configuration-store.js'
import type { PollReadRow, PollReadStore } from './poll-read-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const ownerUserId = 'poll-owner-1'
const contentId = 'poll-content-1'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-poll-configuration-test',
  'X-LuckRead-Principal-User-Id': ownerUserId,
  'X-LuckRead-Principal-Layer': 'L2',
}

const pollRow: PollReadRow = {
  poll_id: 'poll-pg-configuration-1',
  content_id: contentId,
  owner_user_id: ownerUserId,
  duration_minutes: 1440,
  ends_at: null,
  created_at: '2026-11-15T00:00:00.000Z',
  updated_at: '2026-11-15T00:00:00.000Z',
}

function createHarness() {
  const configurationStore: PollConfigurationStore = {
    getPoll: vi.fn(async () => null),
    listOptionTexts: vi.fn(async () => []),
    countVotes: vi.fn(async () => 0),
    createDraftPoll: vi.fn(async (_input) => undefined),
    updateDraftPoll: vi.fn(async (_input) => undefined),
  }

  const readStore: PollReadStore = {
    isBlocked: vi.fn(async () => false),
    getPoll: vi.fn(async () => pollRow),
    setEndsAtIfUnset: vi.fn(async () => undefined),
    listOptionsWithVoteCounts: vi.fn(async () => [
      { option_id: 'poll-option-yes', option_text: 'Yes', position: 0, votes: 0 },
      { option_id: 'poll-option-no', option_text: 'No', position: 1, votes: 0 },
    ]),
    getViewerOptionId: vi.fn(async () => null),
  }

  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Poll Configuration path')
  })

  const w03Content: W03ContentBinding = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return Response.json({
        data: {
          contentId,
          ownerUserId,
          contentType: 'post',
          state: 'DRAFT',
          updatedAt: '2026-11-15T00:00:00.000Z',
        },
        requestId: 'req-w03-poll-configuration',
      })
    }),
  }

  const worker = createW05SocialWorker({
    pollConfigurationStore: configurationStore,
    pollReadStore: readStore,
  })

  return {
    worker,
    env: { DB: { prepare }, W03_CONTENT: w03Content },
    prepare,
    configurationStore,
    readStore,
    w03Content,
  }
}

describe('W05 Neon Poll Configuration route composition', () => {
  it('creates a draft poll through PostgreSQL stores after W03 owner validation without D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request(`https://luckread-w05.internal/internal/social/contents/${contentId}/poll`, {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'poll-configuration-key-1',
        },
        body: JSON.stringify({ options: ['Yes', 'No'], durationMinutes: 1440 }),
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        poll: {
          pollId: pollRow.poll_id,
          contentId,
          durationMinutes: 1440,
          durationHours: 24,
          totalVotes: 0,
          viewerOptionId: null,
          closed: false,
          options: [
            { optionId: 'poll-option-yes', text: 'Yes', position: 0, votes: 0 },
            { optionId: 'poll-option-no', text: 'No', position: 1, votes: 0 },
          ],
        },
      },
    })

    expect(h.w03Content.fetch).toHaveBeenCalledTimes(1)
    const forwarded = (h.w03Content.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Request
    expect(forwarded.url).toContain(`/internal/content/contents/${contentId}/owned-post-context`)
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe(ownerUserId)

    expect(h.configurationStore.getPoll).toHaveBeenCalledWith(contentId)
    expect(h.configurationStore.createDraftPoll).toHaveBeenCalledWith(expect.objectContaining({
      contentId,
      ownerUserId,
      durationHours: 24,
      durationMinutes: 1440,
      options: [
        expect.objectContaining({ text: 'Yes', position: 0 }),
        expect.objectContaining({ text: 'No', position: 1 }),
      ],
    }))
    expect(h.readStore.getPoll).toHaveBeenCalledWith(contentId)
    expect(h.readStore.listOptionsWithVoteCounts).toHaveBeenCalledWith(pollRow.poll_id)
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

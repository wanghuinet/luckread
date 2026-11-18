import { describe, expect, it, vi } from 'vitest'
import { castContentPollVote, configureContentPoll, deleteContentPoll, getContentPoll } from './poll-runtime.js'
import type { PollReadRow, PollOptionCountRow, PollReadStore } from './poll-read-store.js'
import type { PollConfigurationStore } from './poll-configuration-store.js'
import type { PollDeleteStore } from './poll-delete-store.js'
import type { PollVoteStore } from './poll-vote-store.js'
import type { OwnedPostContext } from './owned-post-context.js'
import type { PublishedContentSocialContext, W03ContentBinding } from './w03-content-context-client.js'

const pollRow: PollReadRow = {
  poll_id: 'poll-1',
  content_id: 'content-1',
  owner_user_id: 'author-1',
  duration_minutes: 1440,
  ends_at: '2099-10-18T04:00:00.000Z',
  created_at: '2026-10-17T04:00:00.000Z',
  updated_at: '2026-10-17T04:00:00.000Z',
}

const optionRows: PollOptionCountRow[] = [
  { option_id: 'option-1', option_text: 'Yes', position: 0, votes: 2 },
  { option_id: 'option-2', option_text: 'No', position: 1, votes: 1 },
]

const publishedPollContext = (
  ownerUserId: string | null = 'author-1',
  updatedAt = '2026-10-17T04:00:00.000Z',
): PublishedContentSocialContext => ({
  contentId: 'content-1',
  ownerUserId,
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt,
})

const draftOwnerContext = (): OwnedPostContext => ({
  contentId: 'content-1',
  ownerUserId: 'author-1',
  contentType: 'post',
  state: 'DRAFT',
  updatedAt: '2026-10-17T04:00:00.000Z',
})

const makeReadStore = (overrides: Partial<PollReadStore> = {}): PollReadStore => ({
  isBlocked: vi.fn(async () => false),
  getPoll: vi.fn(async () => pollRow),
  setEndsAtIfUnset: vi.fn(async () => undefined),
  listOptionsWithVoteCounts: vi.fn(async () => optionRows),
  getViewerOptionId: vi.fn(async () => null),
  ...overrides,
})

const makeConfigurationStore = (overrides: Partial<PollConfigurationStore> = {}): PollConfigurationStore => ({
  getPoll: vi.fn(async () => null),
  listOptionTexts: vi.fn(async () => ['Yes', 'No']),
  countVotes: vi.fn(async () => 0),
  createDraftPoll: vi.fn(async () => undefined),
  updateDraftPoll: vi.fn(async () => undefined),
  ...overrides,
})

const makeDeleteStore = (overrides: Partial<PollDeleteStore> = {}): PollDeleteStore => ({
  getPoll: vi.fn(async () => ({
    poll_id: 'poll-1',
    content_id: 'content-1',
    owner_user_id: 'author-1',
  })),
  countVotes: vi.fn(async () => 0),
  deleteDraftPoll: vi.fn(async () => true),
  ...overrides,
})

const makeVoteStore = (overrides: Partial<PollVoteStore> = {}): PollVoteStore => ({
  getVote: vi.fn(async () => null),
  insertVote: vi.fn(async () => undefined),
  ...overrides,
})

const publishedOwnerContextBinding = (status = 200) => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const parts = new URL(request.url).pathname.split('/').filter(Boolean)
    const contentId = decodeURIComponent(parts.at(-3) ?? '')
    const ownerUserId = decodeURIComponent(parts.at(-1) ?? '')
    return Response.json(status === 200 ? {
      data: {
        contentId,
        ownerUserId,
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: '2026-10-15T04:00:00.000Z',
      },
    } : { error: { code: 'NOT_FOUND' } }, { status })
  }),
}) as W03ContentBinding & { fetch: ReturnType<typeof vi.fn> }

describe('W05 poll runtime', () => {
  it('rejects duplicated, undersized and invalid-duration configurations before Store access', async () => {
    const configurationStore = makeConfigurationStore()
    const readStore = makeReadStore()
    await expect(configureContentPoll('author-1', 'content-1', ['同一', ' 同一 '], 24, draftOwnerContext(), configurationStore, readStore))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(configureContentPoll('author-1', 'content-1', ['只有一项'], 24, draftOwnerContext(), configurationStore, readStore))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    for (const duration of [4, 10081, 5.5, Number.NaN, '5']) {
      await expect(configureContentPoll('author-1', 'content-1', ['Yes', 'No'], duration, draftOwnerContext(), configurationStore, readStore))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    }
    expect(configurationStore.getPoll).not.toHaveBeenCalled()
    expect(readStore.getPoll).not.toHaveBeenCalled()
  })

  it('returns public results, viewer choice, and publication-relative expiry through the injected read Store', async () => {
    const readStore = makeReadStore({
      getPoll: vi.fn(async () => ({ ...pollRow, duration_minutes: 5, ends_at: null })),
      getViewerOptionId: vi.fn(async () => 'option-2'),
    })
    const page = await getContentPoll(
      'content-1',
      'viewer-1',
      publishedPollContext('author-1', '2026-10-17T04:00:00.000Z'),
      readStore,
    )
    expect(page).toMatchObject({
      pollId: 'poll-1',
      contentId: 'content-1',
      durationMinutes: 5,
      durationHours: 5 / 60,
      endsAt: '2026-10-17T04:05:00.000Z',
      totalVotes: 3,
      viewerOptionId: 'option-2',
      options: [
        { optionId: 'option-1', text: 'Yes', votes: 2 },
        { optionId: 'option-2', text: 'No', votes: 1 },
      ],
    })
    expect(readStore.isBlocked).toHaveBeenCalledWith('viewer-1', 'author-1')
    expect(readStore.setEndsAtIfUnset).toHaveBeenCalledWith('poll-1', '2026-10-17T04:05:00.000Z')
    expect(readStore.getViewerOptionId).toHaveBeenCalledWith('poll-1', 'viewer-1')
  })

  it('hides a poll from blocked viewers and allows an owner to preview a draft', async () => {
    const blockedStore = makeReadStore({ isBlocked: vi.fn(async () => true) })
    await expect(getContentPoll('content-1', 'viewer-1', publishedPollContext(), blockedStore))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(blockedStore.getPoll).not.toHaveBeenCalled()

    const draftStore = makeReadStore()
    const draft = await getContentPoll('content-1', 'author-1', draftOwnerContext(), draftStore)
    expect(draft).toMatchObject({ pollId: 'poll-1', endsAt: null, viewerOptionId: null })
    expect(draftStore.getViewerOptionId).not.toHaveBeenCalled()
  })

  it('creates a draft poll from W03 owner context and verifies the persisted read model', async () => {
    const configurationStore = makeConfigurationStore()
    const readStore = makeReadStore({
      getPoll: vi.fn(async () => ({ ...pollRow, duration_minutes: 5, ends_at: null })),
      listOptionsWithVoteCounts: vi.fn(async () => [
        { option_id: 'new-1', option_text: 'Yes', position: 0, votes: 0 },
        { option_id: 'new-2', option_text: 'No', position: 1, votes: 0 },
      ]),
    })
    const result = await configureContentPoll(
      'author-1',
      'content-1',
      ['Yes', 'No'],
      5,
      draftOwnerContext(),
      configurationStore,
      readStore,
    )
    expect(result).toMatchObject({ contentId: 'content-1', durationMinutes: 5, durationHours: 5 / 60 })
    expect(configurationStore.createDraftPoll).toHaveBeenCalledWith(expect.objectContaining({
      contentId: 'content-1',
      ownerUserId: 'author-1',
      durationMinutes: 5,
      options: [
        { text: 'Yes', position: 0, optionId: expect.any(String) },
        { text: 'No', position: 1, optionId: expect.any(String) },
      ],
    }))
    expect(readStore.getPoll).toHaveBeenCalledWith('content-1')
  })

  it('does not change a poll after votes exist and configuration differs', async () => {
    const configurationStore = makeConfigurationStore({
      getPoll: vi.fn(async () => pollRow),
      listOptionTexts: vi.fn(async () => ['Yes', 'No']),
      countVotes: vi.fn(async () => 1),
    })
    const readStore = makeReadStore()
    await expect(configureContentPoll(
      'author-1',
      'content-1',
      ['Yes', 'Maybe'],
      1440,
      draftOwnerContext(),
      configurationStore,
      readStore,
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(configurationStore.updateDraftPoll).not.toHaveBeenCalled()
  })

  it('deletes only unvoted owner draft polls and treats a concurrent delete as idempotent', async () => {
    const deleteStore = makeDeleteStore()
    await expect(deleteContentPoll('author-1', 'content-1', draftOwnerContext(), deleteStore)).resolves.toBeUndefined()
    expect(deleteStore.deleteDraftPoll).toHaveBeenCalledWith({
      pollId: 'poll-1',
      actorUserId: 'author-1',
      contentId: 'content-1',
    })

    const votedStore = makeDeleteStore({ countVotes: vi.fn(async () => 1) })
    await expect(deleteContentPoll('author-1', 'content-1', draftOwnerContext(), votedStore))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(votedStore.deleteDraftPoll).not.toHaveBeenCalled()

    const concurrentStore = makeDeleteStore({
      getPoll: vi.fn().mockResolvedValueOnce({
        poll_id: 'poll-1',
        content_id: 'content-1',
        owner_user_id: 'author-1',
      }).mockResolvedValueOnce(null),
      deleteDraftPoll: vi.fn(async () => false),
    })
    await expect(deleteContentPoll('author-1', 'content-1', draftOwnerContext(), concurrentStore)).resolves.toBeUndefined()
    expect(concurrentStore.getPoll).toHaveBeenCalledTimes(2)
  })

  it('validates W03 publication and Block policy before inserting a vote, then re-reads the winning choice', async () => {
    let chosenOption: string | null = null
    const readStore = makeReadStore({
      getViewerOptionId: vi.fn(async () => chosenOption),
      listOptionsWithVoteCounts: vi.fn(async () => optionRows.map(row => ({
        ...row,
        votes: row.votes + (row.option_id === chosenOption ? 1 : 0),
      }))),
    })
    const voteStore = makeVoteStore({
      getVote: vi.fn(async () => chosenOption ? { option_id: chosenOption, created_at: '2026-10-17T05:00:00.000Z' } : null),
      insertVote: vi.fn(async input => { chosenOption = input.optionId }),
    })
    const binding = publishedOwnerContextBinding()
    const result = await castContentPollVote(
      binding,
      'viewer-1',
      'content-1',
      'option-1',
      'poll-vote-store-test',
      voteStore,
      readStore,
    )
    expect(result).toMatchObject({ pollId: 'poll-1', viewerOptionId: 'option-1' })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const sent = binding.fetch.mock.calls[0]?.[0] as Request
    expect(sent.url).toContain('/internal/content/contents/content-1/public-post-context/author-1')
    expect(sent.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(sent.headers.has('Authorization')).toBe(false)
    expect(sent.headers.has('Cookie')).toBe(false)
    expect(readStore.isBlocked).toHaveBeenCalledWith('viewer-1', 'author-1')
    expect(voteStore.insertVote).toHaveBeenCalledWith(expect.objectContaining({
      pollId: 'poll-1',
      contentId: 'content-1',
      ownerUserId: 'author-1',
      optionId: 'option-1',
      userId: 'viewer-1',
    }))
    expect(voteStore.getVote).toHaveBeenCalledTimes(2)
  })

  it('rejects a vote on a closed poll and rejects changing an existing vote', async () => {
    const closedStore = makeReadStore({ getPoll: vi.fn(async () => ({ ...pollRow, ends_at: '2020-01-01T00:00:00.000Z' })) })
    await expect(castContentPollVote(
      publishedOwnerContextBinding(), 'viewer-1', 'content-1', 'option-1', 'poll-closed', makeVoteStore(), closedStore,
    )).rejects.toMatchObject({ code: 'POLL_CLOSED', status: 409 })

    const priorVoteStore = makeVoteStore({
      getVote: vi.fn(async () => ({ option_id: 'option-1', created_at: '2026-10-17T05:00:00.000Z' })),
    })
    const openStore = makeReadStore()
    await expect(castContentPollVote(
      publishedOwnerContextBinding(), 'viewer-1', 'content-1', 'option-2', 'poll-already-voted', priorVoteStore, openStore,
    )).rejects.toMatchObject({ code: 'ALREADY_VOTED', status: 409 })
    expect(priorVoteStore.insertVote).not.toHaveBeenCalled()
  })

  it('fails closed when W03 cannot validate the poll owner', async () => {
    const readStore = makeReadStore()
    const voteStore = makeVoteStore()
    await expect(castContentPollVote(
      publishedOwnerContextBinding(404),
      'viewer-1',
      'content-1',
      'option-1',
      'poll-unpublished',
      voteStore,
      readStore,
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(voteStore.insertVote).not.toHaveBeenCalled()
  })
})

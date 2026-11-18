import { describe, expect, it, vi } from 'vitest'
import { castContentPollVote, configureContentPoll, deleteContentPoll, getContentPoll } from './poll-runtime.js'
import type { PollReadStore, PollReadRow, PollOptionCountRow } from './poll-read-store.js'
import type { PollConfigurationStore, CreateDraftPollInput, UpdateDraftPollInput } from './poll-configuration-store.js'
import type { PollDeleteStore } from './poll-delete-store.js'
import type { PollVoteStore, InsertPollVoteInput } from './poll-vote-store.js'
import type { PublishedContentSocialContext, W03ContentBinding } from './w03-content-context-client.js'

const publishedContext = (ownerUserId: string | null = 'author-1', updatedAt = '2026-10-17T04:00:00.000Z'): PublishedContentSocialContext => ({
  contentId: 'content-1', ownerUserId, contentType: 'post', state: 'PUBLISHED', updatedAt,
})
const draftContext = () => ({
  contentId: 'content-1', ownerUserId: 'author-1', contentType: 'post' as const,
  state: 'DRAFT' as const, updatedAt: '2026-10-17T04:00:00.000Z',
})
const basePoll: PollReadRow = {
  poll_id: 'poll-1', content_id: 'content-1', owner_user_id: 'author-1',
  duration_minutes: 1440, ends_at: '2099-10-18T04:00:00.000Z',
  created_at: '2026-10-17T04:00:00.000Z', updated_at: '2026-10-17T04:00:00.000Z',
}
const initialOptions: PollOptionCountRow[] = [
  { option_id: 'option-1', option_text: 'Yes', position: 0, votes: 0 },
  { option_id: 'option-2', option_text: 'No', position: 1, votes: 0 },
]

function pollStores(options: PollOptionCountRow[] = initialOptions, poll: PollReadRow | null = basePoll) {
  let currentPoll = poll ? { ...poll } : null
  let currentOptions = options.map(option => ({ ...option }))
  const votes = new Map<string, { option_id: string; created_at: string }>()
  let blocked = false
  const readStore: PollReadStore = {
    isBlocked: vi.fn(async () => blocked),
    getPoll: vi.fn(async () => currentPoll ? { ...currentPoll } : null),
    setEndsAtIfUnset: vi.fn(async (pollId, endsAt) => {
      if (currentPoll?.poll_id === pollId && currentPoll.ends_at === null) currentPoll.ends_at = endsAt
    }),
    listOptionsWithVoteCounts: vi.fn(async () => currentOptions.map(option => ({
      ...option, votes: [...votes.values()].filter(vote => vote.option_id === option.option_id).length,
    }))),
    getViewerOptionId: vi.fn(async (_pollId, userId) => votes.get(userId)?.option_id ?? null),
  }
  const configurationStore: PollConfigurationStore = {
    getPoll: vi.fn(async () => currentPoll ? { ...currentPoll } : null),
    listOptionTexts: vi.fn(async () => currentOptions.map(option => option.option_text)),
    countVotes: vi.fn(async () => votes.size),
    createDraftPoll: vi.fn(async (input: CreateDraftPollInput) => {
      currentPoll = { poll_id: input.pollId, content_id: input.contentId, owner_user_id: input.ownerUserId,
        duration_minutes: input.durationMinutes, ends_at: null, created_at: input.createdAt, updated_at: input.createdAt }
      currentOptions = input.options.map(option => ({ option_id: option.optionId, option_text: option.text, position: option.position, votes: 0 }))
    }),
    updateDraftPoll: vi.fn(async (input: UpdateDraftPollInput) => {
      if (!currentPoll || votes.size) return
      currentPoll = { ...currentPoll, duration_minutes: input.durationMinutes, ends_at: null, updated_at: input.updatedAt }
      currentOptions = input.options.map(option => ({ option_id: option.optionId, option_text: option.text, position: option.position, votes: 0 }))
    }),
  }
  const deleteStore: PollDeleteStore = {
    getPoll: vi.fn(async () => currentPoll ? { poll_id: currentPoll.poll_id, content_id: currentPoll.content_id, owner_user_id: currentPoll.owner_user_id } : null),
    countVotes: vi.fn(async () => votes.size),
    deleteDraftPoll: vi.fn(async input => {
      if (!currentPoll || currentPoll.poll_id !== input.pollId || currentPoll.owner_user_id !== input.actorUserId || currentPoll.content_id !== input.contentId || votes.size) return false
      currentPoll = null; currentOptions = []; return true
    }),
  }
  const voteStore: PollVoteStore = {
    getVote: vi.fn(async (_pollId, userId) => votes.get(userId) ?? null),
    insertVote: vi.fn(async (input: InsertPollVoteInput) => {
      if (!currentPoll || currentPoll.poll_id !== input.pollId || currentPoll.content_id !== input.contentId ||
          currentPoll.owner_user_id !== input.ownerUserId || !currentOptions.some(option => option.option_id === input.optionId) ||
          !currentPoll.ends_at || Date.parse(currentPoll.ends_at) <= Date.parse(input.createdAt) ||
          votes.has(input.userId)) return
      votes.set(input.userId, { option_id: input.optionId, created_at: input.createdAt })
    }),
  }
  return { readStore, configurationStore, deleteStore, voteStore, setBlocked: (value: boolean) => { blocked = value } }
}

const ownerBinding = (status = 200) => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const parts = new URL(request.url).pathname.split('/').filter(Boolean)
    const contentId = decodeURIComponent(parts.at(-3) ?? '')
    const ownerUserId = decodeURIComponent(parts.at(-1) ?? '')
    return Response.json(status === 200 ? { data: { contentId, ownerUserId, contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-15T04:00:00.000Z' } } : { error: { code: 'NOT_FOUND' } }, { status })
  }),
}) as W03ContentBinding & { fetch: ReturnType<typeof vi.fn> }

describe('W05 poll runtime — Neon Store ports only', () => {
  it('validates options and duration before Store access', async () => {
    const stores = pollStores(null)
    await expect(configureContentPoll(stores.configurationStore, stores.readStore, 'author-1', 'content-1', ['Same', ' same '], 1440, draftContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(configureContentPoll(stores.configurationStore, stores.readStore, 'author-1', 'content-1', ['Only one'], 1440, draftContext()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    for (const duration of [4, 10081, 5.5, Number.NaN, '5']) {
      await expect(configureContentPoll(stores.configurationStore, stores.readStore, 'author-1', 'content-1', ['Yes', 'No'], duration, draftContext()))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    }
    expect(stores.configurationStore.getPoll).not.toHaveBeenCalled()
  })

  it('creates a draft poll from W03 owner context using only injected stores', async () => {
    const stores = pollStores([], null)
    await expect(configureContentPoll(stores.configurationStore, stores.readStore, 'author-1', 'content-1', ['Yes', 'No'], 5, draftContext()))
      .resolves.toMatchObject({ durationMinutes: 5, options: [{ text: 'Yes' }, { text: 'No' }] })
    expect(stores.configurationStore.createDraftPoll).toHaveBeenCalledTimes(1)
    expect(stores.readStore.getPoll).toHaveBeenCalled()
  })

  it('rejects non-owner configuration and draft deletion before Store access', async () => {
    const stores = pollStores()
    await expect(configureContentPoll(stores.configurationStore, stores.readStore, 'attacker', 'content-1', ['Yes', 'No'], 1440, draftContext()))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(deleteContentPoll(stores.deleteStore, 'attacker', 'content-1', draftContext()))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(stores.configurationStore.getPoll).not.toHaveBeenCalled()
    expect(stores.deleteStore.getPoll).not.toHaveBeenCalled()
  })

  it('reads public poll results and viewer choice while enforcing bidirectional Block', async () => {
    const stores = pollStores()
    await expect(getContentPoll(stores.readStore, 'content-1', 'viewer-1', publishedContext()))
      .resolves.toMatchObject({ pollId: 'poll-1', totalVotes: 0, viewerOptionId: null, closed: false })
    stores.setBlocked(true)
    await expect(getContentPoll(stores.readStore, 'content-1', 'viewer-1', publishedContext()))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('starts the poll window from publication time and persists the computed end', async () => {
    const poll = { ...basePoll, ends_at: null, duration_minutes: 5 }
    const stores = pollStores(initialOptions, poll)
    await expect(getContentPoll(stores.readStore, 'content-1', null, publishedContext('author-1', '2026-10-17T04:00:00.000Z')))
      .resolves.toMatchObject({ endsAt: '2026-10-17T04:05:00.000Z', durationMinutes: 5 })
    expect(stores.readStore.setEndsAtIfUnset).toHaveBeenCalledWith('poll-1', '2026-10-17T04:05:00.000Z')
  })

  it('hides non-public poll from non-owner and detects owner mismatch', async () => {
    const stores = pollStores()
    await expect(getContentPoll(stores.readStore, 'content-1', 'stranger', { ...publishedContext(), state: 'DRAFT' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    const wrongOwner = pollStores(initialOptions, { ...basePoll, owner_user_id: 'other-owner' })
    await expect(getContentPoll(wrongOwner.readStore, 'content-1', 'author-1', publishedContext()))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('deletes an unvoted draft poll idempotently but protects a poll with votes', async () => {
    const stores = pollStores()
    await expect(deleteContentPoll(stores.deleteStore, 'author-1', 'content-1', draftContext())).resolves.toBeUndefined()
    await expect(deleteContentPoll(stores.deleteStore, 'author-1', 'content-1', draftContext())).resolves.toBeUndefined()
    expect(stores.deleteStore.deleteDraftPoll).toHaveBeenCalledTimes(1)
    const voted = pollStores()
    const vote = await voted.voteStore.getVote('poll-1', 'viewer')
    expect(vote).toBeNull()
    // Simulate a vote through the Store contract; the delete Store sees the same persisted vote ledger.
    await voted.voteStore.insertVote({ voteId: 'v1', pollId: 'poll-1', contentId: 'content-1', ownerUserId: 'author-1', optionId: 'option-1', userId: 'viewer', createdAt: '2026-10-17T05:00:00.000Z' })
    await expect(deleteContentPoll(voted.deleteStore, 'author-1', 'content-1', draftContext()))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('validates the published owner through W03 before voting and preserves idempotency', async () => {
    const stores = pollStores()
    const binding = ownerBinding()
    await expect(castContentPollVote(stores.voteStore, stores.readStore, binding, 'viewer-1', 'content-1', 'option-1', 'corr-vote'))
      .resolves.toMatchObject({ pollId: 'poll-1', viewerOptionId: 'option-1', totalVotes: 1 })
    await expect(castContentPollVote(stores.voteStore, stores.readStore, binding, 'viewer-1', 'content-1', 'option-1', 'corr-retry'))
      .resolves.toMatchObject({ viewerOptionId: 'option-1', totalVotes: 1 })
    await expect(castContentPollVote(stores.voteStore, stores.readStore, binding, 'viewer-1', 'content-1', 'option-2', 'corr-change'))
      .rejects.toMatchObject({ code: 'ALREADY_VOTED', status: 409 })
    expect(stores.voteStore.insertVote).toHaveBeenCalledTimes(1)
    expect(binding.fetch).toHaveBeenCalledTimes(3)
  })

  it('fails closed when W03 cannot verify publication or owner', async () => {
    const stores = pollStores()
    await expect(castContentPollVote(stores.voteStore, stores.readStore, undefined, 'viewer-1', 'content-1', 'option-1', 'corr-no-binding'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(castContentPollVote(stores.voteStore, stores.readStore, ownerBinding(404), 'viewer-1', 'content-1', 'option-1', 'corr-unpublished'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(stores.voteStore.insertVote).not.toHaveBeenCalled()
  })

  it('rejects a closed poll and invalid option without writing a vote', async () => {
    const closed = pollStores(initialOptions, { ...basePoll, ends_at: '2020-01-01T00:00:00.000Z' })
    await expect(castContentPollVote(closed.voteStore, closed.readStore, ownerBinding(), 'viewer-1', 'content-1', 'option-1', 'corr-closed'))
      .rejects.toMatchObject({ code: 'POLL_CLOSED', status: 409 })
    const invalid = pollStores()
    await expect(castContentPollVote(invalid.voteStore, invalid.readStore, ownerBinding(), 'viewer-1', 'content-1', 'missing-option', 'corr-option'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(closed.voteStore.insertVote).not.toHaveBeenCalled()
    expect(invalid.voteStore.insertVote).not.toHaveBeenCalled()
  })
})

/// <reference types="@cloudflare/workers-types" />
import type { OwnedPostContext } from './owned-post-context.js'
import type { PublishedContentSocialContext } from './w03-content-context-client.js'
import { ReplyAudienceRuntimeError } from './reply-audience-runtime.js'
import { fetchPublishedOwnerPostContext, type W03ContentBinding } from './w03-content-context-client.js'
import { createD1PollReadStore, type PollReadStore } from './poll-read-store.js'
import { createD1PollDeleteStore, type PollDeleteStore } from './poll-delete-store.js'
import { createD1PollConfigurationStore, type PollConfigurationStore } from './poll-configuration-store.js'
import { createD1PollVoteStore, type PollVoteStore } from './poll-vote-store.js'

export class SocialPollError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export const POLL_MIN_DURATION_MINUTES = 5
export const POLL_MAX_DURATION_MINUTES = 7 * 24 * 60
export const POLL_DEFAULT_DURATION_MINUTES = 24 * 60
export type PollDurationMinutes = number

export const isValidPollDurationMinutes = (value: unknown): value is PollDurationMinutes =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= POLL_MIN_DURATION_MINUTES &&
  value <= POLL_MAX_DURATION_MINUTES

export type PollOptionView = {
  optionId: string
  text: string
  position: number
  votes: number
}

export type PollView = {
  pollId: string
  contentId: string
  options: PollOptionView[]
  durationMinutes: PollDurationMinutes
  /** @deprecated Use durationMinutes. Retained for older API consumers. */
  durationHours: number
  endsAt: string | null
  totalVotes: number
  viewerOptionId: string | null
  closed: boolean
}

const MAX_ID = 128
const MAX_OPTIONS = 4
const MIN_OPTIONS = 2
const MAX_OPTION_LENGTH = 50

const validateId = (value: string, code: 'VALIDATION_FAILED' | 'UNAUTHENTICATED' = 'VALIDATION_FAILED'): string => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized) || normalized.length > MAX_ID) {
    throw new SocialPollError(code, code === 'UNAUTHENTICATED' ? 401 : 400)
  }
  return normalized
}

const validateOptions = (input: unknown): string[] => {
  if (!Array.isArray(input) || input.length < MIN_OPTIONS || input.length > MAX_OPTIONS) {
    throw new SocialPollError('VALIDATION_FAILED', 400)
  }
  const options: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'string') throw new SocialPollError('VALIDATION_FAILED', 400)
    const text = item.trim().normalize('NFKC')
    if (!text || [...text].length > MAX_OPTION_LENGTH) throw new SocialPollError('VALIDATION_FAILED', 400)
    const key = text.toLocaleLowerCase('en-US')
    if (seen.has(key)) throw new SocialPollError('VALIDATION_FAILED', 400)
    seen.add(key)
    options.push(text)
  }
  return options
}

const validateDurationMinutes = (value: unknown): PollDurationMinutes => {
  if (value === undefined || value === null) return POLL_DEFAULT_DURATION_MINUTES
  if (!isValidPollDurationMinutes(value)) throw new SocialPollError('VALIDATION_FAILED', 400)
  return value
}

// Keep the old constrained hour column valid for already deployed W05 versions.
// Custom minute values use the legacy 24-hour default only as a compatibility placeholder.
const toLegacyDurationHours = (durationMinutes: number): 24 | 72 | 168 =>
  durationMinutes === 4320 ? 72 : durationMinutes === 10080 ? 168 : 24


type ContentRow = {
  id: string
  content_type: string
  state: string
  owner_user_id: string | null
  updated_at: string
}

type PollRow = {
  poll_id: string
  content_id: string
  owner_user_id: string
  duration_minutes: number
  ends_at: string | null
  created_at: string
  updated_at: string
}

const rowFromOwnedPostContext = (
  contentId: string,
  context: OwnedPostContext | undefined,
): ContentRow | null => {
  if (
    !context ||
    context.contentId !== contentId ||
    context.contentType !== 'post' ||
    !['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(context.state) ||
    !context.updatedAt.trim()
  ) {
    return null
  }
  return {
    id: context.contentId,
    content_type: context.contentType,
    state: context.state,
    owner_user_id: context.ownerUserId,
    updated_at: context.updatedAt,
  }
}

type PollContentContext = OwnedPostContext | PublishedContentSocialContext

const rowFromPollContentContext = (
  contentId: string,
  context: PollContentContext | undefined,
): ContentRow | null => {
  if (
    !context ||
    context.contentId !== contentId ||
    context.contentType !== 'post' ||
    !['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(context.state) ||
    typeof context.updatedAt !== 'string' ||
    !context.updatedAt.trim()
  ) {
    return null
  }
  return {
    id: context.contentId,
    content_type: context.contentType,
    state: context.state,
    owner_user_id: context.ownerUserId,
    updated_at: context.updatedAt,
  }
}

const effectiveEndTime = (row: PollRow, contentUpdatedAt: string, published: boolean): string | null => {
  if (row.ends_at) return row.ends_at
  if (!published) return null
  const publishedAt = Date.parse(contentUpdatedAt)
  if (!Number.isFinite(publishedAt)) throw new SocialPollError('INTERNAL_ERROR', 500)
  return new Date(publishedAt + Number(row.duration_minutes) * 60_000).toISOString()
}

export async function getContentPoll(
  db: D1Database,
  contentIdValue: string,
  viewerUserIdValue: string | null,
  contentContext: PollContentContext,
  store: PollReadStore = createD1PollReadStore(db),
): Promise<PollView | null> {
  const contentId = validateId(contentIdValue)
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue, 'UNAUTHENTICATED') : null
  const content = rowFromPollContentContext(contentId, contentContext)

  if (!content || content.content_type !== 'post') throw new SocialPollError('NOT_FOUND', 404)
  const isOwner = Boolean(viewerUserId && content.owner_user_id === viewerUserId)
  const isPublic = content.state === 'PUBLISHED'
  if (!isPublic && !isOwner) throw new SocialPollError('NOT_FOUND', 404)

  if (viewerUserId && content.owner_user_id && viewerUserId !== content.owner_user_id) {
    let blocked: boolean
    try {
      blocked = await store.isBlocked(viewerUserId, content.owner_user_id)
    } catch {
      throw new SocialPollError('INTERNAL_ERROR', 500)
    }
    if (blocked) throw new SocialPollError('NOT_FOUND', 404)
  }

  let poll: Awaited<ReturnType<PollReadStore['getPoll']>>
  try {
    poll = await store.getPoll(contentId)
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }
  if (!poll) return null
  if (poll.owner_user_id !== content.owner_user_id) throw new SocialPollError('CONFLICT', 409)

  const durationMinutes = Number(poll.duration_minutes)
  if (!isValidPollDurationMinutes(durationMinutes)) throw new SocialPollError('INTERNAL_ERROR', 500)
  const endsAt = effectiveEndTime(poll, content.updated_at, isPublic)
  if (isPublic && !poll.ends_at && endsAt) {
    try {
      await store.setEndsAtIfUnset(poll.poll_id, endsAt)
    } catch {
      throw new SocialPollError('INTERNAL_ERROR', 500)
    }
  }

  let rows: Awaited<ReturnType<PollReadStore['listOptionsWithVoteCounts']>>
  try {
    rows = await store.listOptionsWithVoteCounts(poll.poll_id)
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }

  const options = rows.map(row => ({
    optionId: row.option_id,
    text: row.option_text,
    position: Number(row.position),
    votes: Number(row.votes),
  }))
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) throw new SocialPollError('CONFLICT', 409)

  let viewerOptionId: string | null = null
  if (viewerUserId && isPublic) {
    try {
      viewerOptionId = await store.getViewerOptionId(poll.poll_id, viewerUserId)
    } catch {
      throw new SocialPollError('INTERNAL_ERROR', 500)
    }
  }
  const totalVotes = options.reduce((total, option) => total + option.votes, 0)
  const closed = Boolean(isPublic && endsAt && Date.parse(endsAt) <= Date.now())
  return {
    pollId: poll.poll_id,
    contentId,
    options,
    durationMinutes,
    durationHours: durationMinutes / 60,
    endsAt,
    totalVotes,
    viewerOptionId,
    closed,
  }
}

export async function configureContentPoll(
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
  optionsInput: unknown,
  durationInput: unknown,
  contentContext?: OwnedPostContext,
  configurationStore: PollConfigurationStore = createD1PollConfigurationStore(db),
  readStore: PollReadStore = createD1PollReadStore(db),
): Promise<PollView> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const contentId = validateId(contentIdValue)
  const options = validateOptions(optionsInput)
  const durationMinutes = validateDurationMinutes(durationInput)
  if (!contentContext) throw new SocialPollError('SERVICE_UNAVAILABLE', 503)
  const content = rowFromOwnedPostContext(contentId, contentContext)

  if (!content || content.content_type !== 'post' || content.owner_user_id !== actorUserId) {
    throw new SocialPollError('NOT_FOUND', 404)
  }

  let existing: PollRow | null
  try {
    existing = await configurationStore.getPoll(contentId)
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }

  if (content.state !== 'DRAFT') {
    if (content.state !== 'PUBLISHED' || !existing) throw new SocialPollError('CONFLICT', 409)
    let existingOptions: string[]
    try {
      existingOptions = await configurationStore.listOptionTexts(existing.poll_id)
    } catch {
      throw new SocialPollError('INTERNAL_ERROR', 500)
    }
    if (Number(existing.duration_minutes) !== durationMinutes ||
        JSON.stringify(existingOptions) !== JSON.stringify(options)) {
      throw new SocialPollError('CONFLICT', 409)
    }
    const current = await getContentPoll(db, contentId, actorUserId, contentContext, readStore)
    if (!current) throw new SocialPollError('CONFLICT', 409)
    return current
  }

  if (existing) {
    let existingOptions: string[]
    let voteCount: number
    try {
      [existingOptions, voteCount] = await Promise.all([
        configurationStore.listOptionTexts(existing.poll_id),
        configurationStore.countVotes(existing.poll_id),
      ])
    } catch {
      throw new SocialPollError('INTERNAL_ERROR', 500)
    }
    const sameOptions = JSON.stringify(existingOptions) === JSON.stringify(options)
    const sameDuration = Number(existing.duration_minutes) === durationMinutes
    if (voteCount > 0) {
      if (sameOptions && sameDuration) {
        const current = await getContentPoll(db, contentId, actorUserId, contentContext, readStore)
        if (current) return current
      }
      throw new SocialPollError('CONFLICT', 409)
    }
    if (sameOptions && sameDuration) {
      const current = await getContentPoll(db, contentId, actorUserId, contentContext, readStore)
      if (current) return current
    }

    const now = new Date().toISOString()
    try {
      await configurationStore.updateDraftPoll({
        pollId: existing.poll_id,
        contentId,
        ownerUserId: actorUserId,
        durationHours: toLegacyDurationHours(durationMinutes),
        durationMinutes,
        updatedAt: now,
        options: options.map((text, position) => ({
          optionId: crypto.randomUUID(),
          text,
          position,
        })),
      })
    } catch {
      throw new SocialPollError('INTERNAL_ERROR', 500)
    }

    const refreshed = await getContentPoll(db, contentId, actorUserId, contentContext, readStore)
    if (!refreshed ||
        refreshed.options.length !== options.length ||
        refreshed.durationMinutes !== durationMinutes ||
        refreshed.options.some((option, i) => option.text !== options[i])) {
      throw new SocialPollError('CONFLICT', 409)
    }
    return refreshed
  }

  const pollId = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    await configurationStore.createDraftPoll({
      pollId,
      contentId,
      ownerUserId: actorUserId,
      durationHours: toLegacyDurationHours(durationMinutes),
      durationMinutes,
      createdAt: now,
      options: options.map((text, position) => ({
        optionId: crypto.randomUUID(),
        text,
        position,
      })),
    })
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }

  const configured = await getContentPoll(db, contentId, actorUserId, contentContext, readStore)
  if (!configured ||
      configured.options.length !== options.length ||
      configured.durationMinutes !== durationMinutes ||
      configured.options.some((option, i) => option.text !== options[i])) {
    throw new SocialPollError('CONFLICT', 409)
  }
  return configured
}

export async function deleteContentPoll(
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
  contentContext?: OwnedPostContext,
  store: PollDeleteStore = createD1PollDeleteStore(db),
): Promise<void> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const contentId = validateId(contentIdValue)
  if (!contentContext) throw new SocialPollError('SERVICE_UNAVAILABLE', 503)
  const content = rowFromOwnedPostContext(contentId, contentContext)
  if (!content || content.content_type !== 'post' || content.owner_user_id !== actorUserId) {
    throw new SocialPollError('NOT_FOUND', 404)
  }
  if (content.state !== 'DRAFT') throw new SocialPollError('CONFLICT', 409)

  let poll: Awaited<ReturnType<PollDeleteStore['getPoll']>>
  try {
    poll = await store.getPoll(contentId)
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }
  if (!poll) return

  let voteCount: number
  try {
    voteCount = await store.countVotes(poll.poll_id)
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }
  if (voteCount > 0) throw new SocialPollError('CONFLICT', 409)

  let deleted: boolean
  try {
    deleted = await store.deleteDraftPoll({
      pollId: poll.poll_id,
      actorUserId,
      contentId,
    })
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }
  if (deleted) return

  // A concurrent delete is idempotent; a still-present poll means its
  // owner/vote guard changed while the delete was being committed.
  let current: Awaited<ReturnType<PollDeleteStore['getPoll']>>
  try {
    current = await store.getPoll(contentId)
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }
  if (!current) return
  throw new SocialPollError('CONFLICT', 409)
}

export async function castContentPollVote(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  actorUserIdValue: string,
  contentIdValue: string,
  optionIdValue: string,
  correlationId: string,
  voteStore: PollVoteStore = createD1PollVoteStore(db),
  readStore: PollReadStore = createD1PollReadStore(db),
): Promise<PollView> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const contentId = validateId(contentIdValue)
  const optionId = validateId(optionIdValue)
  if (!correlationId.trim()) throw new SocialPollError('VALIDATION_FAILED', 400)

  // Resolve the expected owner from W05's poll record, then ask W03 to
  // verify the canonical item is still a published post owned by them.
  let poll: PollRow | null
  try {
    poll = await readStore.getPoll(contentId)
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }
  if (!poll) throw new SocialPollError('NOT_FOUND', 404)

  let contentContext: OwnedPostContext
  try {
    contentContext = await fetchPublishedOwnerPostContext(w03Content, {
      ownerUserId: validateId(poll.owner_user_id),
      contentId,
      correlationId,
    })
  } catch (error) {
    if (error instanceof ReplyAudienceRuntimeError) {
      if (error.status === 404) throw new SocialPollError('NOT_FOUND', 404)
      if (error.status === 400) throw new SocialPollError('VALIDATION_FAILED', 400)
      if (error.status === 403) throw new SocialPollError('PERMISSION_DENIED', 403)
      if (error.status === 429) throw new SocialPollError('RATE_LIMITED', 429)
    }
    throw new SocialPollError('SERVICE_UNAVAILABLE', 503)
  }

  if (
    contentContext.contentId !== contentId ||
    contentContext.ownerUserId !== poll.owner_user_id ||
    contentContext.contentType !== 'post' ||
    contentContext.state !== 'PUBLISHED'
  ) {
    throw new SocialPollError('NOT_FOUND', 404)
  }

  const ownerUserId = contentContext.ownerUserId
  if (actorUserId !== ownerUserId) {
    let blocked: boolean
    try {
      blocked = await readStore.isBlocked(actorUserId, ownerUserId)
    } catch {
      throw new SocialPollError('INTERNAL_ERROR', 500)
    }
    if (blocked) throw new SocialPollError('NOT_FOUND', 404)
  }

  const currentPoll = await getContentPoll(db, contentId, actorUserId, contentContext, readStore)
  if (!currentPoll) throw new SocialPollError('NOT_FOUND', 404)
  if (!currentPoll.options.some(option => option.optionId === optionId)) {
    throw new SocialPollError('VALIDATION_FAILED', 400)
  }
  if (currentPoll.closed) throw new SocialPollError('POLL_CLOSED', 409)

  let priorVote: Awaited<ReturnType<PollVoteStore['getVote']>>
  try {
    priorVote = await voteStore.getVote(poll.poll_id, actorUserId)
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }
  if (priorVote) {
    if (priorVote.option_id !== optionId) throw new SocialPollError('ALREADY_VOTED', 409)
    return currentPoll
  }

  const now = new Date().toISOString()
  try {
    await voteStore.insertVote({
      voteId: crypto.randomUUID(),
      pollId: poll.poll_id,
      contentId,
      ownerUserId,
      optionId,
      userId: actorUserId,
      createdAt: now,
    })
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }

  // Re-read after the conditional insert so concurrent requests that raced
  // on the unique (poll_id, user_id) constraint observe the winning choice.
  let savedVote: Awaited<ReturnType<PollVoteStore['getVote']>>
  try {
    savedVote = await voteStore.getVote(poll.poll_id, actorUserId)
  } catch {
    throw new SocialPollError('INTERNAL_ERROR', 500)
  }
  if (!savedVote) throw new SocialPollError('POLL_CLOSED', 409)
  if (savedVote.option_id !== optionId) throw new SocialPollError('ALREADY_VOTED', 409)

  const refreshed = await getContentPoll(db, contentId, actorUserId, contentContext, readStore)
  if (!refreshed) throw new SocialPollError('NOT_FOUND', 404)
  return refreshed
}

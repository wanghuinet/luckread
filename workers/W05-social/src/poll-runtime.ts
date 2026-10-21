/// <reference types="@cloudflare/workers-types" />
import type { OwnedPostContext } from './owned-post-context.js'
import { ReplyAudienceRuntimeError } from './reply-audience-runtime.js'
import { fetchPublishedOwnerPostContext, type W03ContentBinding } from './w03-content-context-client.js'

export class SocialPollError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export const POLL_DURATIONS = [24, 72, 168] as const
export type PollDurationHours = typeof POLL_DURATIONS[number]

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
  durationHours: PollDurationHours
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

const validateDuration = (value: unknown): PollDurationHours => {
  if (value === undefined || value === null) return 24
  if (typeof value !== 'number' || !POLL_DURATIONS.includes(value as PollDurationHours)) {
    throw new SocialPollError('VALIDATION_FAILED', 400)
  }
  return value as PollDurationHours
}

const isBlocked = async (db: D1Database, viewerUserId: string, ownerUserId: string): Promise<boolean> => {
  if (viewerUserId === ownerUserId) return false
  const row = await db.prepare(
    `SELECT 1
       FROM social_user_interactions
      WHERE relation_type = 'block'
        AND ((actor_user_id = ? AND target_user_id = ?)
          OR (actor_user_id = ? AND target_user_id = ?))
      LIMIT 1`,
  ).bind(viewerUserId, ownerUserId, ownerUserId, viewerUserId).first()
  return Boolean(row)
}

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
  duration_hours: number
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

const readPollRow = (db: D1Database, contentId: string) => db.prepare(
  `SELECT poll_id, content_id, owner_user_id, duration_hours, ends_at, created_at, updated_at
     FROM social_polls
    WHERE content_id = ?
    LIMIT 1`,
).bind(contentId).first<PollRow>()

const effectiveEndTime = (row: PollRow, contentUpdatedAt: string, published: boolean): string | null => {
  if (row.ends_at) return row.ends_at
  if (!published) return null
  const publishedAt = Date.parse(contentUpdatedAt)
  if (!Number.isFinite(publishedAt)) throw new SocialPollError('INTERNAL_ERROR', 500)
  return new Date(publishedAt + Number(row.duration_hours) * 60 * 60 * 1000).toISOString()
}

export async function getContentPoll(
  db: D1Database,
  contentIdValue: string,
  viewerUserIdValue: string | null,
  contentContext?: OwnedPostContext,
): Promise<PollView | null> {
  const contentId = validateId(contentIdValue)
  const viewerUserId = viewerUserIdValue ? validateId(viewerUserIdValue, 'UNAUTHENTICATED') : null
  const content = contentContext
    ? rowFromOwnedPostContext(contentId, contentContext)
    : await db.prepare(
        'SELECT id, content_type, state, owner_user_id, updated_at FROM contents WHERE id = ? LIMIT 1',
      ).bind(contentId).first<ContentRow>()

  if (!content || content.content_type !== 'post') throw new SocialPollError('NOT_FOUND', 404)
  const isOwner = Boolean(viewerUserId && content.owner_user_id === viewerUserId)
  const isPublic = content.state === 'PUBLISHED'
  if (!isPublic && !isOwner) throw new SocialPollError('NOT_FOUND', 404)

  if (viewerUserId && content.owner_user_id && await isBlocked(db, viewerUserId, content.owner_user_id)) {
    throw new SocialPollError('NOT_FOUND', 404)
  }

  const poll = await readPollRow(db, contentId)
  if (!poll) return null
  if (poll.owner_user_id !== content.owner_user_id) throw new SocialPollError('CONFLICT', 409)

  const durationHours = Number(poll.duration_hours)
  if (!POLL_DURATIONS.includes(durationHours as PollDurationHours)) throw new SocialPollError('INTERNAL_ERROR', 500)
  const endsAt = effectiveEndTime(poll, content.updated_at, isPublic)
  if (isPublic && !poll.ends_at && endsAt) {
    await db.prepare('UPDATE social_polls SET ends_at = ? WHERE poll_id = ? AND ends_at IS NULL')
      .bind(endsAt, poll.poll_id).run()
  }

  const rows = await db.prepare(
    `SELECT o.option_id, o.option_text, o.position, COUNT(v.vote_id) AS votes
       FROM social_poll_options o
       LEFT JOIN social_poll_votes v ON v.poll_id = o.poll_id AND v.option_id = o.option_id
      WHERE o.poll_id = ?
      GROUP BY o.option_id, o.option_text, o.position
      ORDER BY o.position ASC`,
  ).bind(poll.poll_id).all<{ option_id: string; option_text: string; position: number; votes: number }>()

  const options = (rows.results ?? []).map(row => ({
    optionId: row.option_id,
    text: row.option_text,
    position: Number(row.position),
    votes: Number(row.votes),
  }))
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) throw new SocialPollError('CONFLICT', 409)

  let viewerOptionId: string | null = null
  if (viewerUserId && isPublic) {
    const vote = await db.prepare(
      'SELECT option_id FROM social_poll_votes WHERE poll_id = ? AND user_id = ? LIMIT 1',
    ).bind(poll.poll_id, viewerUserId).first<{ option_id: string }>()
    viewerOptionId = vote?.option_id ?? null
  }
  const totalVotes = options.reduce((total, option) => total + option.votes, 0)
  const closed = Boolean(isPublic && endsAt && Date.parse(endsAt) <= Date.now())
  return {
    pollId: poll.poll_id,
    contentId,
    options,
    durationHours: durationHours as PollDurationHours,
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
): Promise<PollView> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const contentId = validateId(contentIdValue)
  const options = validateOptions(optionsInput)
  const durationHours = validateDuration(durationInput)
  if (!contentContext) throw new SocialPollError('SERVICE_UNAVAILABLE', 503)
  const content = rowFromOwnedPostContext(contentId, contentContext)

  if (!content || content.content_type !== 'post' || content.owner_user_id !== actorUserId) {
    throw new SocialPollError('NOT_FOUND', 404)
  }

  const existing = await readPollRow(db, contentId)
  if (content.state !== 'DRAFT') {
    if (content.state !== 'PUBLISHED' || !existing) throw new SocialPollError('CONFLICT', 409)
    const existingOptions = await db.prepare(
      'SELECT option_text FROM social_poll_options WHERE poll_id = ? ORDER BY position ASC',
    ).bind(existing.poll_id).all<{ option_text: string }>()
    const sameOptions = (existingOptions.results ?? []).map(row => row.option_text)
    if (existing.duration_hours !== durationHours || JSON.stringify(sameOptions) !== JSON.stringify(options)) {
      throw new SocialPollError('CONFLICT', 409)
    }
    const current = await getContentPoll(db, contentId, actorUserId, contentContext)
    if (!current) throw new SocialPollError('CONFLICT', 409)
    return current
  }

  if (existing) {
    const existingOptions = await db.prepare(
      'SELECT option_text FROM social_poll_options WHERE poll_id = ? ORDER BY position ASC',
    ).bind(existing.poll_id).all<{ option_text: string }>()
    const currentOptions = (existingOptions.results ?? []).map(row => row.option_text)
    const voteCount = await db.prepare(
      'SELECT COUNT(*) AS count FROM social_poll_votes WHERE poll_id = ?',
    ).bind(existing.poll_id).first<{ count: number }>()
    const sameOptions = JSON.stringify(currentOptions) === JSON.stringify(options)
    if (Number(voteCount?.count ?? 0) > 0) {
      if (sameOptions && Number(existing.duration_hours) === durationHours) {
        const current = await getContentPoll(db, contentId, actorUserId, contentContext)
        if (current) return current
      }
      throw new SocialPollError('CONFLICT', 409)
    }
    if (sameOptions && Number(existing.duration_hours) === durationHours) {
      const current = await getContentPoll(db, contentId, actorUserId, contentContext)
      if (current) return current
    }

    const now = new Date().toISOString()
    const statements = [
      db.prepare(
        'UPDATE social_polls SET duration_hours = ?, ends_at = NULL, updated_at = ? WHERE poll_id = ? AND NOT EXISTS (SELECT 1 FROM social_poll_votes WHERE poll_id = ?)',
      ).bind(durationHours, now, existing.poll_id, existing.poll_id),
      db.prepare(
        'DELETE FROM social_poll_options WHERE poll_id = ? AND EXISTS (SELECT 1 FROM social_polls WHERE poll_id = ? AND updated_at = ?)',
      ).bind(existing.poll_id, existing.poll_id, now),
      ...options.map((text, position) => db.prepare(
        `INSERT INTO social_poll_options (option_id, poll_id, option_text, position)
         SELECT ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM social_polls WHERE poll_id = ? AND updated_at = ?)
            AND NOT EXISTS (SELECT 1 FROM social_poll_votes WHERE poll_id = ?)`,
      ).bind(crypto.randomUUID(), existing.poll_id, text, position, existing.poll_id, now, existing.poll_id)),
    ]
    await db.batch(statements)
    const refreshed = await getContentPoll(db, contentId, actorUserId, contentContext)
    if (!refreshed || refreshed.options.length !== options.length) throw new SocialPollError('CONFLICT', 409)
    return refreshed
  }

  if (content.state !== 'DRAFT') throw new SocialPollError('CONFLICT', 409)
  const pollId = crypto.randomUUID()
  const now = new Date().toISOString()
  const statements = [
    db.prepare(
      'INSERT OR IGNORE INTO social_polls (poll_id, content_id, owner_user_id, duration_hours, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
    ).bind(pollId, contentId, actorUserId, durationHours, now, now),
    ...options.map((text, position) => db.prepare(
      `INSERT OR IGNORE INTO social_poll_options (option_id, poll_id, option_text, position)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM social_polls WHERE poll_id = ?)`,
    ).bind(crypto.randomUUID(), pollId, text, position, pollId)),
  ]
  await db.batch(statements)
  const configured = await getContentPoll(db, contentId, actorUserId, contentContext)
  if (!configured || configured.options.length !== options.length ||
      configured.durationHours !== durationHours ||
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
): Promise<void> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const contentId = validateId(contentIdValue)
  if (!contentContext) throw new SocialPollError('SERVICE_UNAVAILABLE', 503)
  const content = rowFromOwnedPostContext(contentId, contentContext)
  if (!content || content.content_type !== 'post' || content.owner_user_id !== actorUserId) {
    throw new SocialPollError('NOT_FOUND', 404)
  }
  if (content.state !== 'DRAFT') throw new SocialPollError('CONFLICT', 409)
  const poll = await readPollRow(db, contentId)
  if (!poll) return
  const voteCount = await db.prepare(
    'SELECT COUNT(*) AS count FROM social_poll_votes WHERE poll_id = ?',
  ).bind(poll.poll_id).first<{ count: number }>()
  if (Number(voteCount?.count ?? 0) > 0) throw new SocialPollError('CONFLICT', 409)
  await db.batch([
    db.prepare('DELETE FROM social_poll_options WHERE poll_id = ?').bind(poll.poll_id),
    db.prepare('DELETE FROM social_polls WHERE poll_id = ? AND owner_user_id = ? AND content_id = ?').bind(poll.poll_id, actorUserId, contentId),
  ])
}

export async function castContentPollVote(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  actorUserIdValue: string,
  contentIdValue: string,
  optionIdValue: string,
  correlationId: string,
): Promise<PollView> {
  const actorUserId = validateId(actorUserIdValue, 'UNAUTHENTICATED')
  const contentId = validateId(contentIdValue)
  const optionId = validateId(optionIdValue)
  if (!correlationId.trim()) throw new SocialPollError('VALIDATION_FAILED', 400)

  // Resolve the expected owner from W05's own poll record, then ask W03 to
  // verify that the canonical item is still a published post owned by them.
  const poll = await readPollRow(db, contentId)
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
  if (await isBlocked(db, actorUserId, ownerUserId)) {
    throw new SocialPollError('NOT_FOUND', 404)
  }

  const currentPoll = await getContentPoll(db, contentId, actorUserId, contentContext)
  if (!currentPoll) throw new SocialPollError('NOT_FOUND', 404)
  if (!currentPoll.options.some(option => option.optionId === optionId)) {
    throw new SocialPollError('VALIDATION_FAILED', 400)
  }
  if (currentPoll.closed) throw new SocialPollError('POLL_CLOSED', 409)

  const priorVote = await db.prepare(
    'SELECT option_id, created_at FROM social_poll_votes WHERE poll_id = ? AND user_id = ? LIMIT 1',
  ).bind(poll.poll_id, actorUserId).first<{ option_id: string; created_at: string }>()
  if (priorVote) {
    if (priorVote.option_id !== optionId) throw new SocialPollError('ALREADY_VOTED', 409)
    return currentPoll
  }

  const now = new Date().toISOString()
  await db.prepare(
    `INSERT OR IGNORE INTO social_poll_votes (vote_id, poll_id, option_id, user_id, created_at)
     SELECT ?, p.poll_id, o.option_id, ?, ?
       FROM social_polls p
       JOIN social_poll_options o ON o.poll_id = p.poll_id AND o.option_id = ?
      WHERE p.content_id = ?
        AND p.owner_user_id = ?
        AND p.ends_at IS NOT NULL
        AND p.ends_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM social_user_interactions b
           WHERE b.relation_type = 'block'
             AND ((b.actor_user_id = ? AND b.target_user_id = ?)
               OR (b.actor_user_id = ? AND b.target_user_id = ?))
        )
        AND NOT EXISTS (
          SELECT 1 FROM social_poll_votes existing
           WHERE existing.poll_id = p.poll_id AND existing.user_id = ?
        )`,
  ).bind(
    crypto.randomUUID(),
    actorUserId,
    now,
    optionId,
    contentId,
    ownerUserId,
    now,
    actorUserId,
    ownerUserId,
    ownerUserId,
    actorUserId,
    actorUserId,
  ).run()

  const savedVote = await db.prepare(
    'SELECT option_id FROM social_poll_votes WHERE poll_id = ? AND user_id = ? LIMIT 1',
  ).bind(poll.poll_id, actorUserId).first<{ option_id: string }>()
  if (!savedVote) throw new SocialPollError('POLL_CLOSED', 409)
  if (savedVote.option_id !== optionId) throw new SocialPollError('ALREADY_VOTED', 409)
  const refreshed = await getContentPoll(db, contentId, actorUserId, contentContext)
  if (!refreshed) throw new SocialPollError('NOT_FOUND', 404)
  return refreshed
}

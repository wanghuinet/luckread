/// <reference types="@cloudflare/workers-types" />
import type { OwnedPostContext } from './owned-post-context.js'
import type { ReplyAudienceStore } from './reply-audience-store.js'

export type ReplyAudience = 'everyone' | 'verified' | 'following' | 'mentioned' | 'followingNetwork'

export class ReplyAudienceRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type ReplyAudienceRecord = {
  contentId: string
  ownerUserId: string
  replyAudience: ReplyAudience
  mentionedUserIds: string[]
  updatedAt: string
}

const MAX_ID = 128
const MAX_MENTIONS = 20
const allowedAudiences = new Set<ReplyAudience>([
  'everyone',
  'verified',
  'following',
  'mentioned',
  'followingNetwork',
])

const validateId = (value: string, actor = false): string => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized) || normalized.length > MAX_ID) {
    throw new ReplyAudienceRuntimeError(actor ? 'UNAUTHENTICATED' : 'VALIDATION_FAILED', actor ? 401 : 400)
  }
  return normalized
}

const validateAudience = (value: unknown): ReplyAudience => {
  if (typeof value !== 'string' || !allowedAudiences.has(value as ReplyAudience)) {
    throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400)
  }
  return value as ReplyAudience
}

const validateMentionedUserIds = (value: unknown): string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_MENTIONS || value.some((item) => typeof item !== 'string')) {
    throw new ReplyAudienceRuntimeError('VALIDATION_FAILED', 400)
  }
  const ids = [...new Set((value as string[]).map((item) => validateId(item)))]
  return ids
}

/**
 * Only a post owner can set a reply policy. The content stays canonical in W03;
 * this table stores only the W05-owned policy and the bounded mention allowlist.
 */
export async function setContentReplyAudience(
  store: ReplyAudienceStore,
  actorUserIdValue: string,
  contentIdValue: string,
  audienceValue: unknown,
  mentionedUserIdsValue: unknown,
  context: OwnedPostContext,
): Promise<ReplyAudienceRecord> {
  const actorUserId = validateId(actorUserIdValue, true)
  const contentId = validateId(contentIdValue)
  const replyAudience = validateAudience(audienceValue)
  const mentionedUserIds = validateMentionedUserIds(mentionedUserIdsValue)
  const mentionedUserIdsJson = JSON.stringify(mentionedUserIds)
  if (
    context.contentId !== contentId ||
    context.ownerUserId !== actorUserId ||
    context.contentType !== 'post' ||
    !['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(context.state) ||
    !context.updatedAt
  ) {
    throw new ReplyAudienceRuntimeError('NOT_FOUND', 404)
  }

  const now = new Date().toISOString()
  let saved: Awaited<ReturnType<ReplyAudienceStore['set']>>
  try {
    saved = await store.set({
      contentId,
      ownerUserId: actorUserId,
      audience: replyAudience,
      mentionedUserIdsJson,
      now,
    })
  } catch {
    throw new ReplyAudienceRuntimeError('INTERNAL_ERROR', 500)
  }

  if (!saved) throw new ReplyAudienceRuntimeError('CONFLICT', 409)
  let savedMentions: unknown
  try { savedMentions = JSON.parse(saved.mentionedUserIdsJson) } catch {
    throw new ReplyAudienceRuntimeError('INTERNAL_ERROR', 500)
  }
  if (!Array.isArray(savedMentions) || savedMentions.some((id) => typeof id !== 'string')) {
    throw new ReplyAudienceRuntimeError('INTERNAL_ERROR', 500)
  }
  return {
    contentId: saved.contentId,
    ownerUserId: saved.ownerUserId,
    replyAudience: saved.audience,
    mentionedUserIds: savedMentions as string[],
    updatedAt: saved.updatedAt,
  }
}

/** The owner check comes from W03; W05 reads only its own persisted reply policy. */
export async function getContentReplyAudience(
  store: ReplyAudienceStore,
  actorUserIdValue: string,
  contentIdValue: string,
  context: OwnedPostContext,
): Promise<ReplyAudienceRecord> {
  const actorUserId = validateId(actorUserIdValue, true)
  const contentId = validateId(contentIdValue)
  if (
    context.contentId !== contentId ||
    context.ownerUserId !== actorUserId ||
    context.contentType !== 'post' ||
    !['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(context.state) ||
    !context.updatedAt
  ) {
    throw new ReplyAudienceRuntimeError('NOT_FOUND', 404)
  }
  let row: Awaited<ReturnType<ReplyAudienceStore['get']>>
  try {
    row = await store.get(contentId, actorUserId)
  } catch {
    throw new ReplyAudienceRuntimeError('INTERNAL_ERROR', 500)
  }
  let mentionedUserIds: unknown
  try { mentionedUserIds = JSON.parse(row?.mentionedUserIdsJson ?? '[]') } catch {
    throw new ReplyAudienceRuntimeError('INTERNAL_ERROR', 500)
  }
  if (!Array.isArray(mentionedUserIds) || mentionedUserIds.some((id) => typeof id !== 'string')) {
    throw new ReplyAudienceRuntimeError('INTERNAL_ERROR', 500)
  }
  return {
    contentId,
    ownerUserId: actorUserId,
    replyAudience: row?.audience ?? 'everyone',
    mentionedUserIds: mentionedUserIds as string[],
    updatedAt: row?.updatedAt ?? context.updatedAt,
  }
}


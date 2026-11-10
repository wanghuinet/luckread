/// <reference types="@cloudflare/workers-types" />
import type { OwnedPostContext } from './owned-post-context.js'
import { createD1ReplyAudienceStore, type ReplyAudienceStore } from './reply-audience-store.js'

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
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
  audienceValue: unknown,
  mentionedUserIdsValue: unknown,
  context: OwnedPostContext,
  store: ReplyAudienceStore = createD1ReplyAudienceStore(db),
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
  let saved
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
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
  context: OwnedPostContext,
  store: ReplyAudienceStore = createD1ReplyAudienceStore(db),
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
  let row
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

/**
 * SQL predicate shared by the pre-check and final INSERT. The final INSERT
 * re-evaluates it to close races with follow/block/policy changes.
 */
export const replyAudienceAllowedSql = `(
  ? = content.owner_user_id
  OR
  COALESCE((SELECT policy.audience FROM social_content_reply_policies policy WHERE policy.content_id = content.id), 'everyone') = 'everyone'
  OR (
    COALESCE((SELECT policy.audience FROM social_content_reply_policies policy WHERE policy.content_id = content.id), 'everyone') = 'verified'
    AND ? = 1
  )
  OR (
    COALESCE((SELECT policy.audience FROM social_content_reply_policies policy WHERE policy.content_id = content.id), 'everyone') = 'following'
    AND EXISTS (
      SELECT 1 FROM social_follow_relationships direct_follow
       WHERE direct_follow.follower_user_id = content.owner_user_id
         AND direct_follow.target_user_id = ?
    )
  )
  OR (
    COALESCE((SELECT policy.audience FROM social_content_reply_policies policy WHERE policy.content_id = content.id), 'everyone') = 'mentioned'
    AND EXISTS (
      SELECT 1 FROM json_each(
        COALESCE((SELECT policy.mentioned_user_ids_json FROM social_content_reply_policies policy WHERE policy.content_id = content.id), '[]')
      ) AS mentioned_user
       WHERE CAST(mentioned_user.value AS TEXT) = ?
    )
  )
  OR (
    COALESCE((SELECT policy.audience FROM social_content_reply_policies policy WHERE policy.content_id = content.id), 'everyone') = 'followingNetwork'
    AND (
      EXISTS (
        SELECT 1 FROM social_follow_relationships direct_follow
         WHERE direct_follow.follower_user_id = content.owner_user_id
           AND direct_follow.target_user_id = ?
      )
      OR EXISTS (
        SELECT 1
          FROM social_follow_relationships owner_follow
          JOIN social_follow_relationships second_degree
            ON second_degree.follower_user_id = owner_follow.target_user_id
         WHERE owner_follow.follower_user_id = content.owner_user_id
           AND second_degree.target_user_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM social_user_interactions owner_middle_block
              WHERE owner_middle_block.relation_type = 'block'
                AND (
                  (owner_middle_block.actor_user_id = content.owner_user_id AND owner_middle_block.target_user_id = owner_follow.target_user_id)
                  OR
                  (owner_middle_block.actor_user_id = owner_follow.target_user_id AND owner_middle_block.target_user_id = content.owner_user_id)
                )
           )
           AND NOT EXISTS (
             SELECT 1 FROM social_user_interactions middle_actor_block
              WHERE middle_actor_block.relation_type = 'block'
                AND (
                  (middle_actor_block.actor_user_id = owner_follow.target_user_id AND middle_actor_block.target_user_id = ?)
                  OR
                  (middle_actor_block.actor_user_id = ? AND middle_actor_block.target_user_id = owner_follow.target_user_id)
                )
           )
      )
    )
  )
  OR EXISTS (
    SELECT 1 FROM json_each(
      COALESCE((SELECT policy.mentioned_user_ids_json FROM social_content_reply_policies policy WHERE policy.content_id = content.id), '[]')
    ) AS mentioned_override
     WHERE CAST(mentioned_override.value AS TEXT) = ?
  )
)`

export const replyAudienceAllowedParams = (actorUserId: string, actorVerified: boolean): unknown[] => [
  actorUserId,
  actorVerified ? 1 : 0,
  actorUserId,
  actorUserId,
  actorUserId,
  actorUserId,
  actorUserId,
  actorUserId,
  actorUserId,
]

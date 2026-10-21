/// <reference types="@cloudflare/workers-types" />

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

export type ReplyAudienceContentContext = {
  contentId: string
  ownerUserId: string
  contentType: 'post'
  state: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'
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
  mentionedUserIdsValue?: unknown,
): Promise<ReplyAudienceRecord> {
  const actorUserId = validateId(actorUserIdValue, true)
  const contentId = validateId(contentIdValue)
  const replyAudience = validateAudience(audienceValue)
  const mentionedUserIds = validateMentionedUserIds(mentionedUserIdsValue)
  const mentionedUserIdsJson = JSON.stringify(mentionedUserIds)

  const target = await db.prepare(
    'SELECT id, owner_user_id, content_type, state FROM contents WHERE id = ? LIMIT 1',
  ).bind(contentId).first<{ id: string; owner_user_id: string | null; content_type: string; state: string }>()

  if (!target || target.content_type !== 'post') {
    throw new ReplyAudienceRuntimeError('NOT_FOUND', 404)
  }
  if (target.owner_user_id !== actorUserId) {
    throw new ReplyAudienceRuntimeError('PERMISSION_DENIED', 403)
  }
  if (!['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(target.state)) {
    throw new ReplyAudienceRuntimeError('INVALID_STATE', 409)
  }

  const now = new Date().toISOString()
  const saved = await db.prepare(
    `INSERT INTO social_content_reply_policies
       (content_id, owner_user_id, audience, mentioned_user_ids_json, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?
       FROM contents content
      WHERE content.id = ?
        AND content.owner_user_id = ?
        AND content.content_type = 'post'
        AND content.state IN ('DRAFT','PUBLISHED','UNPUBLISHED')
     ON CONFLICT(content_id) DO UPDATE SET
       audience = excluded.audience,
       mentioned_user_ids_json = excluded.mentioned_user_ids_json,
       updated_at = excluded.updated_at
     WHERE social_content_reply_policies.owner_user_id = excluded.owner_user_id
     RETURNING content_id, owner_user_id, audience, mentioned_user_ids_json, updated_at`,
  ).bind(contentId, actorUserId, replyAudience, mentionedUserIdsJson, now, now, contentId, actorUserId)
    .first<{ content_id: string; owner_user_id: string; audience: ReplyAudience; mentioned_user_ids_json: string; updated_at: string }>()

  if (!saved) throw new ReplyAudienceRuntimeError('CONFLICT', 409)
  let savedMentions: unknown
  try { savedMentions = JSON.parse(saved.mentioned_user_ids_json) } catch {
    throw new ReplyAudienceRuntimeError('INTERNAL_ERROR', 500)
  }
  if (!Array.isArray(savedMentions) || savedMentions.some((id) => typeof id !== 'string')) {
    throw new ReplyAudienceRuntimeError('INTERNAL_ERROR', 500)
  }
  return {
    contentId: saved.content_id,
    ownerUserId: saved.owner_user_id,
    replyAudience: saved.audience,
    mentionedUserIds: savedMentions as string[],
    updatedAt: saved.updated_at,
  }
}

/** The owner check comes from W03; W05 reads only its own persisted reply policy. */
export async function getContentReplyAudience(
  db: D1Database,
  actorUserIdValue: string,
  contentIdValue: string,
  context: ReplyAudienceContentContext,
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
  const row = await db.prepare(
    `SELECT content_id, owner_user_id, audience, mentioned_user_ids_json, updated_at
       FROM social_content_reply_policies
      WHERE content_id = ? AND owner_user_id = ?
      LIMIT 1`,
  ).bind(contentId, actorUserId).first<{
    content_id: string; owner_user_id: string; audience: ReplyAudience;
    mentioned_user_ids_json: string; updated_at: string
  }>()
  let mentionedUserIds: unknown
  try { mentionedUserIds = JSON.parse(row?.mentioned_user_ids_json ?? '[]') } catch {
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
    updatedAt: row?.updated_at ?? context.updatedAt,
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

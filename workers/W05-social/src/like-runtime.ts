/// <reference types="@cloudflare/workers-types" />

export class LikeRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type LikeTarget = {
  targetType: string
  targetId: string
}

export type LikeResult = {
  relationshipId: string
  actorUserId: string
  targetType: 'content' | 'comment'
  targetId: string
  createdAt: string
}

const RESOURCE_ID_MAX = 128

const validateTarget = (target: LikeTarget): { targetType: 'content' | 'comment'; targetId: string } => {
  if (target.targetType !== 'content' && target.targetType !== 'comment') {
    throw new LikeRuntimeError('VALIDATION_FAILED', 400)
  }
  const targetId = target.targetId?.trim() ?? ''
  if (!targetId || targetId.length > RESOURCE_ID_MAX) {
    throw new LikeRuntimeError('VALIDATION_FAILED', 400)
  }
  return { targetType: target.targetType, targetId }
}

const validateActor = (actorUserId: string): string => {
  const value = actorUserId.trim()
  if (!value || value.length > RESOURCE_ID_MAX) {
    throw new LikeRuntimeError('UNAUTHENTICATED', 401)
  }
  return value
}

export async function like(
  db: D1Database,
  actorUserId: string,
  target: LikeTarget,
): Promise<LikeResult> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)

  const targetRow = targetType === 'content'
    ? await db.prepare(
        `SELECT
           c.id,
           c.state,
           c.owner_user_id,
           EXISTS (
             SELECT 1
             FROM social_user_interactions block
             WHERE block.relation_type = 'block'
               AND (
                 (block.actor_user_id = ? AND block.target_user_id = c.owner_user_id)
                 OR
                 (block.actor_user_id = c.owner_user_id AND block.target_user_id = ?)
               )
           ) AS blocked
           FROM contents c
          WHERE c.id = ?
          LIMIT 1`,
      ).bind(actor, actor, targetId).first<{ id: string; state: string; owner_user_id: string; blocked: number }>()
    : await db.prepare(
        `SELECT
           c.id,
           c.state,
           c.author_user_id,
           content.owner_user_id AS content_owner_user_id,
           EXISTS (
             SELECT 1
             FROM social_user_interactions block
             WHERE block.relation_type = 'block'
               AND (
                 (block.actor_user_id = ? AND block.target_user_id = c.author_user_id)
                 OR
                 (block.actor_user_id = c.author_user_id AND block.target_user_id = ?)
                 OR
                 (block.actor_user_id = ? AND block.target_user_id = content.owner_user_id)
                 OR
                 (block.actor_user_id = content.owner_user_id AND block.target_user_id = ?)
               )
           ) AS blocked
           FROM social_comments c
           JOIN contents content ON content.id = c.content_id
          WHERE c.id = ?
            AND c.state = 'PUBLISHED'
            AND content.state = 'PUBLISHED'
          LIMIT 1`,
      ).bind(actor, actor, actor, actor, targetId).first<{ id: string; state: string; author_user_id: string; content_owner_user_id: string; blocked: number }>()

  if (!targetRow || targetRow.state !== 'PUBLISHED') {
    throw new LikeRuntimeError('NOT_FOUND', 404)
  }

  if (Number(targetRow.blocked) === 1) {
    throw new LikeRuntimeError('RELATIONSHIP_BLOCKED', 409)
  }

  const createdAt = new Date().toISOString()
  const relationshipId = crypto.randomUUID()
  const row = await db.prepare(
    `INSERT INTO interaction_likes
      (relationship_id, actor_user_id, target_type, target_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(actor_user_id, target_type, target_id)
     DO UPDATE SET relationship_id = interaction_likes.relationship_id
     RETURNING relationship_id, actor_user_id, target_type, target_id, created_at`,
  ).bind(relationshipId, actor, targetType, targetId, createdAt)
    .first<{ relationship_id: string; actor_user_id: string; target_type: 'content' | 'comment'; target_id: string; created_at: string }>()

  if (!row) throw new LikeRuntimeError('LIKE_WRITE_FAILED', 500)

  return {
    relationshipId: row.relationship_id,
    actorUserId: row.actor_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  }
}

export async function getLikeStatus(
  db: D1Database,
  actorUserId: string,
  target: LikeTarget,
): Promise<{ liked: boolean; likeCount: number }> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)
  const row = targetType === 'content'
    ? await db.prepare(
        `SELECT
           EXISTS (
             SELECT 1
             FROM interaction_likes il
             WHERE il.actor_user_id = ?
               AND il.target_type = ?
               AND il.target_id = c.id
           ) AS liked,
           (
             SELECT COUNT(*)
             FROM interaction_likes il_count
             WHERE il_count.target_type = ?
               AND il_count.target_id = c.id
           ) AS like_count
           FROM contents c
          WHERE c.id = ? AND c.state = 'PUBLISHED'
          LIMIT 1`,
      ).bind(actor, targetType, targetType, targetId)
        .first<{ liked: number; like_count: number }>()
    : await db.prepare(
        `SELECT
           EXISTS (
             SELECT 1
             FROM interaction_likes il
             WHERE il.actor_user_id = ?
               AND il.target_type = ?
               AND il.target_id = c.id
           ) AS liked,
           (
             SELECT COUNT(*)
             FROM interaction_likes il_count
             WHERE il_count.target_type = ?
               AND il_count.target_id = c.id
           ) AS like_count
           FROM social_comments c
          JOIN contents content ON content.id = c.content_id
          WHERE c.id = ?
            AND c.state = 'PUBLISHED'
            AND content.state = 'PUBLISHED'
          LIMIT 1`,
      ).bind(actor, targetType, targetType, targetId)
        .first<{ liked: number; like_count: number }>()
  return {
    liked: Boolean(row?.liked),
    likeCount: Math.max(0, Number(row?.like_count ?? 0)),
  }
}

export async function unlike(
  db: D1Database,
  actorUserId: string,
  target: LikeTarget,
): Promise<void> {
  const actor = validateActor(actorUserId)
  const { targetType, targetId } = validateTarget(target)
  await db.prepare(
    'DELETE FROM interaction_likes WHERE actor_user_id = ? AND target_type = ? AND target_id = ?',
  ).bind(actor, targetType, targetId).run()
}

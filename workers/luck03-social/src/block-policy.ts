/// <reference types="@cloudflare/workers-types" />

export class BlockPolicyError extends Error {
  constructor(readonly code: string = 'RELATIONSHIP_BLOCKED', readonly status: number = 409) {
    super(code)
  }
}

export async function assertNotBlocked(
  db: D1Database,
  actorUserId: string,
  targetUserId: string,
): Promise<void> {
  if (!actorUserId || !targetUserId || actorUserId === targetUserId) return

  const row = await db.prepare(
    `SELECT 1 AS blocked
       FROM social_user_interactions
      WHERE relation_type = 'block'
        AND (
          (actor_user_id = ? AND target_user_id = ?)
          OR
          (actor_user_id = ? AND target_user_id = ?)
        )
      LIMIT 1`,
  ).bind(actorUserId, targetUserId, targetUserId, actorUserId).first<{ blocked: number }>()

  if (row) throw new BlockPolicyError()
}

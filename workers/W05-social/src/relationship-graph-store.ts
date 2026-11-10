export type RelationshipGraphReadRow = Readonly<{
  following: boolean | number
  followed_by: boolean | number
  relationship_id: string | null
  created_at: string | null
  blocked: boolean | number
  blocked_by: boolean | number
  muted: boolean | number
}>

export interface RelationshipGraphReadStore {
  read(viewerUserId: string, targetUserId: string): Promise<RelationshipGraphReadRow | null>
}

export interface RelationshipGraphD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
    }
  }
}

export class RelationshipGraphStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('RELATIONSHIP_GRAPH_STORE_UNAVAILABLE')
    this.name = 'RelationshipGraphStoreError'
  }
}

/** D1 remains the production adapter until an explicit runtime cutover. */
export function createD1RelationshipGraphReadStore(
  db: RelationshipGraphD1QueryExecutor,
): RelationshipGraphReadStore {
  return {
    async read(viewerUserId, targetUserId) {
      const row = await db.prepare([
        'SELECT',
        '  EXISTS (',
        '    SELECT 1 FROM social_follow_relationships',
        '    WHERE follower_user_id = ? AND target_user_id = ?',
        '  ) AS following,',
        '  EXISTS (',
        '    SELECT 1 FROM social_follow_relationships',
        '    WHERE follower_user_id = ? AND target_user_id = ?',
        '  ) AS followed_by,',
        '  (',
        '    SELECT relationship_id FROM social_follow_relationships',
        '    WHERE follower_user_id = ? AND target_user_id = ? LIMIT 1',
        '  ) AS relationship_id,',
        '  (',
        '    SELECT created_at FROM social_follow_relationships',
        '    WHERE follower_user_id = ? AND target_user_id = ? LIMIT 1',
        '  ) AS created_at,',
        '  EXISTS (',
        "    SELECT 1 FROM social_user_interactions WHERE relation_type = 'block'",
        '      AND actor_user_id = ? AND target_user_id = ?',
        '  ) AS blocked,',
        '  EXISTS (',
        "    SELECT 1 FROM social_user_interactions WHERE relation_type = 'block'",
        '      AND actor_user_id = ? AND target_user_id = ?',
        '  ) AS blocked_by,',
        '  EXISTS (',
        "    SELECT 1 FROM social_user_interactions WHERE relation_type = 'mute'",
        '      AND actor_user_id = ? AND target_user_id = ?',
        '  ) AS muted',
      ].join('\n')).bind(
        viewerUserId, targetUserId,
        targetUserId, viewerUserId,
        viewerUserId, targetUserId,
        viewerUserId, targetUserId,
        viewerUserId, targetUserId,
        targetUserId, viewerUserId,
        viewerUserId, targetUserId,
      ).first<RelationshipGraphReadRow>()
      return row ?? null
    },
  }
}

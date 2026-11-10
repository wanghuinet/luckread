import {
  RelationshipGraphStoreError,
  type RelationshipGraphReadRow,
  type RelationshipGraphReadStore,
} from './relationship-graph-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface RelationshipGraphPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for the read-only W05 relationship graph projection. */
export function createPostgresRelationshipGraphReadStore(
  db: RelationshipGraphPostgresQueryExecutor,
): RelationshipGraphReadStore {
  return {
    async read(viewerUserId, targetUserId) {
      try {
        const result = await db.query<RelationshipGraphReadRow>([
          'SELECT',
          '  EXISTS (',
          '    SELECT 1 FROM social_follow_relationships',
          '    WHERE follower_user_id = $1 AND target_user_id = $2',
          '  ) AS following,',
          '  EXISTS (',
          '    SELECT 1 FROM social_follow_relationships',
          '    WHERE follower_user_id = $2 AND target_user_id = $1',
          '  ) AS followed_by,',
          '  (',
          '    SELECT relationship_id FROM social_follow_relationships',
          '    WHERE follower_user_id = $1 AND target_user_id = $2 LIMIT 1',
          '  ) AS relationship_id,',
          '  (',
          '    SELECT to_char(created_at AT TIME ZONE \'UTC\',',
          '      \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')',
          '    FROM social_follow_relationships',
          '    WHERE follower_user_id = $1 AND target_user_id = $2 LIMIT 1',
          '  ) AS created_at,',
          '  EXISTS (',
          "    SELECT 1 FROM social_user_interactions WHERE relation_type = 'block'",
          '      AND actor_user_id = $1 AND target_user_id = $2',
          '  ) AS blocked,',
          '  EXISTS (',
          "    SELECT 1 FROM social_user_interactions WHERE relation_type = 'block'",
          '      AND actor_user_id = $2 AND target_user_id = $1',
          '  ) AS blocked_by,',
          '  EXISTS (',
          "    SELECT 1 FROM social_user_interactions WHERE relation_type = 'mute'",
          '      AND actor_user_id = $1 AND target_user_id = $2',
          '  ) AS muted',
        ].join('\n'), [viewerUserId, targetUserId])
        return result.rows[0] ?? null
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new RelationshipGraphStoreError()
      }
    },
  }
}

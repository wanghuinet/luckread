import { SocialTargetsReadStoreError } from './social-targets-read-store.js'
import type {
  SocialTargetsReadInput,
  SocialTargetsReadResult,
  SocialTargetsReadStore,
  SocialTargetMentionRow,
  SocialTargetTopicRow,
} from './social-targets-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

export interface SocialTargetsPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for the two bounded W05 social-target point reads. */
export function createPostgresSocialTargetsReadStore(
  db: SocialTargetsPostgresQueryExecutor,
): SocialTargetsReadStore {
  return {
    async getTargets(input: SocialTargetsReadInput): Promise<SocialTargetsReadResult> {
      try {
        const topics = await db.query<SocialTargetTopicRow>(
          `SELECT t.topic_id, t.normalized_name, t.display_name
             FROM social_target_topics st
             JOIN social_topics t ON t.topic_id = st.topic_id
            WHERE st.target_type = $1 AND st.target_id = $2 AND t.status = 'ACTIVE'
            ORDER BY st.created_at ASC
            LIMIT 50`,
          [input.targetType, input.targetId],
        )
        const mentions = await db.query<SocialTargetMentionRow>(
          `SELECT mentioned_user_id, handle
             FROM social_mentions
            WHERE target_type = $1 AND target_id = $2
            ORDER BY created_at ASC
            LIMIT 100`,
          [input.targetType, input.targetId],
        )
        return {
          topics: topics.rows,
          mentions: mentions.rows,
        }
      } catch {
        // Never expose provider diagnostics, SQL text or connection metadata.
        throw new SocialTargetsReadStoreError()
      }
    },
  }
}

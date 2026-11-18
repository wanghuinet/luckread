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
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for the two bounded W05 social-target point reads. */
export function createPostgresSocialTargetsReadStore(
  db: SocialTargetsPostgresQueryExecutor,
): SocialTargetsReadStore {
  return {
    async getContentTargetsBatch(contentIds): Promise<Readonly<Record<string, SocialTargetsReadResult>>> {
      if (contentIds.length === 0) return {}
      if (contentIds.length > 50 || contentIds.some(value => !value.trim() || value.length > 128)) {
        throw new SocialTargetsReadStoreError()
      }
      const uniqueIds = [...new Set(contentIds)]
      try {
        const [topics, mentions] = await Promise.all([
          db.query<SocialTargetTopicRow & { target_id: string }>(
            `WITH ranked AS (
               SELECT st.target_id, t.topic_id, t.normalized_name, t.display_name,
                      ROW_NUMBER() OVER (PARTITION BY st.target_id ORDER BY st.created_at ASC, st.topic_id ASC) AS row_number
                 FROM social_target_topics st
                 JOIN social_topics t ON t.topic_id = st.topic_id
                WHERE st.target_type = 'content' AND st.target_id = ANY($1::text[]) AND t.status = 'ACTIVE'
             )
             SELECT target_id, topic_id, normalized_name, display_name
               FROM ranked WHERE row_number <= 50
              ORDER BY target_id ASC, row_number ASC`,
            [uniqueIds],
          ),
          db.query<SocialTargetMentionRow & { target_id: string }>(
            `WITH ranked AS (
               SELECT target_id, mentioned_user_id, handle,
                      ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY created_at ASC, mention_id ASC) AS row_number
                 FROM social_mentions
                WHERE target_type = 'content' AND target_id = ANY($1::text[])
             )
             SELECT target_id, mentioned_user_id, handle
               FROM ranked WHERE row_number <= 100
              ORDER BY target_id ASC, row_number ASC`,
            [uniqueIds],
          ),
        ])
        const result = Object.fromEntries(uniqueIds.map(contentId => [
          contentId,
          { topics: [] as SocialTargetTopicRow[], mentions: [] as SocialTargetMentionRow[] },
        ])) as Record<string, { topics: SocialTargetTopicRow[]; mentions: SocialTargetMentionRow[] }>
        for (const row of topics.rows) result[row.target_id]?.topics.push({
          topic_id: row.topic_id, normalized_name: row.normalized_name, display_name: row.display_name,
        })
        for (const row of mentions.rows) result[row.target_id]?.mentions.push({
          mentioned_user_id: row.mentioned_user_id, handle: row.handle,
        })
        return result
      } catch {
        throw new SocialTargetsReadStoreError()
      }
    },

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

import {
  SocialTokenSyncStoreError,
  type SocialTokenSyncCommentContext,
  type SocialTokenSyncMentionInput,
  type SocialTokenSyncMentionRow,
  type SocialTokenSyncStore,
  type SocialTokenSyncTargetInput,
  type SocialTokenSyncTopicInput,
} from './social-token-sync-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no database driver is bundled into W05 store code. */
export interface SocialTokenSyncPostgresQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for W05 topic edges and immutable mention identities. */
export function createPostgresSocialTokenSyncStore(
  db: SocialTokenSyncPostgresQueryExecutor,
): SocialTokenSyncStore {
  return {
    async getCommentContext(commentId) {
      try {
        const result = await db.query<SocialTokenSyncCommentContext>(
          `SELECT content_id, author_user_id, state
             FROM social_comments
            WHERE id = $1
            LIMIT 1`,
          [commentId],
        )
        return result.rows[0] ?? null
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },

    async listMentions(targetType, targetId) {
      try {
        const result = await db.query<SocialTokenSyncMentionRow>(
          `SELECT mention_id, mentioned_user_id, handle
             FROM social_mentions
            WHERE target_type = $1 AND target_id = $2`,
          [targetType, targetId],
        )
        return result.rows
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },

    async replaceTargetRelations(input: SocialTokenSyncTargetInput) {
      try {
        await db.query(
          `WITH deleted_topics AS (
             DELETE FROM social_target_topics
              WHERE target_type = $1 AND target_id = $2
             RETURNING relation_id
           ),
           deleted_mentions AS (
             DELETE FROM social_mentions
              WHERE target_type = $1
                AND target_id = $2
                AND mention_id <> ALL($3::text[])
             RETURNING mention_id
           )
           SELECT
             (SELECT COUNT(*)::int FROM deleted_topics) AS deleted_topics,
             (SELECT COUNT(*)::int FROM deleted_mentions) AS deleted_mentions`,
          [input.targetType, input.targetId, [...input.retainedMentionIds]],
        )
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },

    async upsertTopicAndAttach(input: SocialTokenSyncTopicInput) {
      try {
        await db.query(
          `WITH topic AS (
             INSERT INTO social_topics
               (topic_id, normalized_name, display_name, status, created_at, updated_at)
             VALUES ($1, $2, $3, 'ACTIVE', $4::timestamptz, $4::timestamptz)
             ON CONFLICT (normalized_name)
             DO UPDATE SET updated_at = EXCLUDED.updated_at
             RETURNING topic_id
           )
           INSERT INTO social_target_topics
             (relation_id, target_type, target_id, topic_id, token, created_at)
           SELECT $5, $6, $7, topic_id, $8, $4::timestamptz
             FROM topic
           ON CONFLICT DO NOTHING`,
          [
            input.topicId,
            input.normalizedName,
            input.displayName,
            input.now,
            input.relationId,
            input.targetType,
            input.targetId,
            input.token,
          ],
        )
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },

    async insertMention(input: SocialTokenSyncMentionInput) {
      try {
        await db.query(
          `INSERT INTO social_mentions
             (mention_id, target_type, target_id, actor_user_id, mentioned_user_id, handle, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
           ON CONFLICT DO NOTHING`,
          [
            input.mentionId,
            input.targetType,
            input.targetId,
            input.actorUserId,
            input.mentionedUserId,
            input.handle,
            input.now,
          ],
        )
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },
  }
}

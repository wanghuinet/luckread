import type { ReplyAudience } from './reply-audience-runtime.js'
import {
  ReplyAudienceStoreError,
  type ReplyAudienceStore,
  type StoredReplyAudiencePolicy,
  type WriteReplyAudiencePolicy,
} from './reply-audience-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into the W05 Worker. */
export interface ReplyAudiencePostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

type ReplyAudiencePolicyRow = Readonly<{
  content_id: string
  owner_user_id: string
  audience: ReplyAudience
  mentioned_user_ids_json: string
  updated_at: string
}>

const toStoredPolicy = (row: ReplyAudiencePolicyRow | undefined): StoredReplyAudiencePolicy | null =>
  row ? {
    contentId: row.content_id,
    ownerUserId: row.owner_user_id,
    audience: row.audience,
    mentionedUserIdsJson: row.mentioned_user_ids_json,
    updatedAt: row.updated_at,
  } : null

/** PostgreSQL counterpart for W05-owned reply-audience policy persistence. */
export function createPostgresReplyAudienceStore(db: ReplyAudiencePostgresQueryExecutor): ReplyAudienceStore {
  return {
    async set(input: WriteReplyAudiencePolicy) {
      try {
        const result = await db.query<ReplyAudiencePolicyRow>(
          `INSERT INTO social_content_reply_policies
             (content_id, owner_user_id, audience, mentioned_user_ids_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT(content_id) DO UPDATE SET
             audience = EXCLUDED.audience,
             mentioned_user_ids_json = EXCLUDED.mentioned_user_ids_json,
             updated_at = EXCLUDED.updated_at
           WHERE social_content_reply_policies.owner_user_id = EXCLUDED.owner_user_id
           RETURNING content_id, owner_user_id, audience, mentioned_user_ids_json, updated_at`,
          [
            input.contentId, input.ownerUserId, input.audience,
            input.mentionedUserIdsJson, input.now, input.now,
          ],
        )
        return toStoredPolicy(result.rows[0])
      } catch {
        throw new ReplyAudienceStoreError()
      }
    },

    async get(contentId: string, ownerUserId: string) {
      try {
        const result = await db.query<ReplyAudiencePolicyRow>(
          `SELECT content_id, owner_user_id, audience, mentioned_user_ids_json, updated_at
             FROM social_content_reply_policies
            WHERE content_id = $1 AND owner_user_id = $2
            LIMIT 1`,
          [contentId, ownerUserId],
        )
        return toStoredPolicy(result.rows[0])
      } catch {
        throw new ReplyAudienceStoreError()
      }
    },
  }
}

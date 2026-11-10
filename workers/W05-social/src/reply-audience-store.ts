import type { ReplyAudience } from './reply-audience-runtime.js'

export type StoredReplyAudiencePolicy = Readonly<{
  contentId: string
  ownerUserId: string
  audience: ReplyAudience
  mentionedUserIdsJson: string
  updatedAt: string
}>

export type WriteReplyAudiencePolicy = Readonly<{
  contentId: string
  ownerUserId: string
  audience: ReplyAudience
  mentionedUserIdsJson: string
  now: string
}>

export interface ReplyAudienceStore {
  /** Returns null when an existing policy belongs to another owner. */
  set(input: WriteReplyAudiencePolicy): Promise<StoredReplyAudiencePolicy | null>
  get(contentId: string, ownerUserId: string): Promise<StoredReplyAudiencePolicy | null>
}

export class ReplyAudienceStoreError extends Error {
  readonly code = 'INTERNAL_ERROR'
  readonly status = 500

  constructor() {
    super('REPLY_AUDIENCE_STORE_UNAVAILABLE')
    this.name = 'ReplyAudienceStoreError'
  }
}

export interface ReplyAudienceD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
    }
  }
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

/** D1 remains the W05 production default until a separately authorized cutover. */
export function createD1ReplyAudienceStore(db: ReplyAudienceD1QueryExecutor): ReplyAudienceStore {
  return {
    async set(input) {
      try {
        const row = await db.prepare(
          `INSERT INTO social_content_reply_policies
             (content_id, owner_user_id, audience, mentioned_user_ids_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(content_id) DO UPDATE SET
             audience = excluded.audience,
             mentioned_user_ids_json = excluded.mentioned_user_ids_json,
             updated_at = excluded.updated_at
           WHERE social_content_reply_policies.owner_user_id = excluded.owner_user_id
           RETURNING content_id, owner_user_id, audience, mentioned_user_ids_json, updated_at`,
        ).bind(
          input.contentId, input.ownerUserId, input.audience, input.mentionedUserIdsJson, input.now, input.now,
        ).first<ReplyAudiencePolicyRow>()
        return toStoredPolicy(row ?? undefined)
      } catch {
        throw new ReplyAudienceStoreError()
      }
    },

    async get(contentId, ownerUserId) {
      try {
        const row = await db.prepare(
          `SELECT content_id, owner_user_id, audience, mentioned_user_ids_json, updated_at
             FROM social_content_reply_policies
            WHERE content_id = ? AND owner_user_id = ?
            LIMIT 1`,
        ).bind(contentId, ownerUserId).first<ReplyAudiencePolicyRow>()
        return toStoredPolicy(row ?? undefined)
      } catch {
        throw new ReplyAudienceStoreError()
      }
    },
  }
}

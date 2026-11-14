/// <reference types="@cloudflare/workers-types" />

export type SocialTokenSyncTargetType = 'content' | 'comment'

export type SocialTokenSyncCommentContext = Readonly<{
  content_id: string
  author_user_id: string
  state: string
}>

export type SocialTokenSyncMentionRow = Readonly<{
  mention_id: string
  mentioned_user_id: string
  handle: string
}>

export type SocialTokenSyncTopicInput = Readonly<{
  topicId: string
  normalizedName: string
  displayName: string
  targetType: SocialTokenSyncTargetType
  targetId: string
  token: string
  relationId: string
  now: string
}>

export type SocialTokenSyncMentionInput = Readonly<{
  mentionId: string
  targetType: SocialTokenSyncTargetType
  targetId: string
  actorUserId: string
  mentionedUserId: string
  handle: string
  now: string
}>

export type SocialTokenSyncTargetInput = Readonly<{
  targetType: SocialTokenSyncTargetType
  targetId: string
  retainedMentionIds: readonly string[]
}>

export interface SocialTokenSyncStore {
  getCommentContext(commentId: string): Promise<SocialTokenSyncCommentContext | null>
  listMentions(targetType: SocialTokenSyncTargetType, targetId: string): Promise<readonly SocialTokenSyncMentionRow[]>
  replaceTargetRelations(input: SocialTokenSyncTargetInput): Promise<void>
  upsertTopicAndAttach(input: SocialTokenSyncTopicInput): Promise<void>
  insertMention(input: SocialTokenSyncMentionInput): Promise<void>
}

export class SocialTokenSyncStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('SOCIAL_TOKEN_SYNC_STORE_UNAVAILABLE')
    this.name = 'SocialTokenSyncStoreError'
  }
}

export interface SocialTokenSyncD1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      all<T>(): Promise<{ results?: T[] | null }>
      run(): Promise<unknown>
    }
  }
  batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]>
}

/** D1 implementation remains the default until an explicitly configured Neon runtime is used. */
export function createD1SocialTokenSyncStore(db: SocialTokenSyncD1Database): SocialTokenSyncStore {
  return {
    async getCommentContext(commentId) {
      try {
        const row = await db.prepare(
          `SELECT content_id, author_user_id, state
             FROM social_comments
            WHERE id = ?
            LIMIT 1`,
        ).bind(commentId).first<SocialTokenSyncCommentContext>()
        return row ?? null
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },

    async listMentions(targetType, targetId) {
      try {
        const result = await db.prepare(
          `SELECT mention_id, mentioned_user_id, handle
             FROM social_mentions
            WHERE target_type = ? AND target_id = ?`,
        ).bind(targetType, targetId).all<SocialTokenSyncMentionRow>()
        return result.results ?? []
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },

    async replaceTargetRelations(input) {
      const deleteMentions = input.retainedMentionIds.length
        ? db.prepare(
            `DELETE FROM social_mentions
              WHERE target_type = ? AND target_id = ?
                AND mention_id NOT IN (${input.retainedMentionIds.map(() => '?').join(', ')})`,
          ).bind(input.targetType, input.targetId, ...input.retainedMentionIds)
        : db.prepare(
            'DELETE FROM social_mentions WHERE target_type = ? AND target_id = ?',
          ).bind(input.targetType, input.targetId)
      try {
        await db.batch([
          db.prepare('DELETE FROM social_target_topics WHERE target_type = ? AND target_id = ?')
            .bind(input.targetType, input.targetId),
          deleteMentions,
        ])
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },

    async upsertTopicAndAttach(input) {
      try {
        await db.prepare(
          `INSERT INTO social_topics (topic_id, normalized_name, display_name, status, created_at, updated_at)
           VALUES (?, ?, ?, 'ACTIVE', ?, ?)
           ON CONFLICT(normalized_name)
           DO UPDATE SET updated_at = excluded.updated_at`,
        ).bind(input.topicId, input.normalizedName, input.displayName, input.now, input.now).run()
        await db.prepare(
          `INSERT OR IGNORE INTO social_target_topics
            (relation_id, target_type, target_id, topic_id, token, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          input.relationId,
          input.targetType,
          input.targetId,
          input.topicId,
          input.token,
          input.now,
        ).run()
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },

    async insertMention(input) {
      try {
        await db.prepare(
          `INSERT OR IGNORE INTO social_mentions
            (mention_id, target_type, target_id, actor_user_id, mentioned_user_id, handle, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          input.mentionId,
          input.targetType,
          input.targetId,
          input.actorUserId,
          input.mentionedUserId,
          input.handle,
          input.now,
        ).run()
      } catch {
        throw new SocialTokenSyncStoreError()
      }
    },
  }
}

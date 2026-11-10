export type SocialTargetsReadInput = Readonly<{
  targetType: 'content' | 'comment'
  targetId: string
}>

export type SocialTargetTopicRow = Readonly<{
  topic_id: string
  normalized_name: string
  display_name: string
}>

export type SocialTargetMentionRow = Readonly<{
  mentioned_user_id: string
  handle: string
}>

export type SocialTargetsReadResult = Readonly<{
  topics: readonly SocialTargetTopicRow[]
  mentions: readonly SocialTargetMentionRow[]
}>

export interface SocialTargetsReadStore {
  getTargets(input: SocialTargetsReadInput): Promise<SocialTargetsReadResult>
}

export class SocialTargetsReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('SOCIAL_TARGETS_READ_STORE_UNAVAILABLE')
    this.name = 'SocialTargetsReadStoreError'
  }
}

export interface SocialTargetsD1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] | null }>
    }
  }
}

/** D1 remains the production-default adapter for topics and immutable mention identities. */
export function createD1SocialTargetsReadStore(
  db: SocialTargetsD1Database,
): SocialTargetsReadStore {
  return {
    async getTargets(input) {
      const topics = await db.prepare(
        `SELECT t.topic_id, t.normalized_name, t.display_name
           FROM social_target_topics st
           JOIN social_topics t ON t.topic_id = st.topic_id
          WHERE st.target_type = ? AND st.target_id = ? AND t.status = 'ACTIVE'
          ORDER BY st.created_at ASC
          LIMIT 50`,
      ).bind(input.targetType, input.targetId).all<SocialTargetTopicRow>()

      const mentions = await db.prepare(
        `SELECT mentioned_user_id, handle
           FROM social_mentions
          WHERE target_type = ? AND target_id = ?
          ORDER BY created_at ASC
          LIMIT 100`,
      ).bind(input.targetType, input.targetId).all<SocialTargetMentionRow>()

      return {
        topics: topics.results ?? [],
        mentions: mentions.results ?? [],
      }
    },
  }
}

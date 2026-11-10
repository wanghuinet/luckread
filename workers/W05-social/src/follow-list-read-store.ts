export type FollowListDirection = 'followers' | 'following'

export type FollowListCursor = Readonly<{
  createdAt: string
  relationshipId: string
}>

export type FollowListReadInput = Readonly<{
  userId: string
  direction: FollowListDirection
  cursor: FollowListCursor | null
  limit: number
}>

export type FollowListReadRow = Readonly<{
  relationship_id: string
  user_id: string
  followed_at: string
  /** Exact database ordering value for cursor pagination; omitted by D1. */
  cursor_created_at?: string
}>

export type FollowListCountInput = Readonly<{
  userId: string
  direction: FollowListDirection
}>

export interface FollowListReadStore {
  list(input: FollowListReadInput): Promise<readonly FollowListReadRow[]>
  count(input: FollowListCountInput): Promise<number>
}

export interface FollowListD1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] | null }>
      first<T>(): Promise<T | null>
    }
  }
}

/**
 * Production adapter for follower/following list queries. The runtime continues
 * to use this adapter by default; no PostgreSQL transport is wired into W05.
 */
export function createD1FollowListReadStore(db: FollowListD1Database): FollowListReadStore {
  return {
    async list(input) {
      const isFollowers = input.direction === 'followers'
      const relationColumn = isFollowers ? 'target_user_id' : 'follower_user_id'
      const itemColumn = isFollowers ? 'follower_user_id' : 'target_user_id'
      const blockPredicate = `NOT EXISTS (
          SELECT 1
          FROM social_user_interactions block
          WHERE block.relation_type = 'block'
            AND (
              (block.actor_user_id = ? AND block.target_user_id = ${itemColumn})
              OR
              (block.actor_user_id = ${itemColumn} AND block.target_user_id = ?)
            )
        )`
      const where = input.cursor
        ? `WHERE ${relationColumn} = ?
           AND (created_at < ? OR (created_at = ? AND relationship_id < ?))
           AND ${blockPredicate}`
        : `WHERE ${relationColumn} = ?
           AND ${blockPredicate}`
      const statement = `SELECT relationship_id, ${itemColumn} AS user_id, created_at AS followed_at
        FROM social_follow_relationships
        ${where}
        ORDER BY created_at DESC, relationship_id DESC
        LIMIT ?`
      const parameters = input.cursor
        ? [
            input.userId,
            input.cursor.createdAt,
            input.cursor.createdAt,
            input.cursor.relationshipId,
            input.userId,
            input.userId,
            input.limit + 1,
          ]
        : [input.userId, input.userId, input.userId, input.limit + 1]

      const result = await db.prepare(statement)
        .bind(...parameters)
        .all<FollowListReadRow>()
      return result.results ?? []
    },

    async count(input) {
      const isFollowers = input.direction === 'followers'
      const relationColumn = isFollowers ? 'target_user_id' : 'follower_user_id'
      const itemColumn = isFollowers ? 'follower_user_id' : 'target_user_id'
      const blockPredicate = `NOT EXISTS (
          SELECT 1
          FROM social_user_interactions block
          WHERE block.relation_type = 'block'
            AND (
              (block.actor_user_id = ? AND block.target_user_id = rel_count.${itemColumn})
              OR
              (block.actor_user_id = rel_count.${itemColumn} AND block.target_user_id = ?)
            )
        )`
      const statement = `SELECT COUNT(*) AS total_count
        FROM social_follow_relationships rel_count
        WHERE rel_count.${relationColumn} = ?
          AND ${blockPredicate}`
      const row = await db.prepare(statement)
        .bind(input.userId, input.userId, input.userId)
        .first<{ total_count: number }>()
      return Number(row?.total_count ?? 0)
    },
  }
}

export type ContentLikerReadRow = Readonly<{
  relationship_id: string
  actor_user_id: string
  created_at: string
}>

export type ContentLikerReadInput = Readonly<{
  contentId: string
  contentOwnerUserId: string | null
  viewerUserId: string | null
  cursor: Readonly<{ createdAt: string; relationshipId: string }> | null
  /** Includes the extra row used by the runtime to determine hasMore. */
  limit: number
}>

export interface ContentLikerReadStore {
  list(input: ContentLikerReadInput): Promise<readonly ContentLikerReadRow[]>
}

export class ContentLikerReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('CONTENT_LIKER_READ_UNAVAILABLE')
    this.name = 'ContentLikerReadStoreError'
  }
}

export interface ContentLikerD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] | null }>
    }
  }
}

/** D1 remains the production adapter until the separately authorized cutover. */
export function createD1ContentLikerReadStore(
  db: ContentLikerD1QueryExecutor,
): ContentLikerReadStore {
  return {
    async list(input) {
      const params: unknown[] = [
        input.contentId,
        input.contentOwnerUserId,
        input.contentOwnerUserId,
      ]
      let visibility = `
        AND NOT EXISTS (
          SELECT 1
            FROM social_user_interactions content_block
           WHERE content_block.relation_type = 'block'
             AND (
               (content_block.actor_user_id = il.actor_user_id AND content_block.target_user_id = ?)
               OR (content_block.actor_user_id = ? AND content_block.target_user_id = il.actor_user_id)
             )
        )`

      if (input.viewerUserId) {
        visibility += `
        AND NOT EXISTS (
          SELECT 1
            FROM social_user_interactions viewer_block
           WHERE viewer_block.relation_type = 'block'
             AND (
               (viewer_block.actor_user_id = ? AND viewer_block.target_user_id = ?)
               OR (viewer_block.actor_user_id = ? AND viewer_block.target_user_id = ?)
             )
        )
        AND NOT EXISTS (
          SELECT 1
            FROM social_user_interactions liker_block
           WHERE liker_block.relation_type = 'block'
             AND (
               (liker_block.actor_user_id = ? AND liker_block.target_user_id = il.actor_user_id)
               OR (liker_block.actor_user_id = il.actor_user_id AND liker_block.target_user_id = ?)
             )
        )`
        params.push(
          input.viewerUserId,
          input.contentOwnerUserId,
          input.contentOwnerUserId,
          input.viewerUserId,
          input.viewerUserId,
          input.viewerUserId,
        )
      }

      const cursorSql = input.cursor
        ? ' AND (il.created_at < ? OR (il.created_at = ? AND il.relationship_id < ?))'
        : ''
      if (input.cursor) {
        params.push(
          input.cursor.createdAt,
          input.cursor.createdAt,
          input.cursor.relationshipId,
        )
      }
      params.push(input.limit)

      try {
        const result = await db.prepare(`
          SELECT il.relationship_id, il.actor_user_id, il.created_at
            FROM interaction_likes il
           WHERE il.target_type = 'content'
             AND il.target_id = ?
             ${visibility}
             ${cursorSql}
           ORDER BY il.created_at DESC, il.relationship_id DESC
           LIMIT ?
        `).bind(...params).all<ContentLikerReadRow>()
        return result.results ?? []
      } catch {
        throw new ContentLikerReadStoreError()
      }
    },
  }
}

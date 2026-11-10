import {
  ContentLikerReadStoreError,
  type ContentLikerReadInput,
  type ContentLikerReadRow,
  type ContentLikerReadStore,
} from './like-list-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface ContentLikerPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for the bounded content-liker page. */
export function createPostgresContentLikerReadStore(
  db: ContentLikerPostgresQueryExecutor,
): ContentLikerReadStore {
  return {
    async list(input: ContentLikerReadInput) {
      const values: unknown[] = [input.contentId, input.contentOwnerUserId, input.contentOwnerUserId]
      const visibilityLines = [
        'AND NOT EXISTS (',
        '  SELECT 1 FROM social_user_interactions content_block',
        "   WHERE content_block.relation_type = 'block'",
        '     AND ((content_block.actor_user_id = il.actor_user_id AND content_block.target_user_id = $2)',
        '       OR (content_block.actor_user_id = $3 AND content_block.target_user_id = il.actor_user_id))',
        ')',
      ]

      if (input.viewerUserId) {
        const start = values.length + 1
        const likerStart = start + 4
        visibilityLines.push(
          'AND NOT EXISTS (',
          '  SELECT 1 FROM social_user_interactions viewer_block',
          "   WHERE viewer_block.relation_type = 'block'",
          '     AND ((viewer_block.actor_user_id = $' + start + ' AND viewer_block.target_user_id = $' + (start + 1) + ')',
          '       OR (viewer_block.actor_user_id = $' + (start + 2) + ' AND viewer_block.target_user_id = $' + (start + 3) + '))',
          ')',
          'AND NOT EXISTS (',
          '  SELECT 1 FROM social_user_interactions liker_block',
          "   WHERE liker_block.relation_type = 'block'",
          '     AND ((liker_block.actor_user_id = $' + likerStart + ' AND liker_block.target_user_id = il.actor_user_id)',
          '       OR (liker_block.actor_user_id = il.actor_user_id AND liker_block.target_user_id = $' + (likerStart + 1) + '))',
          ')',
        )
        values.push(input.viewerUserId, input.contentOwnerUserId, input.contentOwnerUserId, input.viewerUserId, input.viewerUserId, input.viewerUserId)
      }

      let cursorSql = ''
      if (input.cursor) {
        const timestampParameter = values.length + 1
        const relationshipParameter = timestampParameter + 1
        cursorSql = 'AND (il.created_at < $' + timestampParameter + '::timestamptz OR (il.created_at = $' + timestampParameter + '::timestamptz AND il.relationship_id < $' + relationshipParameter + '))'
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const sql = [
        'SELECT il.relationship_id, il.actor_user_id,',
        "       to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS created_at",
        '  FROM interaction_likes il',
        " WHERE il.target_type = 'content' AND il.target_id = $1",
        ...visibilityLines,
        cursorSql,
        ' ORDER BY il.created_at DESC, il.relationship_id DESC',
        ' LIMIT $' + values.length,
      ].filter(Boolean).join('\\n')

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}

import {
  ContentRuntimeError,
} from './content-runtime.js'
import {
  MAX_POST_THREAD_ITEMS,
  type PostThreadReadRow,
  type PostThreadReadStore,
} from './content-relationships.js'

export interface PostThreadReadPostgresQueryExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

type PostThreadQueryRow = Omit<PostThreadReadRow, 'created_at'> & {
  created_at: string | Date
}

function timestampString(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
}

/**
 * PostgreSQL equivalent of the native W03 thread read. The same-owner joins,
 * published-public rule, owner-only draft exception, cycle guard and 50-item
 * bound are retained. Thread writes remain on D1.
 */
export function createPostgresPostThreadReadStore(
  database: PostThreadReadPostgresQueryExecutor,
): PostThreadReadStore {
  return {
    async list(contentId, viewerUserId, maxItems) {
      if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > MAX_POST_THREAD_ITEMS) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }

      const sql = `WITH RECURSIVE
        ancestors(id, owner_user_id, depth, visited) AS (
          SELECT id, owner_user_id, 0, '|' || id || '|' FROM contents WHERE id = $1
          UNION ALL
          SELECT r.source_id, a.owner_user_id, a.depth + 1, a.visited || r.source_id || '|'
            FROM ancestors a
            JOIN content_relationships r
              ON r.target_id = a.id
             AND r.relation_type = 'thread-next'
             AND r.status = 'ACTIVE'
            JOIN contents previous_content
              ON previous_content.id = r.source_id
             AND previous_content.owner_user_id = a.owner_user_id
           WHERE a.depth < $2
             AND STRPOS(a.visited, '|' || r.source_id || '|') = 0
        ),
        root(id, owner_user_id) AS (
          SELECT id, owner_user_id FROM ancestors ORDER BY depth DESC LIMIT 1
        ),
        thread(id, owner_user_id, position, visited) AS (
          SELECT root.id, root.owner_user_id, 0, '|' || root.id || '|'
            FROM root
            JOIN contents root_content ON root_content.id = root.id
           WHERE (
             (root_content.state = 'PUBLISHED' AND root_content.access_mode = 'PUBLIC')
             OR ($3::text IS NOT NULL AND root.owner_user_id = $4::text AND root_content.state IN ('DRAFT', 'PUBLISHED'))
           )
          UNION ALL
          SELECT r.target_id, t.owner_user_id, t.position + 1, t.visited || r.target_id || '|'
            FROM thread t
            JOIN content_relationships r
              ON r.source_id = t.id
             AND r.relation_type = 'thread-next'
             AND r.status = 'ACTIVE'
            JOIN contents next_content
              ON next_content.id = r.target_id
             AND next_content.owner_user_id = t.owner_user_id
           WHERE t.position + 1 < $5
             AND STRPOS(t.visited, '|' || r.target_id || '|') = 0
             AND (
               (next_content.state = 'PUBLISHED' AND next_content.access_mode = 'PUBLIC')
               OR ($6::text IS NOT NULL AND t.owner_user_id = $7::text AND next_content.state IN ('DRAFT', 'PUBLISHED'))
             )
        )
      SELECT
        c.id, c.slug, t.position, c.state, c.access_mode, c.title,
        c.body_ref, c.media_refs_json, c.cover_ref, c.created_at
        FROM thread t
        JOIN contents c ON c.id = t.id
       ORDER BY t.position ASC`

      try {
        const result = await database.query<PostThreadQueryRow>(sql, [
          contentId,
          maxItems,
          viewerUserId,
          viewerUserId,
          maxItems,
          viewerUserId,
          viewerUserId,
        ])
        return result.rows.map((row) => ({
          ...row,
          created_at: timestampString(row.created_at),
        }))
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}

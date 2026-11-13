import {
  ContentRuntimeError,
  type ContentRow,
  type PublishedContentsByIdsReadStore,
} from './content-runtime.js'

export interface PublishedContentsByIdsPostgresQueryExecutor {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>
}

/**
 * PostgreSQL equivalent of D1's json_each bookmark projection query.
 * WITH ORDINALITY preserves the exact bookmark order supplied by W01.
 */
export function createPostgresPublishedContentsByIdsReadStore(
  database: PublishedContentsByIdsPostgresQueryExecutor,
): PublishedContentsByIdsReadStore {
  return {
    async list(rawContentIds) {
      const contentIds = [...new Set(rawContentIds)]
      if (contentIds.length === 0) return []

      const sql = [
        'SELECT c.id, c.content_type, c.owner_user_id, c.creator_id, c.ip_id, c.state,',
        '       c.scheduled_at, c.access_mode, c.version, c.revision, c.slug, c.title, c.body_ref,',
        '       c.media_refs_json, c.cover_ref, c.media_warning, c.etag, c.created_at, c.updated_at',
        '  FROM unnest($1::text[]) WITH ORDINALITY AS requested(id, ordinality)',
        '  INNER JOIN contents AS c ON c.id = requested.id',
        " WHERE c.state = 'PUBLISHED'",
        ' ORDER BY requested.ordinality ASC',
        ' LIMIT $2',
      ].join('\n')

      try {
        const result = await database.query(sql, [contentIds, contentIds.length])
        return result.rows as unknown as ContentRow[]
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}

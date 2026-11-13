import {
  ContentRuntimeError,
  type ContentRow,
  type FollowingOwnerContentsCursor,
  type FollowingOwnerContentsReadStore,
} from './content-runtime.js'

export interface FollowingOwnerContentsPostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_CONTENT_TIMESTAMP_INVALID')
}

const nullableTimestampString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  return timestampString(value)
}

/**
 * PostgreSQL equivalent of W03's D1 JSON1 following-feed projection.
 * The authorized owner set comes from W04; this store never reads social tables.
 */
export function createPostgresFollowingOwnerContentsReadStore(
  database: FollowingOwnerContentsPostgresQueryExecutor,
): FollowingOwnerContentsReadStore {
  return {
    async list(rawOwnerIds, cursor, limit) {
      const ownerIds = [...new Set(rawOwnerIds)]
      if (ownerIds.length === 0) return []
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 51) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }

      const sql = [
        'SELECT c.id, c.content_type, c.owner_user_id, c.creator_id, c.ip_id, c.state,',
        '       c.scheduled_at, c.access_mode, c.version, c.revision, c.slug, c.title, c.body_ref,',
        '       c.media_refs_json, c.cover_ref, c.media_warning, c.etag, c.created_at, c.updated_at',
        '  FROM contents AS c',
        " WHERE c.state = 'PUBLISHED'",
        '   AND c.owner_user_id = ANY($1::text[])',
        '   AND (',
        '     $2::timestamptz IS NULL',
        '     OR (c.created_at, c.id) < ($2::timestamptz, $3::text)',
        '   )',
        ' ORDER BY c.created_at DESC, c.id DESC',
        ' LIMIT $4',
      ].join('\\n')

      try {
        const result = await database.query<Record<string, unknown>>(sql, [
          ownerIds,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          limit,
        ])
        return result.rows.map((row) => ({
          ...row,
          scheduled_at: nullableTimestampString(row.scheduled_at),
          created_at: timestampString(row.created_at),
          updated_at: timestampString(row.updated_at),
        })) as unknown as ContentRow[]
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}

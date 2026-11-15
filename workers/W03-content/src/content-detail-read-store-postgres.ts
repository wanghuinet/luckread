import { ContentRuntimeError } from './content-runtime.js'
import type {
  ContentDetailReadStore,
  ContentRow,
} from './content-runtime.js'

export interface ContentDetailPostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

interface PostgresContentDetailRow extends Omit<ContentRow, 'scheduled_at' | 'created_at' | 'updated_at'> {
  scheduled_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_CONTENT_TIMESTAMP_INVALID')
}

const toContentRow = (row: PostgresContentDetailRow): ContentRow => ({
  ...row,
  scheduled_at: row.scheduled_at === null ? null : timestampString(row.scheduled_at),
  created_at: timestampString(row.created_at),
  updated_at: timestampString(row.updated_at),
})

/**
 * Canonical detail lookup for published content and the current owner's
 * unpublished content. The service applies W07 membership authorization after
 * this read; this adapter never evaluates or bypasses entitlement rules.
 */
export function createPostgresContentDetailReadStore(
  database: ContentDetailPostgresQueryExecutor,
): ContentDetailReadStore {
  return {
    async getContent(contentIdOrSlug, principalUserId) {
      try {
        const result = await database.query<PostgresContentDetailRow>(
          'SELECT id, content_type, owner_user_id, creator_id, ip_id, state, scheduled_at, access_mode, version, revision, ' +
          'slug, title, body_ref, media_refs_json, cover_ref, media_warning, etag, created_at, updated_at ' +
          'FROM contents ' +
          'WHERE (id = $1 OR slug = $1) ' +
          "AND (state = 'PUBLISHED' OR owner_user_id = $2) " +
          'LIMIT 1',
          [contentIdOrSlug, principalUserId ?? ''],
        )
        return result.rows[0] ? toContentRow(result.rows[0]) : null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}

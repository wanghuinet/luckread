import { ContentRuntimeError } from './content-runtime.js'
import type {
  ContentRow,
  CreatorContentsCursor,
  CreatorContentsFilters,
  CreatorContentsReadStore,
} from './content-runtime.js'

export interface CreatorContentsPostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

interface PostgresCreatorContentRow extends Omit<
  ContentRow,
  'scheduled_at' | 'created_at' | 'updated_at'
> {
  scheduled_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_CREATOR_CONTENT_TIMESTAMP_INVALID')
}

const nullableTimestampString = (value: unknown): string | null =>
  value === null || value === undefined ? null : timestampString(value)

const toContentRow = (row: PostgresCreatorContentRow): ContentRow => ({
  ...row,
  scheduled_at: nullableTimestampString(row.scheduled_at),
  created_at: timestampString(row.created_at),
  updated_at: timestampString(row.updated_at),
})

/**
 * PostgreSQL equivalent of the owner-scoped D1 creator-content list.
 * Cursor decoding/encoding remains in content-runtime.ts and every mutation
 * stays on D1. The SQL uses parameterized keyset pagination over the existing
 * contents_owner_updated_at_id_idx index.
 */
export function createPostgresCreatorContentsReadStore(
  database: CreatorContentsPostgresQueryExecutor,
): CreatorContentsReadStore {
  return {
    async list(
      ownerUserId: string,
      cursor: CreatorContentsCursor | null,
      limit: number,
      filters: CreatorContentsFilters,
    ): Promise<readonly ContentRow[]> {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(ownerUserId)) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 51) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }

      const conditions = ['owner_user_id = $1']
      const values: unknown[] = [ownerUserId]

      if (filters.status) {
        values.push(filters.status)
        conditions.push(`state = $${values.length}`)
      }
      if (filters.contentType) {
        values.push(filters.contentType)
        conditions.push(`content_type = $${values.length}`)
      }
      if (cursor) {
        values.push(cursor.updatedAt, cursor.id)
        conditions.push(
          `(updated_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::text)`,
        )
      }
      values.push(limit)

      const sql = [
        'SELECT id, content_type, owner_user_id, creator_id, ip_id, state, scheduled_at,',
        '       access_mode, version, revision, slug, title, body_ref, media_refs_json,',
        '       cover_ref, media_warning, etag, created_at, updated_at',
        '  FROM contents',
        ` WHERE ${conditions.join(' AND ')}`,
        ' ORDER BY updated_at DESC, id DESC',
        ` LIMIT $${values.length}`,
      ].join('\n')

      try {
        const result = await database.query<PostgresCreatorContentRow>(sql, values)
        return result.rows.map(toContentRow)
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}

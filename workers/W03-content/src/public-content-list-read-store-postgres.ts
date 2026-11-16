import {
  ContentRuntimeError,
  type ContentRow,
  type ContentType,
  type PublicContentKeysetCursor,
  type PublicContentListReadStore,
} from './content-runtime.js'

export interface PublicContentListPostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

interface PostgresPublicContentRow extends Omit<
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
  throw new Error('W03_POSTGRES_PUBLIC_CONTENT_TIMESTAMP_INVALID')
}

const nullableTimestampString = (value: unknown): string | null =>
  value === null || value === undefined ? null : timestampString(value)

const toContentRow = (row: PostgresPublicContentRow): ContentRow => ({
  ...row,
  scheduled_at: nullableTimestampString(row.scheduled_at),
  created_at: timestampString(row.created_at),
  updated_at: timestampString(row.updated_at),
})

const contentColumns = [
  'id, content_type, owner_user_id, creator_id, ip_id, state, scheduled_at,',
  'access_mode, version, revision, slug, title, body_ref, media_refs_json,',
  'cover_ref, media_warning, etag, created_at, updated_at',
].join('\n       ')

const validateLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 51) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
}

const validateCursor = (cursor: PublicContentKeysetCursor | null): void => {
  if (cursor && (
    !Number.isFinite(Date.parse(cursor.createdAt)) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(cursor.id)
  )) {
    throw new ContentRuntimeError('INVALID_CURSOR', 400)
  }
}

/** PostgreSQL read adapter for the published public list and normalized metadata search. */
export function createPostgresPublicContentListReadStore(
  database: PublicContentListPostgresQueryExecutor,
): PublicContentListReadStore {
  return {
    async list(input) {
      validateLimit(input.limit)
      validateCursor(input.cursor)
      const conditions = ["state = 'PUBLISHED'"]
      const values: unknown[] = []

      if (input.creatorId) {
        values.push(input.creatorId)
        conditions.push(`creator_id = $${values.length}`)
      }
      if (input.ownerUserId) {
        values.push(input.ownerUserId)
        conditions.push(`owner_user_id = $${values.length}`)
      }
      if (input.contentType) {
        values.push(input.contentType)
        conditions.push(`content_type = $${values.length}`)
      }
      if (input.cursor) {
        values.push(input.cursor.createdAt, input.cursor.id)
        conditions.push(`(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::text)`)
      }
      values.push(input.limit)

      const sql = [
        `SELECT ${contentColumns}`,
        '  FROM contents',
        ` WHERE ${conditions.join(' AND ')}`,
        ' ORDER BY created_at DESC, id DESC',
        ` LIMIT $${values.length}`,
      ].join('\n')

      try {
        const result = await database.query<PostgresPublicContentRow>(sql, values)
        return result.rows.map(toContentRow)
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async search(input) {
      validateLimit(input.limit)
      validateCursor(input.cursor)
      const query = input.query.normalize('NFKC').trim()
      if (!query || query.length > 256) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }

      const values: unknown[] = [query]
      const conditions = [
        "state = 'PUBLISHED'",
        '(strpos(lower(title), lower($1)) > 0 OR strpos(lower(slug), lower($1)) > 0)',
      ]
      if (input.cursor) {
        values.push(input.cursor.createdAt, input.cursor.id)
        conditions.push(`(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::text)`)
      }
      values.push(input.limit)

      const sql = [
        `SELECT ${contentColumns}`,
        '  FROM contents',
        ` WHERE ${conditions.join(' AND ')}`,
        ' ORDER BY created_at DESC, id DESC',
        ` LIMIT $${values.length}`,
      ].join('\n')

      try {
        const result = await database.query<PostgresPublicContentRow>(sql, values)
        return result.rows.map(toContentRow)
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}

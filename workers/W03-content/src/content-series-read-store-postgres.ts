import { ContentRuntimeError } from './content-runtime.js'
import type {
  SeriesListCursor,
  SeriesReadStore,
  SeriesRecord,
} from './content-series.js'

export interface SeriesPostgresQueryExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

interface SeriesRow {
  id: string
  owner_user_id: string
  creator_id: string
  ip_id: string | null
  state: SeriesRecord['state']
  version: number
  title: string
  description: string
  cover_ref: string | null
  etag: string
  created_at: Date | string
  updated_at: Date | string
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_SERIES_TIMESTAMP_INVALID')
}

const toSeriesRecord = (row: SeriesRow): SeriesRecord => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  creatorId: row.creator_id,
  ipId: row.ip_id,
  state: row.state,
  version: row.version,
  title: row.title,
  description: row.description,
  coverRef: row.cover_ref,
  etag: row.etag,
  createdAt: timestampString(row.created_at),
  updatedAt: timestampString(row.updated_at),
})

/**
 * PostgreSQL equivalent of creator-owned series reads. Series writes remain
 * on D1 until separately admitted; owner checks and cursor scoping remain in
 * content-series.ts.
 */
export function createPostgresSeriesReadStore(
  database: SeriesPostgresQueryExecutor,
): SeriesReadStore {
  return {
    async getSeries(ownerUserId, seriesId) {
      try {
        const result = await database.query<SeriesRow>(
          'SELECT id, owner_user_id, creator_id, ip_id, state, version, title, description, ' +
          'cover_ref, etag, created_at, updated_at FROM content_series WHERE owner_user_id = $1 AND id = $2 LIMIT 1',
          [ownerUserId, seriesId],
        )
        return result.rows[0] ? toSeriesRecord(result.rows[0]) : null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async listCreatorSeries(ownerUserId, cursor: SeriesListCursor | null, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 51) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }
      const sql = [
        'SELECT id, owner_user_id, creator_id, ip_id, state, version, title, description,',
        '       cover_ref, etag, created_at, updated_at',
        '  FROM content_series',
        ' WHERE owner_user_id = $1',
        '   AND ($2::timestamptz IS NULL OR (updated_at, id) < ($2::timestamptz, $3::text))',
        ' ORDER BY updated_at DESC, id DESC',
        ' LIMIT $4',
      ].join('\n')
      try {
        const result = await database.query<SeriesRow>(sql, [
          ownerUserId,
          cursor?.updatedAt ?? null,
          cursor?.id ?? null,
          limit,
        ])
        return result.rows.map(toSeriesRecord)
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}

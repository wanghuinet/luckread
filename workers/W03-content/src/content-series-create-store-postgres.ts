import { ContentRuntimeError } from './content-runtime.js'
import type { IdempotencyRow, SeriesCreateStore, SeriesRecord } from './content-series.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

interface SeriesCreatePostgresClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

export interface SeriesCreatePostgresDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect(): Promise<SeriesCreatePostgresClient>
}

interface PostgresIdempotencyRow extends Omit<IdempotencyRow, 'expires_at'> {
  expires_at: Date | string
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_SERIES_TIMESTAMP_INVALID')
}

const postgresError = (error: unknown): { code?: string; constraint?: string } => {
  if (!error || typeof error !== 'object') return {}
  const value = error as { code?: unknown; constraint?: unknown }
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    constraint: typeof value.constraint === 'string' ? value.constraint : undefined,
  }
}

/** Neon writer for creator-owned Series creation only. */
export function createPostgresSeriesCreateStore(
  database: SeriesCreatePostgresDatabase,
): SeriesCreateStore {
  return {
    async loadIdempotency(ownerUserId, operationId, idempotencyKey): Promise<IdempotencyRow | null> {
      try {
        const result = await database.query<PostgresIdempotencyRow>(
          'SELECT id, owner_user_id, request_hash, status, response_status, response_json, expires_at ' +
          'FROM content_mutation_idempotency ' +
          'WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 ' +
          'ORDER BY created_at DESC LIMIT 1',
          [ownerUserId, operationId, idempotencyKey],
        )
        const row = result.rows[0]
        if (!row) return null
        return { ...row, expires_at: timestampString(row.expires_at) }
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async create(input) {
      let client: SeriesCreatePostgresClient | undefined
      let transactionOpen = false
      try {
        client = await database.connect()
        await client.query('BEGIN')
        transactionOpen = true

        await client.query(
          'DELETE FROM content_mutation_idempotency ' +
          'WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 AND expires_at <= $4::timestamptz',
          [input.ownerUserId, input.operationId, input.idempotencyKey, input.createdAt],
        )
        await client.query(
          'INSERT INTO content_mutation_idempotency ' +
          '(id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at) ' +
          "VALUES ($1, $2, $3, $4, $5, 'COMPLETED', 201, $6, $7::timestamptz, $8::timestamptz)",
          [
            crypto.randomUUID(),
            input.ownerUserId,
            input.operationId,
            input.idempotencyKey,
            input.requestHash,
            input.responseJson,
            input.createdAt,
            input.expiresAt,
          ],
        )

        const series: SeriesRecord = input.series
        await client.query(
          'INSERT INTO content_series ' +
          '(id, owner_user_id, creator_id, ip_id, state, version, title, description, cover_ref, etag, created_at, updated_at) ' +
          "VALUES ($1, $2, $3, $4, 'DRAFT', 1, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)",
          [
            series.id,
            series.ownerUserId,
            series.creatorId,
            series.ipId,
            series.title,
            series.description,
            series.coverRef,
            series.etag,
            series.createdAt,
            series.updatedAt,
          ],
        )

        // The existing PostgreSQL trigger emits series.created before commit.
        await client.query('COMMIT')
        transactionOpen = false
      } catch (error) {
        if (transactionOpen && client) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // Preserve the original failure; transaction cleanup is best effort.
          }
        }
        const failure = postgresError(error)
        if (failure.code === '23505' &&
            failure.constraint?.includes('content_mutation_idempotency')) {
          throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
        }
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      } finally {
        client?.release()
      }
    },
  }
}

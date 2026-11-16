import { ContentRuntimeError } from './content-runtime.js'
import type {
  ContentCreateStore,
  ContentRecord,
  ContentRevision,
  IdempotencyRow,
} from './content-runtime.js'
import {
  CONTENT_SNOWFLAKE_EPOCH_MS,
  encodeContentSnowflakeId,
} from './content-snowflake-id.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

interface ContentCreatePostgresClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

export interface ContentCreatePostgresDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect(): Promise<ContentCreatePostgresClient>
}

interface PostgresIdempotencyRow extends Omit<IdempotencyRow, 'idem_expires_at'> {
  idem_expires_at: Date | string | null
}

interface SnowflakeStateRow {
  last_timestamp_ms: string | number
  sequence: string | number
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_CONTENT_IDEMPOTENCY_TIMESTAMP_INVALID')
}

const postgresError = (error: unknown): { code?: string; constraint?: string } => {
  if (!error || typeof error !== 'object') return {}
  const value = error as { code?: unknown; constraint?: unknown }
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    constraint: typeof value.constraint === 'string' ? value.constraint : undefined,
  }
}

const mapIdempotencyRow = (row: PostgresIdempotencyRow): IdempotencyRow => ({
  ...row,
  idem_expires_at: row.idem_expires_at === null ? null : timestampString(row.idem_expires_at),
})

/**
 * Neon writer for the canonical W03 content-create operation.
 * The shared Snowflake allocator is PostgreSQL-backed and each created
 * content row, revision, idempotency record and trigger-produced outbox event
 * commits atomically in D1-02 / luckreadpro.
 */
export function createPostgresContentCreateStore(
  database: ContentCreatePostgresDatabase,
): ContentCreateStore {
  return {
    async loadIdempotency(ownerUserId, operationId, idempotencyKey) {
      try {
        const result = await database.query<PostgresIdempotencyRow>(
          'SELECT id AS idem_id, owner_user_id AS idem_owner_user_id, ' +
          'request_hash AS idem_request_hash, status AS idem_status, ' +
          'response_status AS idem_response_status, response_json AS idem_response_json, ' +
          'expires_at AS idem_expires_at ' +
          'FROM content_mutation_idempotency ' +
          'WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 ' +
          'ORDER BY created_at DESC LIMIT 1',
          [ownerUserId, operationId, idempotencyKey],
        )
        const row = result.rows[0]
        return row ? mapIdempotencyRow(row) : null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async allocateContentId(nowMs) {
      if (!Number.isSafeInteger(nowMs) || nowMs < CONTENT_SNOWFLAKE_EPOCH_MS) {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
      try {
        const result = await database.query<SnowflakeStateRow>(
          'UPDATE content_id_snowflake_state ' +
          'SET sequence = CASE WHEN $1::bigint > last_timestamp_ms THEN 0 ELSE sequence + 1 END, ' +
          'last_timestamp_ms = GREATEST(last_timestamp_ms, $1::bigint) ' +
          'WHERE id = 1 AND ($1::bigint > last_timestamp_ms OR sequence < 4095) ' +
          'RETURNING last_timestamp_ms, sequence',
          [nowMs],
        )
        const row = result.rows[0]
        const timestampMs = Number(row?.last_timestamp_ms)
        const sequence = Number(row?.sequence)
        if (!row || !Number.isSafeInteger(timestampMs) || !Number.isInteger(sequence) ||
            sequence < 0 || sequence > 4095) {
          throw new Error('W03_POSTGRES_CONTENT_SNOWFLAKE_SEQUENCE_EXHAUSTED')
        }
        return encodeContentSnowflakeId(timestampMs, sequence)
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async create(input) {
      let client: ContentCreatePostgresClient | undefined
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

        const content: ContentRecord = input.content
        await client.query(
          'INSERT INTO contents ' +
          '(id, content_type, owner_user_id, creator_id, ip_id, state, scheduled_at, access_mode, version, revision, slug, title, body_ref, media_refs_json, cover_ref, media_warning, etag, created_at, updated_at) ' +
          "VALUES ($1, $2, $3, $4, NULL, 'DRAFT', NULL, $5, 1, 1, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14::timestamptz)",
          [
            content.id,
            content.contentType,
            content.ownerUserId,
            content.creatorId,
            content.accessMode ?? 'PUBLIC',
            content.slug,
            content.title,
            content.bodyRef,
            JSON.stringify(content.mediaRefs),
            content.coverRef,
            content.mediaWarning ?? null,
            content.etag,
            content.createdAt,
            content.updatedAt,
          ],
        )

        const revision: ContentRevision = input.revision
        await client.query(
          'INSERT INTO content_revisions ' +
          '(id, content_id, revision, content_version, actor_user_id, source_revision, operation, state, access_mode, slug, title, body_ref, media_refs_json, cover_ref, media_warning, etag, reason, correlation_id, created_at) ' +
          "VALUES ($1, $2, 1, 1, $3, NULL, 'CREATE', 'DRAFT', $4, $5, $6, $7, $8, $9, $10, $11, NULL, $12, $13::timestamptz)",
          [
            revision.id,
            revision.contentId,
            revision.actorUserId,
            revision.accessMode ?? 'PUBLIC',
            revision.slug,
            revision.title,
            revision.bodyRef,
            JSON.stringify(revision.mediaRefs),
            revision.coverRef,
            revision.mediaWarning ?? null,
            revision.etag,
            revision.correlationId,
            revision.createdAt,
          ],
        )

        // The contents_after_insert_outbox trigger appends content.created
        // within this same transaction before the commit.
        await client.query('COMMIT')
        transactionOpen = false
      } catch (error) {
        if (transactionOpen && client) {
          try { await client.query('ROLLBACK') } catch { /* Preserve original failure. */ }
        }
        const failure = postgresError(error)
        if (failure.code === '23505' &&
            failure.constraint?.includes('content_mutation_idempotency')) {
          throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
        }
        if (failure.code === '23505' && failure.constraint?.includes('contents_slug')) {
          throw new ContentRuntimeError('CONFLICT', 409)
        }
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      } finally {
        client?.release()
      }
    },
  }
}

import { ContentRuntimeError } from './content-runtime.js'
import type {
  CollectionMutationSnapshot,
  CollectionRecord,
  CollectionUpdateStore,
  IdempotencyRow,
} from './content-collections.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

interface CollectionUpdatePostgresClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

export interface CollectionUpdatePostgresDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect(): Promise<CollectionUpdatePostgresClient>
}

interface PostgresMutationRow {
  id: string
  owner_user_id: string
  creator_id: string
  state: CollectionRecord['state']
  version: number
  title: string
  description: string
  cover_ref: string | null
  etag: string
  created_at: Date | string
  updated_at: Date | string
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: IdempotencyRow['status'] | null
  idem_response_status: number | null
  idem_response_json: string | null
  idem_expires_at: Date | string | null
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_COLLECTION_TIMESTAMP_INVALID')
}

const postgresError = (error: unknown): { code?: string; constraint?: string } => {
  if (!error || typeof error !== 'object') return {}
  const value = error as { code?: unknown; constraint?: unknown }
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    constraint: typeof value.constraint === 'string' ? value.constraint : undefined,
  }
}

const toCollection = (row: PostgresMutationRow): CollectionRecord => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  creatorId: row.creator_id,
  state: row.state,
  version: row.version,
  title: row.title,
  description: row.description,
  coverRef: row.cover_ref,
  etag: row.etag,
  createdAt: timestampString(row.created_at),
  updatedAt: timestampString(row.updated_at),
})

const toIdempotency = (
  row: PostgresMutationRow,
  ownerUserId: string,
): IdempotencyRow | null => {
  if (!row.idem_id || !row.idem_expires_at) return null
  return {
    id: row.idem_id,
    owner_user_id: row.idem_owner_user_id ?? ownerUserId,
    request_hash: row.idem_request_hash ?? '',
    status: row.idem_status ?? 'COMPLETED',
    response_status: row.idem_response_status,
    response_json: row.idem_response_json,
    expires_at: timestampString(row.idem_expires_at),
  }
}

/**
 * Neon writer for Collection updates only.
 * The owner-scoped snapshot is read before mutation; UPDATE then checks the
 * original version and ETag again inside the transaction before committing.
 * The existing PostgreSQL trigger writes collection.updated to the outbox.
 */
export function createPostgresCollectionUpdateStore(
  database: CollectionUpdatePostgresDatabase,
): CollectionUpdateStore {
  return {
    async loadMutation(
      ownerUserId,
      collectionId,
      operationId,
      idempotencyKey,
    ): Promise<CollectionMutationSnapshot> {
      try {
        const result = await database.query<PostgresMutationRow>(
          'SELECT s.id, s.owner_user_id, s.creator_id, s.state, s.version, s.title, s.description, ' +
          's.cover_ref, s.etag, s.created_at, s.updated_at, ' +
          'i.id AS idem_id, i.owner_user_id AS idem_owner_user_id, i.request_hash AS idem_request_hash, ' +
          'i.status AS idem_status, i.response_status AS idem_response_status, ' +
          'i.response_json AS idem_response_json, i.expires_at AS idem_expires_at ' +
          'FROM content_collections s ' +
          'LEFT JOIN LATERAL (' +
          'SELECT id, owner_user_id, request_hash, status, response_status, response_json, expires_at ' +
          'FROM content_mutation_idempotency ' +
          'WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 ' +
          'ORDER BY created_at DESC LIMIT 1' +
          ') i ON TRUE ' +
          'WHERE s.id = $4 AND s.owner_user_id = $1 LIMIT 1',
          [ownerUserId, operationId, idempotencyKey, collectionId],
        )
        const row = result.rows[0]
        if (!row) return { collection: null, idempotency: null }
        return {
          collection: toCollection(row),
          idempotency: toIdempotency(row, ownerUserId),
        }
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async update(input) {
      let client: CollectionUpdatePostgresClient | undefined
      let transactionOpen = false
      try {
        client = await database.connect()
        await client.query('BEGIN')
        transactionOpen = true

        await client.query(
          'DELETE FROM content_mutation_idempotency ' +
          'WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 AND expires_at <= $4::timestamptz',
          [input.ownerUserId, input.operationId, input.idempotencyKey, input.updatedAt],
        )
        await client.query(
          'INSERT INTO content_mutation_idempotency ' +
          '(id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at) ' +
          "VALUES ($1, $2, $3, $4, $5, 'COMPLETED', 200, $6, $7::timestamptz, $8::timestamptz)",
          [
            crypto.randomUUID(),
            input.ownerUserId,
            input.operationId,
            input.idempotencyKey,
            input.requestHash,
            input.responseJson,
            input.updatedAt,
            input.expiresAt,
          ],
        )

        const collection = input.collection
        const updated = await client.query<{ id: string }>(
          'UPDATE content_collections ' +
          'SET title = $1, description = $2, cover_ref = $3, version = $4, etag = $5, updated_at = $6::timestamptz ' +
          'WHERE id = $7 AND owner_user_id = $8 AND version = $9 AND etag = $10 ' +
          'RETURNING id',
          [
            collection.title,
            collection.description,
            collection.coverRef,
            collection.version,
            collection.etag,
            input.updatedAt,
            collection.id,
            input.ownerUserId,
            input.expectedVersion,
            input.expectedEtag,
          ],
        )
        if (updated.rows.length !== 1) {
          throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
        }

        // The PostgreSQL content_collections trigger emits collection.updated
        // into content_outbox_events before this transaction commits.
        await client.query('COMMIT')
        transactionOpen = false
      } catch (error) {
        if (transactionOpen && client) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // Preserve the original error; transaction cleanup is best effort.
          }
        }
        if (error instanceof ContentRuntimeError) throw error
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

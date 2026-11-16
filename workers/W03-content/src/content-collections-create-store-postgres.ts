import { ContentRuntimeError } from './content-runtime.js'
import type {
  CollectionCreateStore,
  CollectionRecord,
  IdempotencyRow,
} from './content-collections.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

interface CollectionCreatePostgresClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

export interface CollectionCreatePostgresDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect(): Promise<CollectionCreatePostgresClient>
}

interface PostgresIdempotencyRow extends Omit<IdempotencyRow, 'expires_at'> {
  expires_at: Date | string
}

const timestampString = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_COLLECTION_IDEMPOTENCY_TIMESTAMP_INVALID')
}

const postgresError = (error: unknown): { code?: string; constraint?: string } => {
  if (!error || typeof error !== 'object') return {}
  const value = error as { code?: unknown; constraint?: unknown }
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    constraint: typeof value.constraint === 'string' ? value.constraint : undefined,
  }
}

/**
 * Neon writer for the existing createCollection operation only.
 * Idempotency reservation, collection insert and the collection.created
 * trigger/outbox write share one PostgreSQL transaction.
 */
export function createPostgresCollectionCreateStore(
  database: CollectionCreatePostgresDatabase,
): CollectionCreateStore {
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
      let client: CollectionCreatePostgresClient | undefined
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
        const collection = input.collection
        await client.query(
          'INSERT INTO content_collections ' +
          '(id, owner_user_id, creator_id, state, version, title, description, cover_ref, etag, created_at, updated_at) ' +
          "VALUES ($1, $2, $3, 'DRAFT', 1, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)",
          [
            collection.id,
            collection.ownerUserId,
            collection.creatorId,
            collection.title,
            collection.description,
            collection.coverRef,
            collection.etag,
            collection.createdAt,
            collection.updatedAt,
          ],
        )

        // The PostgreSQL content_collections trigger emits collection.created
        // into content_outbox_events before this transaction commits.
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

export type { CollectionRecord }

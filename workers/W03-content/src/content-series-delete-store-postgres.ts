import { ContentRuntimeError } from './content-runtime.js'
import {
  createPostgresSeriesUpdateStore,
  type SeriesUpdatePostgresDatabase,
} from './content-series-update-store-postgres.js'
import type { SeriesDeleteStore } from './content-series.js'

type DeleteInput = Parameters<SeriesDeleteStore['delete']>[0]

const postgresError = (error: unknown): { code?: string; constraint?: string } => {
  if (!error || typeof error !== 'object') return {}
  const value = error as { code?: unknown; constraint?: unknown }
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    constraint: typeof value.constraint === 'string' ? value.constraint : undefined,
  }
}

/**
 * Neon writer for Series soft deletion only.
 * Reuses the existing owner-scoped Series/idempotency snapshot reader;
 * idempotency and the DELETED transition commit together, and the existing
 * content_series trigger writes series.deleted to the outbox in this transaction.
 */
export function createPostgresSeriesDeleteStore(
  database: SeriesUpdatePostgresDatabase,
): SeriesDeleteStore {
  const mutationReader = createPostgresSeriesUpdateStore(database)

  return {
    loadMutation(ownerUserId, seriesId, operationId, idempotencyKey) {
      return mutationReader.loadMutation(ownerUserId, seriesId, operationId, idempotencyKey)
    },

    async delete(input: DeleteInput) {
      let client: Awaited<ReturnType<SeriesUpdatePostgresDatabase['connect']>> | undefined
      let transactionOpen = false
      try {
        client = await database.connect()
        await client.query('BEGIN')
        transactionOpen = true

        await client.query(
          'DELETE FROM content_mutation_idempotency ' +
          'WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 AND expires_at <= $4::timestamptz',
          [input.ownerUserId, input.operationId, input.idempotencyKey, input.deletedAt],
        )
        await client.query(
          'INSERT INTO content_mutation_idempotency ' +
          '(id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at) ' +
          "VALUES ($1, $2, $3, $4, $5, 'COMPLETED', 204, '', $6::timestamptz, $7::timestamptz)",
          [
            crypto.randomUUID(),
            input.ownerUserId,
            input.operationId,
            input.idempotencyKey,
            input.requestHash,
            input.deletedAt,
            input.expiresAt,
          ],
        )

        const updated = await client.query<{ id: string }>(
          'UPDATE content_series ' +
          "SET state = 'DELETED', version = $1, etag = $2, updated_at = $3::timestamptz " +
          'WHERE id = $4 AND owner_user_id = $5 AND version = $6 AND etag = $7 ' +
          'RETURNING id',
          [
            input.nextVersion,
            input.nextEtag,
            input.deletedAt,
            input.seriesId,
            input.ownerUserId,
            input.expectedVersion,
            input.expectedEtag,
          ],
        )
        if (updated.rows.length !== 1) {
          throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
        }

        // The existing PostgreSQL trigger emits series.deleted before commit.
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

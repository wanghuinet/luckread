import { ContentRuntimeError } from './content-runtime.js'
import type {
  SeriesMemberMutationRow,
  SeriesMemberRemoveStore,
} from './content-series-members.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

interface SeriesMemberRemovePostgresClient {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>
  release(): void
}

export interface SeriesMemberRemovePostgresDatabase {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>
  connect(): Promise<SeriesMemberRemovePostgresClient>
}

interface PostgresMutationRow extends Omit<
  SeriesMemberMutationRow,
  'idem_expires_at' | 'membership_created_at' | 'membership_updated_at'
> {
  idem_expires_at: Date | string | null
  membership_created_at: Date | string | null
  membership_updated_at: Date | string | null
}

const timestampString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_SERIES_MEMBER_TIMESTAMP_INVALID')
}

const postgresError = (error: unknown): { code?: string; constraint?: string } => {
  if (!error || typeof error !== 'object') return {}
  const value = error as { code?: unknown; constraint?: unknown }
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    constraint: typeof value.constraint === 'string' ? value.constraint : undefined,
  }
}

const toMutationRow = (row: PostgresMutationRow): SeriesMemberMutationRow => ({
  ...row,
  idem_expires_at: timestampString(row.idem_expires_at),
  membership_created_at: timestampString(row.membership_created_at),
  membership_updated_at: timestampString(row.membership_updated_at),
})

/**
 * Neon writer for Series member removal only. The owner-scoped membership and
 * idempotency snapshot mirrors the D1 lookup; idempotency, parent version/ETag
 * and ACTIVE -> REVOKED are committed in one transaction. Existing PostgreSQL
 * triggers emit the Series and relationship outbox events before commit.
 */
export function createPostgresSeriesMemberRemoveStore(
  database: SeriesMemberRemovePostgresDatabase,
): SeriesMemberRemoveStore {
  return {
    async loadMutation(ownerUserId, seriesId, contentId, operationId, idempotencyKey) {
      try {
        const result = await database.query<PostgresMutationRow>(
          'SELECT s.id AS series_id, s.owner_user_id AS series_owner_user_id, ' +
          's.state AS series_state, s.version AS series_version, s.etag AS series_etag, ' +
          'c.id AS content_id, c.owner_user_id AS content_owner_user_id, ' +
          'c.slug AS content_slug, c.content_type AS content_type, ' +
          'c.state AS content_state, c.title AS content_title, ' +
          'i.id AS idem_id, i.owner_user_id AS idem_owner_user_id, ' +
          'i.request_hash AS idem_request_hash, i.status AS idem_status, ' +
          'i.response_status AS idem_response_status, i.response_json AS idem_response_json, ' +
          'i.expires_at AS idem_expires_at, ' +
          'r.relationship_id AS membership_relationship_id, r.position AS membership_position, ' +
          'r.created_at AS membership_created_at, r.updated_at AS membership_updated_at, ' +
          'COALESCE((SELECT MAX(r2.position) + 1 FROM content_relationships r2 ' +
          "WHERE r2.target_id = s.id AND r2.target_type = 'series' " +
          "AND r2.relation_type = 'series-member' AND r2.status = 'ACTIVE'), 0) AS next_position " +
          'FROM content_series s ' +
          'JOIN contents c ON c.id = $1 ' +
          'LEFT JOIN LATERAL (' +
          'SELECT id, owner_user_id, request_hash, status, response_status, response_json, expires_at ' +
          'FROM content_mutation_idempotency ' +
          'WHERE owner_user_id = $2 AND operation_id = $3 AND idempotency_key = $4 ' +
          'ORDER BY created_at DESC LIMIT 1' +
          ') i ON TRUE ' +
          'LEFT JOIN content_relationships r ON ' +
          "r.source_type = 'content' AND r.source_id = c.id " +
          "AND r.target_type = 'series' AND r.target_id = s.id " +
          "AND r.relation_type = 'series-member' AND r.status = 'ACTIVE' " +
          'WHERE s.id = $5 AND s.owner_user_id = $6 LIMIT 1',
          [contentId, ownerUserId, operationId, idempotencyKey, seriesId, ownerUserId],
        )
        const row = result.rows[0]
        return row ? toMutationRow(row) : null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async remove(input) {
      let client: SeriesMemberRemovePostgresClient | undefined
      let transactionOpen = false
      try {
        client = await database.connect()
        await client.query('BEGIN')
        transactionOpen = true

        await client.query(
          'DELETE FROM content_mutation_idempotency ' +
          'WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 AND expires_at <= $4::timestamptz',
          [input.ownerUserId, input.operationId, input.idempotencyKey, input.nowIso],
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
            input.nowIso,
            input.expiresAt,
          ],
        )

        const updated = await client.query<{ id: string }>(
          'UPDATE content_series SET version = $1, etag = $2, updated_at = $3::timestamptz ' +
          'WHERE id = $4 AND owner_user_id = $5 AND version = $6 AND etag = $7 RETURNING id',
          [
            input.nextVersion,
            input.seriesEtag,
            input.nowIso,
            input.seriesId,
            input.ownerUserId,
            input.expectedVersion,
            input.expectedEtag,
          ],
        )
        if (updated.rows.length !== 1) throw new ContentRuntimeError('PRECONDITION_FAILED', 412)

        const revoked = await client.query<{ relationship_id: string }>(
          "UPDATE content_relationships SET status = 'REVOKED', updated_at = $1::timestamptz " +
          "WHERE relationship_id = $2 AND source_type = 'content' AND source_id = $3 " +
          "AND target_type = 'series' AND target_id = $4 AND relation_type = 'series-member' " +
          "AND status = 'ACTIVE' RETURNING relationship_id',
          [
            input.nowIso,
            input.relationshipId,
            input.contentId,
            input.seriesId,
          ],
        )
        if (revoked.rows.length !== 1) throw new ContentRuntimeError('PRECONDITION_FAILED', 412)

        // Existing PostgreSQL triggers emit series.updated and content.relationship.revoked.
        await client.query('COMMIT')
        transactionOpen = false
      } catch (error) {
        if (transactionOpen && client) {
          try { await client.query('ROLLBACK') } catch { /* Keep the original failure. */ }
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

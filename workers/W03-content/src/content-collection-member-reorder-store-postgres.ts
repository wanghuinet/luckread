import { ContentRuntimeError } from './content-runtime.js'
import type {
  CollectionMemberMutationRow,
  CollectionMemberOrderRow,
  CollectionMemberReorderStore,
} from './content-collection-members.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

interface CollectionMemberReorderPostgresClient {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>
  release(): void
}

export interface CollectionMemberReorderPostgresDatabase {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>
  connect(): Promise<CollectionMemberReorderPostgresClient>
}

interface PostgresMutationRow extends Omit<
  CollectionMemberMutationRow,
  'idem_expires_at' | 'membership_created_at' | 'membership_updated_at'
> {
  idem_expires_at: Date | string | null
  membership_created_at: Date | string | null
  membership_updated_at: Date | string | null
}

interface PostgresOrderRow extends Omit<CollectionMemberOrderRow, 'created_at' | 'updated_at'> {
  created_at: Date | string
  updated_at: Date | string
}

const timestampString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_COLLECTION_MEMBER_TIMESTAMP_INVALID')
}

const postgresError = (error: unknown): { code?: string; constraint?: string } => {
  if (!error || typeof error !== 'object') return {}
  const value = error as { code?: unknown; constraint?: unknown }
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    constraint: typeof value.constraint === 'string' ? value.constraint : undefined,
  }
}

const toMutationRow = (row: PostgresMutationRow): CollectionMemberMutationRow => ({
  ...row,
  idem_expires_at: timestampString(row.idem_expires_at),
  membership_created_at: timestampString(row.membership_created_at),
  membership_updated_at: timestampString(row.membership_updated_at),
})

const toOrderRow = (row: PostgresOrderRow): CollectionMemberOrderRow => ({
  relationship_id: row.relationship_id,
  source_id: row.source_id,
  position: row.position,
  created_at: timestampString(row.created_at) ?? '',
  updated_at: timestampString(row.updated_at) ?? '',
})

/**
 * Neon writer for Collection member reordering only. The Collection version/ETag
 * compare-and-swap and all relationship position changes commit with the
 * idempotency receipt in one transaction. Existing PostgreSQL triggers publish
 * the Collection and member-order outbox events.
 */
export function createPostgresCollectionMemberReorderStore(
  database: CollectionMemberReorderPostgresDatabase,
): CollectionMemberReorderStore {
  return {
    async loadMutation(ownerUserId, collectionId, contentId, operationId, idempotencyKey) {
      try {
        const result = await database.query<PostgresMutationRow>(
          'SELECT coll.id AS collection_id, coll.owner_user_id AS collection_owner_user_id, ' +
          'coll.state AS collection_state, coll.version AS collection_version, coll.etag AS collection_etag, ' +
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
          "WHERE r2.target_id = coll.id AND r2.target_type = 'collection' " +
          "AND r2.relation_type = 'collection-member' AND r2.status = 'ACTIVE'), 0) AS next_position " +
          'FROM content_collections coll ' +
          'JOIN contents c ON c.id = $1 ' +
          'LEFT JOIN LATERAL (' +
          'SELECT id, owner_user_id, request_hash, status, response_status, response_json, expires_at ' +
          'FROM content_mutation_idempotency ' +
          'WHERE owner_user_id = $2 AND operation_id = $3 AND idempotency_key = $4 ' +
          'ORDER BY created_at DESC LIMIT 1' +
          ') i ON TRUE ' +
          'LEFT JOIN content_relationships r ON ' +
          "r.source_type = 'content' AND r.source_id = c.id " +
          "AND r.target_type = 'collection' AND r.target_id = coll.id " +
          "AND r.relation_type = 'collection-member' AND r.status = 'ACTIVE' " +
          'WHERE coll.id = $5 AND coll.owner_user_id = $6 LIMIT 1',
          [contentId, ownerUserId, operationId, idempotencyKey, collectionId, ownerUserId],
        )
        const row = result.rows[0]
        return row ? toMutationRow(row) : null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async listMembers(ownerUserId, collectionId) {
      try {
        const result = await database.query<PostgresOrderRow>(
          'SELECT r.relationship_id, r.source_id, r.position, r.created_at, r.updated_at ' +
          'FROM content_relationships r ' +
          'JOIN content_collections coll ON coll.id = r.target_id ' +
          "WHERE coll.id = $1 AND coll.owner_user_id = $2 AND r.target_type = 'collection' " +
          "AND r.relation_type = 'collection-member' AND r.status = 'ACTIVE' " +
          'ORDER BY r.position ASC, r.relationship_id ASC',
          [collectionId, ownerUserId],
        )
        return result.rows.map(toOrderRow)
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async reorder(input) {
      let client: CollectionMemberReorderPostgresClient | undefined
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
          'UPDATE content_collections SET version = $1, etag = $2, updated_at = $3::timestamptz ' +
          'WHERE id = $4 AND owner_user_id = $5 AND version = $6 AND etag = $7 RETURNING id',
          [
            input.nextVersion,
            input.collectionEtag,
            input.nowIso,
            input.collectionId,
            input.ownerUserId,
            input.expectedVersion,
            input.expectedEtag,
          ],
        )
        if (updated.rows.length !== 1) throw new ContentRuntimeError('PRECONDITION_FAILED', 412)

        // Move all active members out of the unique position range before assigning final slots.
        const offset = input.members.length + 1
        const shifted = await client.query<{ relationship_id: string }>(
          'UPDATE content_relationships SET position = position + $1 ' +
          "WHERE target_type = 'collection' AND target_id = $2 AND relation_type = 'collection-member' " +
          "AND status = 'ACTIVE' RETURNING relationship_id",
          [offset, input.collectionId],
        )
        if (shifted.rows.length !== input.members.length) {
          throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
        }

        for (const item of input.members) {
          const reordered = await client.query<{ relationship_id: string }>(
            'UPDATE content_relationships SET position = $1, updated_at = $2::timestamptz ' +
            "WHERE relationship_id = $3 AND target_type = 'collection' AND target_id = $4 " +
            "AND relation_type = 'collection-member' AND status = 'ACTIVE' RETURNING relationship_id",
            [item.position, input.nowIso, item.relationshipId, input.collectionId],
          )
          if (reordered.rows.length !== 1) throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
        }

        // Existing PostgreSQL triggers emit Collection and member-order outbox events.
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
        if (failure.code === '23505') throw new ContentRuntimeError('CONFLICT', 409)
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      } finally {
        client?.release()
      }
    },
  }
}

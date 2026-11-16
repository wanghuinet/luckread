import { ContentRuntimeError } from './content-runtime.js'
import type {
  ContentRelationship,
  ContentRelationshipMutationStore,
  CreateRelationshipQueryRow,
  RevokeRelationshipQueryRow,
} from './content-relationships.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

interface ContentRelationshipPostgresClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

export interface ContentRelationshipPostgresDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect(): Promise<ContentRelationshipPostgresClient>
}

type PostgresCreateRelationshipRow = Omit<CreateRelationshipQueryRow, 'idem_expires_at'> & {
  idem_expires_at: Date | string | null
}

type PostgresRevokeRelationshipRow = Omit<
  RevokeRelationshipQueryRow,
  'created_at' | 'updated_at' | 'idem_expires_at'
> & {
  created_at: Date | string
  updated_at: Date | string
  idem_expires_at: Date | string | null
}

const timestampString = (value: unknown, nullable = false): string | null => {
  if (value === null && nullable) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_CONTENT_RELATIONSHIP_TIMESTAMP_INVALID')
}

const postgresFailure = (error: unknown): { code?: string } => {
  if (!error || typeof error !== 'object') return {}
  const value = error as { code?: unknown }
  return { code: typeof value.code === 'string' ? value.code : undefined }
}

const mapFailure = (error: unknown): never => {
  if (error instanceof ContentRuntimeError) throw error
  if (postgresFailure(error).code === '23505') {
    throw new ContentRuntimeError('CONFLICT', 409)
  }
  throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
}

const insertCompletedIdempotency = async (
  client: ContentRelationshipPostgresClient,
  input: {
    ownerUserId: string
    operationId: string
    idempotencyKey: string
    requestHash: string
    responseStatus: number
    responseJson: string
    now: string
    expiresAt: string
  },
): Promise<void> => {
  await client.query(
    'DELETE FROM content_mutation_idempotency ' +
    'WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 AND expires_at <= $4::timestamptz',
    [input.ownerUserId, input.operationId, input.idempotencyKey, input.now],
  )
  await client.query(
    'INSERT INTO content_mutation_idempotency ' +
    '(id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at) ' +
    "VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6, $7, $8::timestamptz, $9::timestamptz)",
    [
      crypto.randomUUID(),
      input.ownerUserId,
      input.operationId,
      input.idempotencyKey,
      input.requestHash,
      input.responseStatus,
      input.responseJson,
      input.now,
      input.expiresAt,
    ],
  )
}

const withTransaction = async (
  database: ContentRelationshipPostgresDatabase,
  action: (client: ContentRelationshipPostgresClient) => Promise<void>,
): Promise<void> => {
  let client: ContentRelationshipPostgresClient | undefined
  let transactionOpen = false
  try {
    client = await database.connect()
    await client.query('BEGIN')
    transactionOpen = true
    await action(client)
    await client.query('COMMIT')
    transactionOpen = false
  } catch (error) {
    if (transactionOpen && client) {
      try { await client.query('ROLLBACK') } catch { /* Preserve the original failure. */ }
    }
    mapFailure(error)
  } finally {
    client?.release()
  }
}

/** PostgreSQL persistence for creator-owned reference relationship mutations. */
export function createPostgresContentRelationshipMutationStore(
  database: ContentRelationshipPostgresDatabase,
): ContentRelationshipMutationStore {
  return {
    async loadCreate(input) {
      try {
        const result = await database.query<PostgresCreateRelationshipRow>(
          'SELECT s.id AS source_id, s.owner_user_id, s.version AS source_version, t.id AS target_id, ' +
          'i.id AS idem_id, i.owner_user_id AS idem_owner_user_id, i.request_hash AS idem_request_hash, ' +
          'i.status AS idem_status, i.response_json AS idem_response_json, i.expires_at AS idem_expires_at, ' +
          '(SELECT relationship_id FROM content_relationships r ' +
          "WHERE r.source_id = s.id AND r.target_id = t.id AND r.relation_type = 'reference' AND r.status = 'ACTIVE' LIMIT 1) " +
          'AS active_relationship_id ' +
          'FROM contents s LEFT JOIN contents t ON t.id = $1 ' +
          'LEFT JOIN LATERAL (SELECT id, owner_user_id, request_hash, status, response_json, expires_at ' +
          'FROM content_mutation_idempotency WHERE owner_user_id = $2 AND operation_id = $3 AND idempotency_key = $4 ' +
          'ORDER BY created_at DESC LIMIT 1) i ON TRUE WHERE s.id = $5 LIMIT 1',
          [
            input.targetContentId,
            input.ownerUserId,
            input.operationId,
            input.idempotencyKey,
            input.sourceContentId,
          ],
        )
        const row = result.rows[0]
        return row
          ? { ...row, idem_expires_at: timestampString(row.idem_expires_at, true) }
          : null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async create(input) {
      await withTransaction(database, async (client) => {
        await insertCompletedIdempotency(client, {
          ownerUserId: input.ownerUserId,
          operationId: input.operationId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          responseStatus: 201,
          responseJson: input.responseJson,
          now: input.createdAt,
          expiresAt: input.expiresAt,
        })
        const relationship: ContentRelationship = input.relationship
        const inserted = await client.query<{ relationship_id: string }>(
          'INSERT INTO content_relationships ' +
          '(relationship_id, source_type, source_id, target_type, target_id, relation_type, ' +
          'schema_version, status, actor_id, provenance_ref, authorization_ref, created_at, updated_at) ' +
          "VALUES ($1, 'content', $2, 'content', $3, 'reference', 1, 'ACTIVE', $4, $5, $6, $7::timestamptz, $8::timestamptz) " +
          'RETURNING relationship_id',
          [
            relationship.relationshipId,
            relationship.sourceId,
            relationship.targetId,
            relationship.actorId,
            relationship.provenanceRef,
            relationship.authorizationRef,
            relationship.createdAt,
            relationship.updatedAt,
          ],
        )
        if (inserted.rows.length !== 1) {
          throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
        }
        // content_relationships_after_insert_outbox emits content.relationship.created in this transaction.
      })
    },

    async loadRevoke(input) {
      try {
        const result = await database.query<PostgresRevokeRelationshipRow>(
          'SELECT r.relationship_id, r.source_type, r.source_id, r.target_type, r.target_id, ' +
          'r.relation_type, r.schema_version, r.status, r.actor_id, r.provenance_ref, ' +
          'r.authorization_ref, r.created_at, r.updated_at, c.owner_user_id, ' +
          'i.id AS idem_id, i.owner_user_id AS idem_owner_user_id, i.request_hash AS idem_request_hash, ' +
          'i.status AS idem_status, i.response_json AS idem_response_json, i.expires_at AS idem_expires_at ' +
          'FROM content_relationships r JOIN contents c ON c.id = r.source_id ' +
          'LEFT JOIN LATERAL (SELECT id, owner_user_id, request_hash, status, response_json, expires_at ' +
          'FROM content_mutation_idempotency WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 ' +
          'ORDER BY created_at DESC LIMIT 1) i ON TRUE ' +
          'WHERE r.relationship_id = $4 AND r.source_id = $5 LIMIT 1',
          [
            input.ownerUserId,
            input.operationId,
            input.idempotencyKey,
            input.relationshipId,
            input.sourceContentId,
          ],
        )
        const row = result.rows[0]
        return row
          ? {
              ...row,
              created_at: timestampString(row.created_at) as string,
              updated_at: timestampString(row.updated_at) as string,
              idem_expires_at: timestampString(row.idem_expires_at, true),
            }
          : null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async revoke(input) {
      await withTransaction(database, async (client) => {
        await insertCompletedIdempotency(client, {
          ownerUserId: input.ownerUserId,
          operationId: input.operationId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          responseStatus: 200,
          responseJson: input.responseJson,
          now: input.updatedAt,
          expiresAt: input.expiresAt,
        })
        const revoked = await client.query<{ relationship_id: string }>(
          "UPDATE content_relationships SET status = 'REVOKED', updated_at = $1::timestamptz " +
          "WHERE relationship_id = $2 AND source_id = $3 AND status = 'ACTIVE' RETURNING relationship_id",
          [input.updatedAt, input.relationshipId, input.sourceContentId],
        )
        if (revoked.rows.length !== 1) {
          // The D1 implementation fails closed when its atomic guard sees no updated row.
          throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
        }
        // content_relationships_after_update_outbox emits content.relationship.revoked in this transaction.
      })
    },
  }
}

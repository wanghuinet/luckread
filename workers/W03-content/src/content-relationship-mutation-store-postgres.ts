import { ContentRuntimeError, decodeScopedCursor, encodeScopedCursor } from './content-runtime.js'
import type {
  AppendPostThreadQueryRow,
  ContentRelationship,
  ContentRelationshipMutationStore,
  ContentRelationshipDirection,
  PublicContentRelationship,
  CreateRelationshipQueryRow,
  PostThreadChainStats,
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

type PostgresAppendPostThreadQueryRow = Omit<AppendPostThreadQueryRow, 'idem_expires_at'> & {
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

async function listNeonContentRelationships(
  database: ContentRelationshipPostgresDatabase,
  input: {
    contentId: string
    direction: ContentRelationshipDirection
    cursor: string | null
    limit: number
  },
): Promise<{ items: PublicContentRelationship[]; nextCursor: string | null; hasMore: boolean }> {
  const contentId = input.contentId.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contentId) ||
      !['out', 'in', 'both'].includes(input.direction) ||
      !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }
  const scope = JSON.stringify({ type: 'content-relationships', contentId, direction: input.direction })
  const cursor = input.cursor ? decodeScopedCursor(input.cursor, scope) : null
  const predicate = input.direction === 'out'
    ? 'r.source_id = $1'
    : input.direction === 'in'
      ? 'r.target_id = $1'
      : '(r.source_id = $1 OR r.target_id = $1)'
  const projection = input.direction === 'out'
    ? "t.id AS related_id, t.slug AS related_slug, t.content_type AS related_type, t.title AS related_title, 'out' AS relation_direction"
    : input.direction === 'in'
      ? "s.id AS related_id, s.slug AS related_slug, s.content_type AS related_type, s.title AS related_title, 'in' AS relation_direction"
      : "CASE WHEN r.source_id = $1 THEN t.id ELSE s.id END AS related_id, CASE WHEN r.source_id = $1 THEN t.slug ELSE s.slug END AS related_slug, CASE WHEN r.source_id = $1 THEN t.content_type ELSE s.content_type END AS related_type, CASE WHEN r.source_id = $1 THEN t.title ELSE s.title END AS related_title, CASE WHEN r.source_id = $1 THEN 'out' ELSE 'in' END AS relation_direction"
  const values: unknown[] = [contentId]
  const cursorClause = cursor
    ? 'AND (r.created_at < $2::timestamptz OR (r.created_at = $2::timestamptz AND r.relationship_id < $3))'
    : ''
  if (cursor) values.push(cursor.updatedAt, cursor.id)
  const limitParameter = values.length + 1
  values.push(input.limit + 1)
  try {
    const result = await database.query<{
      relationship_id: string
      relation_type: 'reference'
      created_at: Date | string
      related_id: string
      related_slug: string
      related_type: 'article' | 'post' | 'video'
      related_title: string
      relation_direction: 'out' | 'in'
    }>(
      'SELECT r.relationship_id, r.relation_type, r.created_at, ' + projection +
      ' FROM content_relationships r JOIN contents s ON s.id = r.source_id JOIN contents t ON t.id = r.target_id' +
      " WHERE r.status = 'ACTIVE' AND s.state = 'PUBLISHED' AND t.state = 'PUBLISHED' AND r.relation_type = 'reference' AND " +
      predicate + ' ' + cursorClause +
      ' ORDER BY r.created_at DESC, r.relationship_id DESC LIMIT $' + limitParameter,
      values,
    )
    const page = result.rows.slice(0, input.limit)
    const last = page.at(-1)
    return {
      items: page.map(row => ({
        relationshipId: row.relationship_id,
        relationType: row.relation_type,
        direction: row.relation_direction,
        relatedContent: {
          id: row.related_id,
          slug: row.related_slug,
          contentType: row.related_type,
          title: row.related_title,
        },
        createdAt: timestampString(row.created_at) as string,
      })),
      hasMore: result.rows.length > input.limit,
      nextCursor: result.rows.length > input.limit && last
        ? encodeScopedCursor(timestampString(last.created_at) as string, last.relationship_id, scope)
        : null,
    }
  } catch (error) {
    return mapFailure(error)
  }
}

export function createPostgresContentRelationshipMutationStore(
  database: ContentRelationshipPostgresDatabase,
): ContentRelationshipMutationStore {
  return {
    async list(input) {
      return listNeonContentRelationships(database, input)
    },
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
    async loadAppend(input) {
      try {
        const result = await database.query<PostgresAppendPostThreadQueryRow>(
          'SELECT s.id AS source_id, s.owner_user_id AS source_owner_user_id, ' +
          's.content_type AS source_content_type, s.state AS source_state, s.access_mode AS source_access_mode, ' +
          't.id AS target_id, t.owner_user_id AS target_owner_user_id, ' +
          't.content_type AS target_content_type, t.state AS target_state, t.access_mode AS target_access_mode, ' +
          'i.id AS idem_id, i.owner_user_id AS idem_owner_user_id, i.request_hash AS idem_request_hash, ' +
          'i.status AS idem_status, i.response_json AS idem_response_json, i.expires_at AS idem_expires_at ' +
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

    async loadAppendStats(input) {
      try {
        const result = await database.query<PostThreadChainStats>(
          'WITH RECURSIVE previous(id, depth, visited) AS (' +
          "SELECT $1::text, 0, '|' || $1::text || '|' " +
          'UNION ALL ' +
          "SELECT r.source_id, p.depth + 1, p.visited || r.source_id || '|' " +
          'FROM previous p JOIN content_relationships r ON r.target_id = p.id ' +
          "AND r.relation_type = 'thread-next' AND r.status = 'ACTIVE' " +
          "WHERE p.depth < $3 AND STRPOS(p.visited, '|' || r.source_id || '|') = 0" +
          '), next_chain(id, depth, visited) AS (' +
          "SELECT $2::text, 0, '|' || $2::text || '|' " +
          'UNION ALL ' +
          "SELECT r.target_id, n.depth + 1, n.visited || r.target_id || '|' " +
          'FROM next_chain n JOIN content_relationships r ON r.source_id = n.id ' +
          "AND r.relation_type = 'thread-next' AND r.status = 'ACTIVE' " +
          "WHERE n.depth < $3 AND STRPOS(n.visited, '|' || r.target_id || '|') = 0" +
          ') ' +
          'SELECT (SELECT COUNT(*)::integer FROM previous) AS previous_count, ' +
          '(SELECT COUNT(*)::integer FROM next_chain) AS next_count, ' +
          'CASE WHEN EXISTS(SELECT 1 FROM next_chain WHERE id = $1) THEN 1 ELSE 0 END AS would_cycle, ' +
          'CASE WHEN EXISTS(SELECT 1 FROM content_relationships WHERE source_id = $1 ' +
          "AND relation_type = 'thread-next' AND status = 'ACTIVE') THEN 1 ELSE 0 END AS source_has_next, " +
          'CASE WHEN EXISTS(SELECT 1 FROM content_relationships WHERE target_id = $2 ' +
          "AND relation_type = 'thread-next' AND status = 'ACTIVE') THEN 1 ELSE 0 END AS target_has_previous",
          [input.sourceContentId, input.targetContentId, input.maxItems],
        )
        return result.rows[0] ?? null
      } catch {
        throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async appendThread(input) {
      await withTransaction(database, async (client) => {
        // A transaction-scoped per-owner lock serializes edits to one author's
        // thread graph while allowing unrelated owners to append concurrently.
        // The final INSERT re-evaluates the graph; preflight reads are hints only.
        await client.query('SELECT pg_advisory_xact_lock(74031, hashtext($1))', [input.ownerUserId])
        await client.query(
          'SELECT id FROM contents WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE',
          [[input.relationship.sourceId, input.relationship.targetId]],
        )
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
        const relationship = input.relationship
        const inserted = await client.query<{ relationship_id: string }>(
          'WITH RECURSIVE descendants(id, depth, visited) AS (' +
          "SELECT $1::text, 0, '|' || $1::text || '|' " +
          'UNION ALL ' +
          "SELECT r.target_id, d.depth + 1, d.visited || r.target_id || '|' " +
          'FROM descendants d JOIN content_relationships r ON r.source_id = d.id ' +
          "AND r.relation_type = 'thread-next' AND r.status = 'ACTIVE' " +
          "WHERE d.depth < $3 AND STRPOS(d.visited, '|' || r.target_id || '|') = 0" +
          '), ancestors(id, depth, visited) AS (' +
          "SELECT $2::text, 0, '|' || $2::text || '|' " +
          'UNION ALL ' +
          "SELECT r.source_id, a.depth + 1, a.visited || r.source_id || '|' " +
          'FROM ancestors a JOIN content_relationships r ON r.target_id = a.id ' +
          "AND r.relation_type = 'thread-next' AND r.status = 'ACTIVE' " +
          "WHERE a.depth < $3 AND STRPOS(a.visited, '|' || r.source_id || '|') = 0" +
          ') ' +
          'INSERT INTO content_relationships ' +
          '(relationship_id, source_type, source_id, target_type, target_id, relation_type, position, ' +
          'schema_version, status, actor_id, provenance_ref, authorization_ref, created_at, updated_at) ' +
          "SELECT $4, 'content', s.id, 'content', t.id, 'thread-next', NULL, 1, 'ACTIVE', $5, NULL, NULL, " +
          '$6::timestamptz, $6::timestamptz ' +
          'FROM contents s JOIN contents t ON t.id = $7 ' +
          'WHERE s.id = $2 AND s.id <> t.id AND s.owner_user_id = $5 AND t.owner_user_id = $5 ' +
          "AND s.content_type = 'post' AND t.content_type = 'post' " +
          "AND s.state IN ('DRAFT', 'PUBLISHED') AND t.state IN ('DRAFT', 'PUBLISHED') " +
          "AND s.access_mode = 'PUBLIC' AND t.access_mode = 'PUBLIC' " +
          'AND NOT EXISTS (SELECT 1 FROM content_relationships r WHERE r.source_id = s.id ' +
          "AND r.relation_type = 'thread-next' AND r.status = 'ACTIVE') " +
          'AND NOT EXISTS (SELECT 1 FROM content_relationships r WHERE r.target_id = t.id ' +
          "AND r.relation_type = 'thread-next' AND r.status = 'ACTIVE') " +
          'AND NOT EXISTS (SELECT 1 FROM descendants WHERE id = s.id) ' +
          'AND (SELECT COUNT(*) FROM descendants) + (SELECT COUNT(*) FROM ancestors) <= $8 ' +
          'RETURNING relationship_id',
          [
            relationship.targetId,
            relationship.sourceId,
            input.maxItems,
            relationship.relationshipId,
            input.ownerUserId,
            input.createdAt,
            relationship.targetId,
            input.maxItems,
          ],
        )
        if (inserted.rows.length !== 1) {
          throw new ContentRuntimeError('CONFLICT', 409)
        }
        // The existing INSERT trigger emits content.relationship.created for appendPostThreadNext.
      })
    },


  }
}

import { ContentRuntimeError } from './content-runtime.js'
import type {
  ContentMutationSnapshot,
  ContentMutationStore,
  ContentRecord,
  ContentRevision,
  ContentRow,
  IdempotencyRow,
} from './content-runtime.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

interface ContentMutationPostgresClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

export interface ContentMutationPostgresDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect(): Promise<ContentMutationPostgresClient>
}

interface PostgresMutationRow extends Omit<ContentRow, 'created_at' | 'updated_at' | 'scheduled_at'> {
  created_at: Date | string
  updated_at: Date | string
  scheduled_at: Date | string | null
  idem_id: string | null
  idem_owner_user_id: string | null
  idem_request_hash: string | null
  idem_status: IdempotencyRow['idem_status']
  idem_response_status: number | null
  idem_response_json: string | null
  idem_expires_at: Date | string | null
}

const timestampString = (value: unknown, nullable = false): string | null => {
  if (value === null && nullable) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('W03_POSTGRES_CONTENT_MUTATION_TIMESTAMP_INVALID')
}

const postgresError = (error: unknown): { code?: string; constraint?: string } => {
  if (!error || typeof error !== 'object') return {}
  const value = error as { code?: unknown; constraint?: unknown }
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    constraint: typeof value.constraint === 'string' ? value.constraint : undefined,
  }
}

const toSnapshot = (row: PostgresMutationRow): ContentMutationSnapshot => {
  const contentRow: ContentRow = {
    id: row.id,
    content_type: row.content_type,
    owner_user_id: row.owner_user_id,
    creator_id: row.creator_id,
    ip_id: row.ip_id,
    state: row.state,
    scheduled_at: timestampString(row.scheduled_at, true),
    access_mode: row.access_mode,
    version: row.version,
    revision: row.revision,
    slug: row.slug,
    title: row.title,
    body_ref: row.body_ref,
    media_refs_json: row.media_refs_json,
    cover_ref: row.cover_ref,
    media_warning: row.media_warning,
    etag: row.etag,
    created_at: timestampString(row.created_at) as string,
    updated_at: timestampString(row.updated_at) as string,
  }
  const content: ContentRecord = {
    id: contentRow.id,
    contentType: contentRow.content_type,
    ownerUserId: contentRow.owner_user_id,
    creatorId: contentRow.creator_id,
    ipId: contentRow.ip_id,
    state: contentRow.state,
    scheduledAt: contentRow.scheduled_at,
    accessMode: contentRow.access_mode === 'MEMBERS_ONLY' ? 'MEMBERS_ONLY' : 'PUBLIC',
    version: contentRow.version,
    revision: contentRow.revision,
    slug: contentRow.slug,
    title: contentRow.title,
    bodyRef: contentRow.body_ref,
    mediaRefs: JSON.parse(contentRow.media_refs_json || '[]') as string[],
    coverRef: contentRow.cover_ref,
    mediaWarning: contentRow.media_warning ?? null,
    etag: contentRow.etag,
    createdAt: contentRow.created_at,
    updatedAt: contentRow.updated_at,
  }
  const idempotency: IdempotencyRow = {
    idem_id: row.idem_id,
    idem_owner_user_id: row.idem_owner_user_id,
    idem_request_hash: row.idem_request_hash,
    idem_status: row.idem_status,
    idem_response_status: row.idem_response_status,
    idem_response_json: row.idem_response_json,
    idem_expires_at: row.idem_expires_at === null
      ? null
      : timestampString(row.idem_expires_at),
  }
  return { content, idempotency }
}

const loadMutation = async (
  database: ContentMutationPostgresDatabase,
  ownerUserId: string,
  contentId: string,
  operationId: string,
  idempotencyKey: string,
): Promise<ContentMutationSnapshot> => {
  try {
    const result = await database.query<PostgresMutationRow>(
      'SELECT c.id, c.content_type, c.owner_user_id, c.creator_id, c.ip_id, c.state, ' +
      'c.scheduled_at, c.access_mode, c.version, c.revision, c.slug, c.title, c.body_ref, ' +
      'c.media_refs_json, c.cover_ref, c.media_warning, c.etag, c.created_at, c.updated_at, ' +
      'i.id AS idem_id, i.owner_user_id AS idem_owner_user_id, i.request_hash AS idem_request_hash, ' +
      'i.status AS idem_status, i.response_status AS idem_response_status, ' +
      'i.response_json AS idem_response_json, i.expires_at AS idem_expires_at ' +
      'FROM contents c LEFT JOIN LATERAL (' +
      'SELECT id, owner_user_id, request_hash, status, response_status, response_json, expires_at ' +
      'FROM content_mutation_idempotency ' +
      'WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3 ' +
      'ORDER BY created_at DESC LIMIT 1' +
      ') i ON TRUE WHERE c.id = $4 LIMIT 1',
      [ownerUserId, operationId, idempotencyKey, contentId],
    )
    const row = result.rows[0]
    return row ? toSnapshot(row) : { content: null, idempotency: {
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    } }
  } catch {
    throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

const insertIdempotency = async (
  client: ContentMutationPostgresClient,
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

const mapMutationFailure = (error: unknown): never => {
  if (error instanceof ContentRuntimeError) throw error
  const failure = postgresError(error)
  if (failure.code === '23505' &&
      failure.constraint?.includes('content_mutation_idempotency')) {
    throw new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409)
  }
  if (failure.code === '23505') throw new ContentRuntimeError('CONFLICT', 409)
  throw new ContentRuntimeError('SERVICE_UNAVAILABLE', 503)
}

const withTransaction = async (
  database: ContentMutationPostgresDatabase,
  action: (client: ContentMutationPostgresClient) => Promise<void>,
): Promise<void> => {
  let client: ContentMutationPostgresClient | undefined
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
    mapMutationFailure(error)
  } finally {
    client?.release()
  }
}

/** Neon-backed canonical content update and soft-delete mutations. */
export function createPostgresContentMutationStore(
  database: ContentMutationPostgresDatabase,
): ContentMutationStore {
  return {
    loadMutation(ownerUserId, contentId, operationId, idempotencyKey) {
      return loadMutation(database, ownerUserId, contentId, operationId, idempotencyKey)
    },

    async update(input) {
      await withTransaction(database, async (client) => {
        await insertIdempotency(client, {
          ownerUserId: input.ownerUserId,
          operationId: input.operationId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          responseStatus: 200,
          responseJson: input.responseJson,
          now: input.updatedAt,
          expiresAt: input.expiresAt,
        })
        const content = input.content
        const updated = await client.query<{ id: string }>(
          'UPDATE contents SET creator_id = $1, title = $2, body_ref = $3, media_refs_json = $4, ' +
          'cover_ref = $5, media_warning = $6, access_mode = $7, version = $8, revision = $9, ' +
          'etag = $10, updated_at = $11::timestamptz ' +
          'WHERE id = $12 AND owner_user_id = $13 AND version = $14 AND etag = $15 RETURNING id',
          [
            content.creatorId,
            content.title,
            content.bodyRef,
            JSON.stringify(content.mediaRefs),
            content.coverRef,
            content.mediaWarning ?? null,
            content.accessMode ?? 'PUBLIC',
            content.version,
            content.revision,
            content.etag,
            input.updatedAt,
            content.id,
            input.ownerUserId,
            input.expectedVersion,
            input.expectedEtag,
          ],
        )
        if (updated.rows.length !== 1) {
          throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
        }
        const revision: ContentRevision = input.revision
        await client.query(
          'INSERT INTO content_revisions ' +
          '(id, content_id, revision, content_version, actor_user_id, source_revision, operation, state, access_mode, slug, title, body_ref, media_refs_json, cover_ref, media_warning, etag, reason, correlation_id, created_at) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::timestamptz)',
          [
            revision.id,
            revision.contentId,
            revision.revision,
            revision.contentVersion,
            revision.actorUserId,
            revision.sourceRevision,
            revision.operation,
            revision.state,
            revision.accessMode ?? 'PUBLIC',
            revision.slug,
            revision.title,
            revision.bodyRef,
            JSON.stringify(revision.mediaRefs),
            revision.coverRef,
            revision.mediaWarning ?? null,
            revision.etag,
            revision.reason,
            revision.correlationId,
            revision.createdAt,
          ],
        )
        // contents_after_update_outbox emits content.updated within this transaction.
      })
    },

    async delete(input) {
      await withTransaction(database, async (client) => {
        await insertIdempotency(client, {
          ownerUserId: input.ownerUserId,
          operationId: input.operationId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          responseStatus: 204,
          responseJson: '',
          now: input.deletedAt,
          expiresAt: input.expiresAt,
        })
        const updated = await client.query<{ id: string }>(
          "UPDATE contents SET state = 'DELETED', version = $1, etag = $2, updated_at = $3::timestamptz " +
          'WHERE id = $4 AND owner_user_id = $5 AND version = $6 AND etag = $7 RETURNING id',
          [
            input.nextVersion,
            input.nextEtag,
            input.deletedAt,
            input.contentId,
            input.ownerUserId,
            input.expectedVersion,
            input.expectedEtag,
          ],
        )
        if (updated.rows.length !== 1) {
          throw new ContentRuntimeError('PRECONDITION_FAILED', 412)
        }
        // contents_after_update_outbox emits content.deleted within this transaction.
      })
    },
  }
}

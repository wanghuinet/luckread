import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import {
  createPostgresCollectionUpdateStore,
  type CollectionUpdatePostgresDatabase,
} from './content-collections-update-store-postgres.js'
import {
  type CollectionMutationSnapshot,
  type CollectionRecord,
  type CollectionUpdateStore,
  updateCollection,
} from './content-collections.js'

const existing: CollectionRecord = {
  id: 'collection_1',
  ownerUserId: 'creator_1',
  creatorId: 'creator_1',
  state: 'DRAFT',
  version: 1,
  title: 'Old title',
  description: 'Old description',
  coverRef: null,
  etag: 'W/"1"',
  createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
}

const input = {
  ownerUserId: existing.ownerUserId,
  operationId: 'updateCollection',
  idempotencyKey: 'update-key',
  requestHash: 'request-hash',
  responseJson: JSON.stringify({
    ...existing,
    title: 'New title',
    description: 'New description',
    version: 2,
    etag: 'W/"2"',
    updatedAt: '2026-11-16T01:00:00.000Z',
  }),
  updatedAt: '2026-11-16T01:00:00.000Z',
  expiresAt: '2026-11-17T01:00:00.000Z',
  expectedVersion: 1,
  expectedEtag: 'W/"1"',
  collection: {
    ...existing,
    title: 'New title',
    description: 'New description',
    version: 2,
    etag: 'W/"2"',
    updatedAt: '2026-11-16T01:00:00.000Z',
  },
}

function createDatabase(options: { duplicateIdempotency?: boolean; updateNoMatch?: boolean } = {}) {
  const directQueries: Array<{ sql: string; values?: unknown[] }> = []
  const transactionQueries: Array<{ sql: string; values?: unknown[] }> = []
  let released = false

  const client = {
    async query<Row>(sql: string, values?: unknown[]) {
      transactionQueries.push({ sql, values })
      if (options.duplicateIdempotency && sql.startsWith('INSERT INTO content_mutation_idempotency')) {
        throw Object.assign(new Error('duplicate idempotency key'), {
          code: '23505',
          constraint: 'content_mutation_idempotency_owner_user_id_operation_id_idempotency_key_key',
        })
      }
      if (sql.startsWith('UPDATE content_collections')) {
        return { rows: options.updateNoMatch ? [] as Row[] : [{ id: existing.id }] as Row[] }
      }
      return { rows: [] as Row[] }
    },
    release() {
      released = true
    },
  }

  const database: CollectionUpdatePostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.includes('FROM content_collections s')) {
        return {
          rows: [{
            id: existing.id,
            owner_user_id: existing.ownerUserId,
            creator_id: existing.creatorId,
            state: existing.state,
            version: existing.version,
            title: existing.title,
            description: existing.description,
            cover_ref: existing.coverRef,
            etag: existing.etag,
            created_at: new Date(existing.createdAt),
            updated_at: new Date(existing.updatedAt),
            idem_id: 'idem_1',
            idem_owner_user_id: existing.ownerUserId,
            idem_request_hash: 'request-hash',
            idem_status: 'COMPLETED',
            idem_response_status: 200,
            idem_response_json: JSON.stringify(existing),
            idem_expires_at: new Date('2026-11-17T00:00:00.000Z'),
          }] as Row[],
        }
      }
      return { rows: [] as Row[] }
    },
    async connect() {
      return client
    },
  }

  return {
    database,
    directQueries,
    transactionQueries,
    isReleased: () => released,
  }
}

describe('W03 Neon Collection update', () => {
  it('preserves the original D1 batch update as the default', async () => {
    const preparedSql: string[] = []
    let batchStatements: unknown[] = []
    const d1Row = {
      id: existing.id,
      owner_user_id: existing.ownerUserId,
      creator_id: existing.creatorId,
      state: existing.state,
      version: existing.version,
      title: existing.title,
      description: existing.description,
      cover_ref: existing.coverRef,
      etag: existing.etag,
      created_at: existing.createdAt,
      updated_at: existing.updatedAt,
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    }
    const database = {
      prepare(sql: string) {
        preparedSql.push(sql)
        return {
          bind() {
            return {
              async first() { return d1Row },
            }
          },
        }
      },
      async batch(statements: unknown[]) {
        batchStatements = statements
        return []
      },
    }

    const result = await updateCollection(
      database as never,
      'creator_1',
      'collection_1',
      { title: 'New title', description: 'New description' },
      'W/"1"',
      'd1-update-key',
      new Date('2026-11-16T01:00:00.000Z'),
    )

    expect(result).toMatchObject({ version: 2, etag: 'W/"2"', title: 'New title' })
    expect(batchStatements).toHaveLength(4)
    expect(preparedSql.some(sql => sql.includes('FROM content_collections s'))).toBe(true)
    expect(preparedSql.some(sql => sql.startsWith('UPDATE content_collections'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('content_txn_guard'))).toBe(true)
  })

  it('loads an owner-scoped Collection and idempotency record from PostgreSQL', async () => {
    const fixture = createDatabase()
    const store = createPostgresCollectionUpdateStore(fixture.database)

    const result = await store.loadMutation('creator_1', 'collection_1', 'updateCollection', 'update-key')

    expect(result.collection).toMatchObject({
      id: 'collection_1',
      ownerUserId: 'creator_1',
      state: 'DRAFT',
      version: 1,
      etag: 'W/"1"',
    })
    expect(result.collection?.createdAt).toBe(existing.createdAt)
    expect(result.idempotency).toMatchObject({
      id: 'idem_1',
      owner_user_id: 'creator_1',
      request_hash: 'request-hash',
      status: 'COMPLETED',
      response_status: 200,
      expires_at: '2026-11-17T00:00:00.000Z',
    })
    expect(fixture.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fixture.directQueries[0]?.sql).toContain('s.owner_user_id = $1')
    expect(fixture.directQueries[0]?.values).toEqual([
      'creator_1',
      'updateCollection',
      'update-key',
      'collection_1',
    ])
  })

  it('commits idempotency, version-checked Collection update and trigger-backed outbox in one transaction', async () => {
    const fixture = createDatabase()
    const store = createPostgresCollectionUpdateStore(fixture.database)

    await store.update(input)

    expect(fixture.transactionQueries.map(item => item.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO content_mutation_idempotency'),
      expect.stringContaining('UPDATE content_collections'),
      'COMMIT',
    ])
    const updateQuery = fixture.transactionQueries[3]
    expect(updateQuery?.sql).toContain('WHERE id = $7 AND owner_user_id = $8 AND version = $9 AND etag = $10')
    expect(updateQuery?.values).toEqual([
      input.collection.title,
      input.collection.description,
      input.collection.coverRef,
      input.collection.version,
      input.collection.etag,
      input.updatedAt,
      input.collection.id,
      input.ownerUserId,
      input.expectedVersion,
      input.expectedEtag,
    ])
    expect(fixture.isReleased()).toBe(true)
  })

  it('rolls back and returns 412 when the version/ETag changed after the owner-scoped read', async () => {
    const fixture = createDatabase({ updateNoMatch: true })
    const store = createPostgresCollectionUpdateStore(fixture.database)

    await expect(store.update(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      status: 412,
    })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('maps concurrent idempotency reservation conflicts to the existing 409 contract', async () => {
    const fixture = createDatabase({ duplicateIdempotency: true })
    const store = createPostgresCollectionUpdateStore(fixture.database)

    await expect(store.update(input)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
      status: 409,
    })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('routes Collection PATCH through the injected Neon store without touching D1', async () => {
    const update = vi.fn(async (_input: Parameters<CollectionUpdateStore['update']>[0]) => undefined)
    const snapshot: CollectionMutationSnapshot = { collection: existing, idempotency: null }
    const store: CollectionUpdateStore = {
      loadMutation: vi.fn(async () => snapshot),
      update,
    }
    const database = {
      prepare() {
        throw new Error('D1 must not be queried for Neon Collection updates')
      },
      batch() {
        throw new Error('D1 must not be used for Neon Collection updates')
      },
    }
    const worker = createW03ContentWorker({
      collectionUpdateStoreProvider: () => store,
    })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/collections/collection_1', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'collection-update-neon-test',
          'X-LuckRead-Principal-User-Id': 'creator_1',
          'X-LuckRead-Principal-Layer': 'L3',
          'If-Match': 'W/"1"',
          'Idempotency-Key': 'collection-update-neon-key',
        },
        body: JSON.stringify({ title: 'New title', description: 'New description' }),
      }),
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(store.loadMutation).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: 'creator_1',
      operationId: 'updateCollection',
      idempotencyKey: 'collection-update-neon-key',
      expectedVersion: 1,
      expectedEtag: 'W/"1"',
      collection: {
        id: 'collection_1',
        version: 2,
        etag: 'W/"2"',
        title: 'New title',
      },
    })
  })
})

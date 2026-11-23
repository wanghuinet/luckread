import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import {
  createPostgresCollectionDeleteStore,
} from './content-collections-delete-store-postgres.js'
import type { CollectionUpdatePostgresDatabase } from './content-collections-update-store-postgres.js'
import {
  deleteCollection,
  type CollectionDeleteStore,
  type CollectionMutationSnapshot,
  type CollectionRecord,
} from './content-collections.js'

const existing: CollectionRecord = {
  id: 'collection_1',
  ownerUserId: 'creator_1',
  creatorId: 'creator_1',
  state: 'DRAFT',
  version: 1,
  title: 'My collection',
  description: 'A short description',
  coverRef: null,
  etag: 'W/"1"',
  createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
}

const deleteInput: Parameters<CollectionDeleteStore['delete']>[0] = {
  ownerUserId: existing.ownerUserId,
  operationId: 'deleteCollection',
  idempotencyKey: 'delete-key',
  requestHash: 'request-hash',
  deletedAt: '2026-11-16T01:00:00.000Z',
  expiresAt: '2026-11-17T01:00:00.000Z',
  collectionId: existing.id,
  expectedVersion: 1,
  expectedEtag: 'W/"1"',
  nextVersion: 2,
  nextEtag: 'W/"2"',
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
            idem_id: null,
            idem_owner_user_id: null,
            idem_request_hash: null,
            idem_status: null,
            idem_response_status: null,
            idem_response_json: null,
            idem_expires_at: null,
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

describe('W03 Neon Collection deletion', () => {
  it('loads the existing owner-scoped Collection mutation snapshot from PostgreSQL', async () => {
    const fixture = createDatabase()
    const store = createPostgresCollectionDeleteStore(fixture.database)

    const result = await store.loadMutation('creator_1', 'collection_1', 'deleteCollection', 'delete-key')

    expect(result.collection).toMatchObject({
      id: 'collection_1',
      ownerUserId: 'creator_1',
      state: 'DRAFT',
      version: 1,
      etag: 'W/"1"',
    })
    expect(fixture.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fixture.directQueries[0]?.sql).toContain('s.owner_user_id = $1')
    expect(fixture.directQueries[0]?.values).toEqual([
      'creator_1',
      'deleteCollection',
      'delete-key',
      'collection_1',
    ])
  })

  it('commits idempotency, version-checked soft deletion and trigger-backed outbox in one transaction', async () => {
    const fixture = createDatabase()
    const store = createPostgresCollectionDeleteStore(fixture.database)

    await store.delete(deleteInput)

    expect(fixture.transactionQueries.map(item => item.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO content_mutation_idempotency'),
      expect.stringContaining('UPDATE content_collections'),
      'COMMIT',
    ])
    const updateQuery = fixture.transactionQueries[3]
    expect(updateQuery?.sql).toContain("SET state = 'DELETED'")
    expect(updateQuery?.sql).toContain('WHERE id = $4 AND owner_user_id = $5 AND version = $6 AND etag = $7')
    expect(updateQuery?.values).toEqual([
      2,
      'W/"2"',
      deleteInput.deletedAt,
      deleteInput.collectionId,
      deleteInput.ownerUserId,
      deleteInput.expectedVersion,
      deleteInput.expectedEtag,
    ])
    expect(fixture.transactionQueries[2]?.values).toEqual(expect.arrayContaining([
      'creator_1',
      'deleteCollection',
      'delete-key',
      'request-hash',
    ]))
    expect(fixture.isReleased()).toBe(true)
  })

  it('rolls back and returns 412 when the Collection version or ETag changes', async () => {
    const fixture = createDatabase({ updateNoMatch: true })
    const store = createPostgresCollectionDeleteStore(fixture.database)

    await expect(store.delete(deleteInput)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      status: 412,
    })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('maps a concurrent idempotency reservation conflict to the existing 409 contract', async () => {
    const fixture = createDatabase({ duplicateIdempotency: true })
    const store = createPostgresCollectionDeleteStore(fixture.database)

    await expect(store.delete(deleteInput)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
      status: 409,
    })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('routes Collection DELETE through the injected Neon store without touching D1', async () => {
    const remove = vi.fn(async (_input: Parameters<CollectionDeleteStore['delete']>[0]) => undefined)
    const snapshot: CollectionMutationSnapshot = { collection: existing, idempotency: null }
    const store: CollectionDeleteStore = {
      loadMutation: vi.fn(async () => snapshot),
      delete: remove,
    }
    const database = {
      prepare() {
        throw new Error('D1 must not be queried for Neon Collection deletion')
      },
      batch() {
        throw new Error('D1 must not be used for Neon Collection deletion')
      },
    }
    const worker = createW03ContentWorker({
      collectionDeleteStoreProvider: () => store,
    })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/collections/collection_1', {
        method: 'DELETE',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'collection-delete-neon-test',
          'X-LuckRead-Principal-User-Id': 'creator_1',
          'X-LuckRead-Principal-Layer': 'L3',
          'If-Match': 'W/"1"',
          'Idempotency-Key': 'collection-delete-neon-key',
        },
      }),
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(store.loadMutation).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(remove.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: 'creator_1',
      operationId: 'deleteCollection',
      idempotencyKey: 'collection-delete-neon-key',
      expectedVersion: 1,
      expectedEtag: 'W/"1"',
      nextVersion: 2,
      nextEtag: 'W/"2"',
    })
  })
})

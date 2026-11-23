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
  it('preserves the original D1 batch delete as the default', async () => {
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

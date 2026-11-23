import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import {
  createPostgresCollectionMemberAttachStore,
  type CollectionMemberAttachPostgresDatabase,
} from './content-collection-member-attach-store-postgres.js'
import {
  attachCollectionMember,
  type CollectionMemberAttachStore,
  type CollectionMemberMutationRow,
} from './content-collection-members.js'

const snapshot: CollectionMemberMutationRow = {
  collection_id: 'collection_1',
  collection_owner_user_id: 'creator_1',
  collection_state: 'DRAFT',
  collection_version: 4,
  collection_etag: 'W/"4"',
  content_id: 'content_1',
  content_owner_user_id: 'creator_1',
  content_slug: 'episode-1',
  content_type: 'article',
  content_state: 'PUBLISHED',
  content_title: 'Episode 1',
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_status: null,
  idem_response_json: null,
  idem_expires_at: null,
  membership_relationship_id: null,
  membership_position: null,
  membership_created_at: null,
  membership_updated_at: null,
  next_position: 2,
}

function createDatabase(options: {
  updateNoMatch?: boolean
  duplicateIdempotency?: boolean
  duplicateRelationship?: boolean
} = {}) {
  const directQueries: Array<{ sql: string; values?: unknown[] }> = []
  const transactionQueries: Array<{ sql: string; values?: unknown[] }> = []
  let released = false

  const client = {
    async query<Row>(sql: string, values?: unknown[]) {
      transactionQueries.push({ sql, values })
      if (options.duplicateIdempotency &&
          sql.startsWith('INSERT INTO content_mutation_idempotency')) {
        throw Object.assign(new Error('duplicate idempotency key'), {
          code: '23505',
          constraint: 'content_mutation_idempotency_owner_user_id_operation_id_idempotency_key_key',
        })
      }
      if (options.updateNoMatch && sql.startsWith('UPDATE content_collections')) {
        return { rows: [] as Row[] }
      }
      if (options.duplicateRelationship &&
          sql.startsWith('INSERT INTO content_relationships')) {
        throw Object.assign(new Error('duplicate relationship'), {
          code: '23505',
          constraint: 'content_relationships_active_unique_idx',
        })
      }
      if (sql.startsWith('UPDATE content_collections')) {
        return { rows: [{ id: 'collection_1' }] as Row[] }
      }
      return { rows: [] as Row[] }
    },
    release() {
      released = true
    },
  }

  const database: CollectionMemberAttachPostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.includes('FROM content_collections coll')) {
        return {
          rows: [{
            ...snapshot,
            idem_expires_at: null,
            membership_created_at: null,
            membership_updated_at: null,
          }] as Row[],
        }
      }
      return { rows: [] as Row[] }
    },
    async connect() {
      return client
    },
  }

  return { database, directQueries, transactionQueries, isReleased: () => released }
}

describe('W03 Neon Collection member attachment', () => {
  it('keeps the original D1 batch implementation as the default', async () => {
    const preparedSql: string[] = []
    let batchStatements: unknown[] = []
    const dbRow = { ...snapshot }
    const worker = createW03ContentWorker({
      collectionMemberAttachStoreProvider: () => store,
    })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/collections/collection_1/members', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'collection-member-attach-neon-test',
          'X-LuckRead-Principal-User-Id': 'creator_1',
          'X-LuckRead-Principal-Layer': 'L3',
          'If-Match': 'W/"4"',
          'Idempotency-Key': 'collection-member-attach-neon-key',
        },
        body: JSON.stringify({ contentId: 'content_1' }),
      }),
      {} as never,
    )

    expect(response.status).toBe(201)
    expect(store.loadMutation).toHaveBeenCalledOnce()
    expect(attach).toHaveBeenCalledOnce()
    expect(attach.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: 'creator_1',
      operationId: 'attachCollectionMember',
      idempotencyKey: 'collection-member-attach-neon-key',
      collectionId: 'collection_1',
      contentId: 'content_1',
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      nextVersion: 5,
      collectionEtag: 'W/"5"',
      position: 2,
    })
  })
})

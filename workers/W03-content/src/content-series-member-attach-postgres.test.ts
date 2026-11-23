import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import {
  createPostgresSeriesMemberAttachStore,
  type SeriesMemberAttachPostgresDatabase,
} from './content-series-member-attach-store-postgres.js'
import {
  attachSeriesMember,
  type SeriesMemberAttachStore,
  type SeriesMemberMutationRow,
} from './content-series-members.js'

const snapshot: SeriesMemberMutationRow = {
  series_id: 'series_1',
  series_owner_user_id: 'creator_1',
  series_state: 'DRAFT',
  series_version: 4,
  series_etag: 'W/"4"',
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
      if (options.updateNoMatch && sql.startsWith('UPDATE content_series')) {
        return { rows: [] as Row[] }
      }
      if (options.duplicateRelationship &&
          sql.startsWith('INSERT INTO content_relationships')) {
        throw Object.assign(new Error('duplicate relationship'), {
          code: '23505',
          constraint: 'content_relationships_active_unique_idx',
        })
      }
      if (sql.startsWith('UPDATE content_series')) {
        return { rows: [{ id: 'series_1' }] as Row[] }
      }
      return { rows: [] as Row[] }
    },
    release() {
      released = true
    },
  }

  const database: SeriesMemberAttachPostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.includes('FROM content_series s')) {
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

describe('W03 Neon Series member attachment', () => {
  it('keeps the original D1 batch implementation as the default', async () => {
    const preparedSql: string[] = []
    let batchStatements: unknown[] = []
    const dbRow = { ...snapshot }
    const worker = createW03ContentWorker({
      seriesMemberAttachStoreProvider: () => store,
    })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/series/series_1/members', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'series-member-attach-neon-test',
          'X-LuckRead-Principal-User-Id': 'creator_1',
          'X-LuckRead-Principal-Layer': 'L3',
          'If-Match': 'W/"4"',
          'Idempotency-Key': 'series-member-attach-neon-key',
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
      operationId: 'attachSeriesMember',
      idempotencyKey: 'series-member-attach-neon-key',
      seriesId: 'series_1',
      contentId: 'content_1',
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      nextVersion: 5,
      seriesEtag: 'W/"5"',
      position: 2,
    })
  })
})

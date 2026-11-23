import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import {
  createPostgresSeriesDeleteStore,
} from './content-series-delete-store-postgres.js'
import type { SeriesUpdatePostgresDatabase } from './content-series-update-store-postgres.js'
import {
  deleteSeries,
  type SeriesDeleteStore,
  type SeriesMutationSnapshot,
  type SeriesRecord,
} from './content-series.js'

const existing: SeriesRecord = {
  id: 'series_1',
  ownerUserId: 'creator_1',
  creatorId: 'creator_1',
  ipId: null,
  state: 'DRAFT',
  version: 3,
  title: 'Series 1',
  description: 'Description',
  coverRef: null,
  etag: 'W/"3"',
  createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
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
      if (sql.startsWith('UPDATE content_series')) {
        return { rows: options.updateNoMatch ? [] as Row[] : [{ id: existing.id }] as Row[] }
      }
      return { rows: [] as Row[] }
    },
    release() {
      released = true
    },
  }

  const database: SeriesUpdatePostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.includes('FROM content_series s')) {
        return {
          rows: [{
            id: existing.id,
            owner_user_id: existing.ownerUserId,
            creator_id: existing.creatorId,
            ip_id: existing.ipId,
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

  return { database, directQueries, transactionQueries, isReleased: () => released }
}

describe('W03 Neon Series delete', () => {
  it('preserves the original D1 batch soft-delete implementation as the default', async () => {
    const preparedSql: string[] = []
    let batchStatements: unknown[] = []
    const d1Row = {
      id: existing.id,
      owner_user_id: existing.ownerUserId,
      creator_id: existing.creatorId,
      ip_id: existing.ipId,
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
      seriesDeleteStoreProvider: () => store,
    })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/series/series_1', {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'series-delete-neon-test',
          'X-LuckRead-Principal-User-Id': 'creator_1',
          'X-LuckRead-Principal-Layer': 'L3',
          'If-Match': 'W/"3"',
          'Idempotency-Key': 'series-delete-neon-key',
        },
      }),
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(store.loadMutation).toHaveBeenCalledOnce()
    expect(deleteMutation).toHaveBeenCalledOnce()
    expect(deleteMutation.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: 'creator_1',
      operationId: 'deleteSeries',
      idempotencyKey: 'series-delete-neon-key',
      expectedVersion: 3,
      expectedEtag: 'W/"3"',
      seriesId: 'series_1',
      nextVersion: 4,
      nextEtag: 'W/"4"',
    })
  })
})

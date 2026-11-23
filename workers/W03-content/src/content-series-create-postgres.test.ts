import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import {
  createPostgresSeriesCreateStore,
  type SeriesCreatePostgresDatabase,
} from './content-series-create-store-postgres.js'
import {
  createSeries,
  type SeriesCreateStore,
  type SeriesRecord,
} from './content-series.js'

const series: SeriesRecord = {
  id: 'series_1',
  ownerUserId: 'creator_1',
  creatorId: 'creator_1',
  ipId: null,
  state: 'DRAFT',
  version: 1,
  title: 'My series',
  description: 'A short description',
  coverRef: null,
  etag: 'W/"1"',
  createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
}

function createDatabase(options: { duplicateIdempotency?: boolean } = {}) {
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
      return { rows: [] as Row[] }
    },
    release() {
      released = true
    },
  }

  const database: SeriesCreatePostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.startsWith('SELECT id, owner_user_id, request_hash')) {
        return {
          rows: [{
            id: 'idem_1',
            owner_user_id: series.ownerUserId,
            request_hash: 'hash_1',
            status: 'COMPLETED',
            response_status: 201,
            response_json: JSON.stringify(series),
            expires_at: new Date('2026-11-17T00:00:00.000Z'),
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

describe('W03 Neon Series creation', () => {
  it('preserves the original D1 batch implementation as the default', async () => {
    const preparedSql: string[] = []
    let batchStatements: unknown[] = []
    const worker = createW03ContentWorker({
      seriesCreateStoreProvider: () => store,
    })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/series', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'series-create-neon-test',
          'X-LuckRead-Principal-User-Id': 'creator_1',
          'X-LuckRead-Principal-Layer': 'L3',
          'Idempotency-Key': 'series-create-neon-key',
        },
        body: JSON.stringify({ title: 'My series', description: 'A short description' }),
      }),
      {} as never,
    )

    expect(response.status).toBe(201)
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: 'creator_1',
      operationId: 'createSeries',
      idempotencyKey: 'series-create-neon-key',
      series: { state: 'DRAFT', ipId: null, title: 'My series' },
    })
  })
})

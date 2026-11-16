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
    const database = {
      prepare(sql: string) {
        preparedSql.push(sql)
        return {
          bind() {
            return {
              async first() { return null },
            }
          },
        }
      },
      async batch(statements: unknown[]) {
        batchStatements = statements
        return []
      },
    }

    const created = await createSeries(
      database as never,
      'creator_1',
      { title: 'My series', description: 'A short description' },
      'd1-series-key',
      new Date('2026-11-16T00:00:00.000Z'),
    )

    expect(created).toMatchObject({
      ownerUserId: 'creator_1',
      creatorId: 'creator_1',
      ipId: null,
      state: 'DRAFT',
      title: 'My series',
    })
    expect(batchStatements).toHaveLength(4)
    expect(preparedSql.some(sql => sql.includes('FROM content_mutation_idempotency'))).toBe(true)
    expect(preparedSql.some(sql => sql.startsWith('INSERT INTO content_series'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('content_txn_guard'))).toBe(true)
  })

  it('reads the existing D1-02 idempotency row from PostgreSQL with normalized expiry', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesCreateStore(fixture.database)

    const row = await store.loadIdempotency('creator_1', 'createSeries', 'series-key')

    expect(row).toEqual({
      id: 'idem_1',
      owner_user_id: 'creator_1',
      request_hash: 'hash_1',
      status: 'COMPLETED',
      response_status: 201,
      response_json: JSON.stringify(series),
      expires_at: '2026-11-17T00:00:00.000Z',
    })
    expect(fixture.directQueries[0]?.sql).toContain('FROM content_mutation_idempotency')
    expect(fixture.directQueries[0]?.values).toEqual(['creator_1', 'createSeries', 'series-key'])
  })

  it('commits idempotency, Series row and trigger-backed outbox event in one transaction', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesCreateStore(fixture.database)

    await store.create({
      ownerUserId: series.ownerUserId,
      operationId: 'createSeries',
      idempotencyKey: 'series-key',
      requestHash: 'request-hash',
      responseJson: JSON.stringify(series),
      createdAt: series.createdAt,
      expiresAt: '2026-11-17T00:00:00.000Z',
      series,
    })

    expect(fixture.transactionQueries.map(item => item.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO content_series'),
      'COMMIT',
    ])
    expect(fixture.transactionQueries[3]?.values).toEqual([
      series.id,
      series.ownerUserId,
      series.creatorId,
      null,
      series.title,
      series.description,
      series.coverRef,
      series.etag,
      series.createdAt,
      series.updatedAt,
    ])
    expect(fixture.isReleased()).toBe(true)
  })

  it('maps concurrent idempotency reservation conflicts to 409 and rolls back', async () => {
    const fixture = createDatabase({ duplicateIdempotency: true })
    const store = createPostgresSeriesCreateStore(fixture.database)

    await expect(store.create({
      ownerUserId: series.ownerUserId,
      operationId: 'createSeries',
      idempotencyKey: 'series-key',
      requestHash: 'request-hash',
      responseJson: JSON.stringify(series),
      createdAt: series.createdAt,
      expiresAt: '2026-11-17T00:00:00.000Z',
      series,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 })

    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('routes Series POST through the injected Neon store without touching D1', async () => {
    const create = vi.fn(async (_input: Parameters<SeriesCreateStore['create']>[0]) => undefined)
    const store: SeriesCreateStore = {
      loadIdempotency: vi.fn(async () => null),
      create,
    }
    const database = {
      prepare() {
        throw new Error('D1 must not be queried for Neon Series creation')
      },
      batch() {
        throw new Error('D1 must not be used for Neon Series creation')
      },
    }
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
      { D1_02: database } as never,
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

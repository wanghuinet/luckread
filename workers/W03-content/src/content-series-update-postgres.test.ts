import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import {
  createPostgresSeriesUpdateStore,
  type SeriesUpdatePostgresDatabase,
} from './content-series-update-store-postgres.js'
import {
  updateSeries,
  type SeriesMutationSnapshot,
  type SeriesRecord,
  type SeriesUpdateStore,
} from './content-series.js'

const existing: SeriesRecord = {
  id: 'series_1',
  ownerUserId: 'creator_1',
  creatorId: 'creator_1',
  ipId: null,
  state: 'DRAFT',
  version: 3,
  title: 'Original title',
  description: 'Original description',
  coverRef: null,
  etag: 'W/"3"',
  createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
}

const updateInput: Parameters<SeriesUpdateStore['update']>[0] = {
  ownerUserId: existing.ownerUserId,
  operationId: 'updateSeries',
  idempotencyKey: 'update-key',
  requestHash: 'request-hash',
  responseJson: JSON.stringify({ ...existing, title: 'Changed title' }),
  updatedAt: '2026-11-16T01:00:00.000Z',
  expiresAt: '2026-11-17T01:00:00.000Z',
  series: {
    ...existing,
    title: 'Changed title',
    description: 'Changed description',
    version: 4,
    etag: 'W/"4"',
    updatedAt: '2026-11-16T01:00:00.000Z',
  },
  expectedVersion: 3,
  expectedEtag: 'W/"3"',
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

describe('W03 Neon Series update', () => {
  it('loads the owner-scoped Series and idempotency snapshot from PostgreSQL', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesUpdateStore(fixture.database)

    const result = await store.loadMutation('creator_1', 'series_1', 'updateSeries', 'update-key')

    expect(result.series).toMatchObject({
      id: 'series_1',
      ownerUserId: 'creator_1',
      state: 'DRAFT',
      version: 3,
      etag: 'W/"3"',
    })
    expect(result.idempotency).toBeNull()
    expect(fixture.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fixture.directQueries[0]?.sql).toContain('s.owner_user_id = $1')
    expect(fixture.directQueries[0]?.values).toEqual([
      'creator_1',
      'updateSeries',
      'update-key',
      'series_1',
    ])
  })

  it('commits idempotency, version-checked Series update and trigger-backed outbox together', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesUpdateStore(fixture.database)

    await store.update(updateInput)

    expect(fixture.transactionQueries.map(item => item.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO content_mutation_idempotency'),
      expect.stringContaining('UPDATE content_series'),
      'COMMIT',
    ])
    const updateQuery = fixture.transactionQueries[3]
    expect(updateQuery?.sql).toContain('WHERE id = $7 AND owner_user_id = $8 AND version = $9 AND etag = $10')
    expect(updateQuery?.values).toEqual([
      'Changed title',
      'Changed description',
      null,
      4,
      'W/"4"',
      updateInput.updatedAt,
      'series_1',
      'creator_1',
      3,
      'W/"3"',
    ])
    expect(fixture.transactionQueries[2]?.values).toEqual(expect.arrayContaining([
      'creator_1',
      'updateSeries',
      'update-key',
      'request-hash',
      updateInput.responseJson,
    ]))
    expect(fixture.isReleased()).toBe(true)
  })

  it('rolls back and returns 412 when the Series version or ETag changes', async () => {
    const fixture = createDatabase({ updateNoMatch: true })
    const store = createPostgresSeriesUpdateStore(fixture.database)

    await expect(store.update(updateInput)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      status: 412,
    })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('maps a concurrent idempotency reservation conflict to the existing 409 contract', async () => {
    const fixture = createDatabase({ duplicateIdempotency: true })
    const store = createPostgresSeriesUpdateStore(fixture.database)

    await expect(store.update(updateInput)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
      status: 409,
    })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('routes Series PATCH through the injected Neon store without touching D1', async () => {
    const update = vi.fn(async (_input: Parameters<SeriesUpdateStore['update']>[0]) => undefined)
    const snapshot: SeriesMutationSnapshot = { series: existing, idempotency: null }
    const store: SeriesUpdateStore = {
      loadMutation: vi.fn(async () => snapshot),
      update,
    }
    const database = {
      prepare() {
        throw new Error('D1 must not be queried for Neon Series update')
      },
      batch() {
        throw new Error('D1 must not be used for Neon Series update')
      },
    }
    const worker = createW03ContentWorker({
      seriesUpdateStoreProvider: () => store,
    })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/series/series_1', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'series-update-neon-test',
          'X-LuckRead-Principal-User-Id': 'creator_1',
          'X-LuckRead-Principal-Layer': 'L3',
          'If-Match': 'W/"3"',
          'Idempotency-Key': 'series-update-neon-key',
        },
        body: JSON.stringify({ title: 'Changed title', description: 'Changed description' }),
      }),
      { D1_02: database } as never,
    )

    expect(response.status).toBe(200)
    expect(store.loadMutation).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: 'creator_1',
      operationId: 'updateSeries',
      idempotencyKey: 'series-update-neon-key',
      expectedVersion: 3,
      expectedEtag: 'W/"3"',
      series: { version: 4, etag: 'W/"4"', title: 'Changed title' },
    })
  })
})

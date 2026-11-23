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
  it('loads the owner-scoped Series and idempotency snapshot from PostgreSQL', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesDeleteStore(fixture.database)

    const result = await store.loadMutation('creator_1', 'series_1', 'deleteSeries', 'delete-key')

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
      'deleteSeries',
      'delete-key',
      'series_1',
    ])
  })

  it('commits the 204 idempotency record and soft delete in one transaction', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesDeleteStore(fixture.database)
    const input: Parameters<SeriesDeleteStore['delete']>[0] = {
      ownerUserId: 'creator_1',
      operationId: 'deleteSeries',
      idempotencyKey: 'delete-key',
      requestHash: 'delete-hash',
      deletedAt: '2026-11-16T01:00:00.000Z',
      expiresAt: '2026-11-17T01:00:00.000Z',
      seriesId: 'series_1',
      nextVersion: 4,
      nextEtag: 'W/"4"',
      expectedVersion: 3,
      expectedEtag: 'W/"3"',
    }

    await store.delete(input)

    expect(fixture.transactionQueries.map(item => item.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO content_mutation_idempotency'),
      expect.stringContaining('UPDATE content_series'),
      'COMMIT',
    ])
    expect(fixture.transactionQueries[2]?.sql).toContain("'COMPLETED', 204, ''")
    expect(fixture.transactionQueries[2]?.values).toEqual(expect.arrayContaining([
      'creator_1',
      'deleteSeries',
      'delete-key',
      'delete-hash',
      '2026-11-16T01:00:00.000Z',
      '2026-11-17T01:00:00.000Z',
    ]))
    expect(fixture.transactionQueries[3]?.sql).toContain("SET state = 'DELETED'")
    expect(fixture.transactionQueries[3]?.sql).toContain(
      'WHERE id = $4 AND owner_user_id = $5 AND version = $6 AND etag = $7',
    )
    expect(fixture.transactionQueries[3]?.values).toEqual([
      4, 'W/"4"', input.deletedAt, 'series_1', 'creator_1', 3, 'W/"3"',
    ])
    expect(fixture.isReleased()).toBe(true)
  })

  it('rolls back and returns 412 when the Series version or ETag has changed', async () => {
    const fixture = createDatabase({ updateNoMatch: true })
    const store = createPostgresSeriesDeleteStore(fixture.database)

    await expect(store.delete({
      ownerUserId: 'creator_1',
      operationId: 'deleteSeries',
      idempotencyKey: 'delete-key',
      requestHash: 'delete-hash',
      deletedAt: '2026-11-16T01:00:00.000Z',
      expiresAt: '2026-11-17T01:00:00.000Z',
      seriesId: 'series_1',
      nextVersion: 4,
      nextEtag: 'W/"4"',
      expectedVersion: 3,
      expectedEtag: 'W/"3"',
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('maps a concurrent idempotency reservation conflict to the existing 409 contract', async () => {
    const fixture = createDatabase({ duplicateIdempotency: true })
    const store = createPostgresSeriesDeleteStore(fixture.database)

    await expect(store.delete({
      ownerUserId: 'creator_1',
      operationId: 'deleteSeries',
      idempotencyKey: 'delete-key',
      requestHash: 'delete-hash',
      deletedAt: '2026-11-16T01:00:00.000Z',
      expiresAt: '2026-11-17T01:00:00.000Z',
      seriesId: 'series_1',
      nextVersion: 4,
      nextEtag: 'W/"4"',
      expectedVersion: 3,
      expectedEtag: 'W/"3"',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('routes Series DELETE through the injected Neon store without touching D1', async () => {
    const deleteMutation = vi.fn(async (_input: Parameters<SeriesDeleteStore['delete']>[0]) => undefined)
    const snapshot: SeriesMutationSnapshot = { series: existing, idempotency: null }
    const store: SeriesDeleteStore = {
      loadMutation: vi.fn(async () => snapshot),
      delete: deleteMutation,
    }
    const database = {
      prepare() {
        throw new Error('D1 must not be queried for Neon Series delete')
      },
      batch() {
        throw new Error('D1 must not be used for Neon Series delete')
      },
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

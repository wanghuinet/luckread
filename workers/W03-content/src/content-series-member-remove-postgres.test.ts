import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import {
  createPostgresSeriesMemberRemoveStore,
  type SeriesMemberRemovePostgresDatabase,
} from './content-series-member-remove-store-postgres.js'
import {
  removeSeriesMember,
  type SeriesMemberRemoveStore,
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
  membership_relationship_id: 'relationship_1',
  membership_position: 2,
  membership_created_at: '2026-11-16T02:00:00.000Z',
  membership_updated_at: '2026-11-16T02:00:00.000Z',
  next_position: 2,
}

function createDatabase(options: {
  updateNoMatch?: boolean
  revokeNoMatch?: boolean
  duplicateIdempotency?: boolean
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
      if (options.updateNoMatch && sql.startsWith('UPDATE content_series')) return { rows: [] as Row[] }
      if (options.revokeNoMatch && sql.startsWith('UPDATE content_relationships')) return { rows: [] as Row[] }
      if (sql.startsWith('UPDATE content_series')) return { rows: [{ id: 'series_1' }] as Row[] }
      if (sql.startsWith('UPDATE content_relationships')) return { rows: [{ relationship_id: 'relationship_1' }] as Row[] }
      return { rows: [] as Row[] }
    },
    release() { released = true },
  }

  const database: SeriesMemberRemovePostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.includes('FROM content_series s')) {
        return {
          rows: [{
            ...snapshot,
            idem_expires_at: null,
            membership_created_at: new Date('2026-11-16T02:00:00.000Z'),
            membership_updated_at: new Date('2026-11-16T02:00:00.000Z'),
          }] as Row[],
        }
      }
      return { rows: [] as Row[] }
    },
    async connect() { return client },
  }

  return { database, directQueries, transactionQueries, isReleased: () => released }
}

const removeInput = {
  ownerUserId: 'creator_1',
  operationId: 'removeSeriesMember',
  idempotencyKey: 'remove-key',
  requestHash: 'request-hash',
  responseJson: '{"member":{}}',
  nowIso: '2026-11-16T03:00:00.000Z',
  expiresAt: '2026-11-17T03:00:00.000Z',
  seriesId: 'series_1',
  contentId: 'content_1',
  relationshipId: 'relationship_1',
  nextVersion: 5,
  seriesEtag: 'W/"5"',
  expectedVersion: 4,
  expectedEtag: 'W/"4"',
}

describe('W03 Neon Series member removal', () => {
  it('loads owner-scoped Series/content, idempotency and active membership from PostgreSQL', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesMemberRemoveStore(fixture.database)

    await expect(store.loadMutation(
      'creator_1', 'series_1', 'content_1', 'removeSeriesMember', 'remove-key',
    )).resolves.toMatchObject({
      series_owner_user_id: 'creator_1',
      content_owner_user_id: 'creator_1',
      series_version: 4,
      membership_relationship_id: 'relationship_1',
      membership_position: 2,
      membership_created_at: '2026-11-16T02:00:00.000Z',
    })

    expect(fixture.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fixture.directQueries[0]?.sql).toContain('s.owner_user_id = $6')
    expect(fixture.directQueries[0]?.sql).toContain("r.status = 'ACTIVE'")
    expect(fixture.directQueries[0]?.values).toEqual([
      'content_1', 'creator_1', 'removeSeriesMember', 'remove-key', 'series_1', 'creator_1',
    ])
  })

  it('commits idempotency, Series version/ETag and relationship revocation together', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesMemberRemoveStore(fixture.database)

    await store.remove(removeInput)

    expect(fixture.transactionQueries.map(item => item.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO content_mutation_idempotency'),
      expect.stringContaining('UPDATE content_series'),
      expect.stringContaining('UPDATE content_relationships'),
      'COMMIT',
    ])
    expect(fixture.transactionQueries[2]?.sql).toContain("'COMPLETED', 200")
    expect(fixture.transactionQueries[3]?.sql).toContain(
      'WHERE id = $4 AND owner_user_id = $5 AND version = $6 AND etag = $7 RETURNING id',
    )
    expect(fixture.transactionQueries[4]?.sql).toContain("status = 'REVOKED'")
    expect(fixture.transactionQueries[4]?.sql).toContain("status = 'ACTIVE' RETURNING relationship_id")
    expect(fixture.transactionQueries[4]?.values).toEqual([
      '2026-11-16T03:00:00.000Z', 'relationship_1', 'content_1', 'series_1',
    ])
    expect(fixture.isReleased()).toBe(true)
  })

  it('rolls back when the Series version/ETag or active member guard no longer matches', async () => {
    const staleSeries = createDatabase({ updateNoMatch: true })
    await expect(createPostgresSeriesMemberRemoveStore(staleSeries.database).remove(removeInput))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
    expect(staleSeries.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(staleSeries.isReleased()).toBe(true)

    const staleMembership = createDatabase({ revokeNoMatch: true })
    await expect(createPostgresSeriesMemberRemoveStore(staleMembership.database).remove(removeInput))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
    expect(staleMembership.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(staleMembership.isReleased()).toBe(true)
  })

  it('maps a competing idempotency key to the existing 409 response', async () => {
    const store = createPostgresSeriesMemberRemoveStore(
      createDatabase({ duplicateIdempotency: true }).database,
    )
    await expect(store.remove(removeInput))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 })
  })

  it('routes DELETE through Neon', async () => {
    const remove = vi.fn(async (_input: Parameters<SeriesMemberRemoveStore['remove']>[0]) => undefined)
    const store: SeriesMemberRemoveStore = {
      loadMutation: vi.fn(async () => snapshot),
      remove,
    }
    const worker = createW03ContentWorker({
      seriesMemberRemoveStoreProvider: () => store,
    })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/series/series_1/members/content_1', {
        method: 'DELETE',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'series-member-remove-neon-test',
          'X-LuckRead-Principal-User-Id': 'creator_1',
          'X-LuckRead-Principal-Layer': 'L3',
          'If-Match': 'W/"4"',
          'Idempotency-Key': 'series-member-remove-neon-key',
        },
      }),
      {} as never,
    )

    expect(response.status).toBe(200)
    expect(store.loadMutation).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(remove.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: 'creator_1',
      operationId: 'removeSeriesMember',
      idempotencyKey: 'series-member-remove-neon-key',
      seriesId: 'series_1',
      contentId: 'content_1',
      relationshipId: 'relationship_1',
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      nextVersion: 5,
      seriesEtag: 'W/"5"',
    })
  })
})

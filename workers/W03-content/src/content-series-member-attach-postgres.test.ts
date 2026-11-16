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
    const db = {
      prepare(sql: string) {
        preparedSql.push(sql)
        return {
          bind() {
            return {
              async first() { return dbRow },
            }
          },
        }
      },
      async batch(statements: unknown[]) {
        batchStatements = statements
        return []
      },
    }

    const result = await attachSeriesMember(
      db as never,
      'creator_1',
      'series_1',
      { contentId: 'content_1' },
      'W/"4"',
      'd1-attach-key',
      new Date('2026-11-16T02:00:00.000Z'),
    )

    expect(result).toMatchObject({
      member: {
        seriesId: 'series_1',
        contentId: 'content_1',
        position: 2,
      },
      seriesVersion: 5,
      seriesEtag: 'W/"5"',
    })
    expect(batchStatements).toHaveLength(5)
    expect(preparedSql.some(sql => sql.includes('FROM content_series s'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('INSERT INTO content_relationships'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('content_txn_guard'))).toBe(true)
  })

  it('loads owner, content, active membership, idempotency and next position from PostgreSQL', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesMemberAttachStore(fixture.database)

    await expect(store.loadMutation(
      'creator_1',
      'series_1',
      'content_1',
      'attachSeriesMember',
      'attach-key',
    )).resolves.toMatchObject({
      series_owner_user_id: 'creator_1',
      content_owner_user_id: 'creator_1',
      series_version: 4,
      membership_relationship_id: null,
      next_position: 2,
    })

    expect(fixture.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fixture.directQueries[0]?.sql).toContain('s.owner_user_id = $6')
    expect(fixture.directQueries[0]?.sql).toContain("r.relation_type = 'series-member'")
    expect(fixture.directQueries[0]?.values).toEqual([
      'content_1',
      'creator_1',
      'attachSeriesMember',
      'attach-key',
      'series_1',
      'creator_1',
    ])
  })

  it('commits idempotency, parent version/ETag and the Series relationship together', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesMemberAttachStore(fixture.database)

    await store.attach({
      ownerUserId: 'creator_1',
      operationId: 'attachSeriesMember',
      idempotencyKey: 'attach-key',
      requestHash: 'request-hash',
      responseJson: '{"member":{}}',
      nowIso: '2026-11-16T02:00:00.000Z',
      expiresAt: '2026-11-17T02:00:00.000Z',
      seriesId: 'series_1',
      contentId: 'content_1',
      relationshipId: 'relationship_1',
      position: 2,
      nextVersion: 5,
      seriesEtag: 'W/"5"',
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
    })

    expect(fixture.transactionQueries.map(item => item.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO content_mutation_idempotency'),
      expect.stringContaining('UPDATE content_series'),
      expect.stringContaining('INSERT INTO content_relationships'),
      'COMMIT',
    ])
    expect(fixture.transactionQueries[2]?.sql).toContain("'COMPLETED', 200")
    expect(fixture.transactionQueries[2]?.values).toEqual(expect.arrayContaining([
      'creator_1', 'attachSeriesMember', 'attach-key', 'request-hash',
      '{"member":{}}', '2026-11-16T02:00:00.000Z', '2026-11-17T02:00:00.000Z',
    ]))
    expect(fixture.transactionQueries[3]?.sql).toContain(
      'WHERE id = $4 AND owner_user_id = $5 AND version = $6 AND etag = $7',
    )
    expect(fixture.transactionQueries[3]?.values).toEqual([
      5, 'W/"5"', '2026-11-16T02:00:00.000Z', 'series_1', 'creator_1', 4, 'W/"4"',
    ])
    expect(fixture.transactionQueries[4]?.sql).toContain("'series-member'")
    expect(fixture.transactionQueries[4]?.values).toEqual([
      'relationship_1', 'content_1', 'series_1', 2, 'creator_1',
      '2026-11-16T02:00:00.000Z', '2026-11-16T02:00:00.000Z',
    ])
    expect(fixture.isReleased()).toBe(true)
  })

  it('rolls back to 412 when the Series version or ETag changed', async () => {
    const fixture = createDatabase({ updateNoMatch: true })
    const store = createPostgresSeriesMemberAttachStore(fixture.database)

    await expect(store.attach({
      ownerUserId: 'creator_1',
      operationId: 'attachSeriesMember',
      idempotencyKey: 'attach-key',
      requestHash: 'request-hash',
      responseJson: '{}',
      nowIso: '2026-11-16T02:00:00.000Z',
      expiresAt: '2026-11-17T02:00:00.000Z',
      seriesId: 'series_1',
      contentId: 'content_1',
      relationshipId: 'relationship_1',
      position: 2,
      nextVersion: 5,
      seriesEtag: 'W/"5"',
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fixture.isReleased()).toBe(true)
  })

  it('maps idempotency and active relationship uniqueness collisions to existing 409 errors', async () => {
    const duplicateIdempotency = createPostgresSeriesMemberAttachStore(
      createDatabase({ duplicateIdempotency: true }).database,
    )
    await expect(duplicateIdempotency.attach({
      ownerUserId: 'creator_1',
      operationId: 'attachSeriesMember',
      idempotencyKey: 'attach-key',
      requestHash: 'request-hash',
      responseJson: '{}',
      nowIso: '2026-11-16T02:00:00.000Z',
      expiresAt: '2026-11-17T02:00:00.000Z',
      seriesId: 'series_1',
      contentId: 'content_1',
      relationshipId: 'relationship_1',
      position: 2,
      nextVersion: 5,
      seriesEtag: 'W/"5"',
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 })

    const duplicateRelationship = createPostgresSeriesMemberAttachStore(
      createDatabase({ duplicateRelationship: true }).database,
    )
    await expect(duplicateRelationship.attach({
      ownerUserId: 'creator_1',
      operationId: 'attachSeriesMember',
      idempotencyKey: 'attach-key',
      requestHash: 'request-hash',
      responseJson: '{}',
      nowIso: '2026-11-16T02:00:00.000Z',
      expiresAt: '2026-11-17T02:00:00.000Z',
      seriesId: 'series_1',
      contentId: 'content_1',
      relationshipId: 'relationship_1',
      position: 2,
      nextVersion: 5,
      seriesEtag: 'W/"5"',
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('routes Series member attachment through Neon without touching D1', async () => {
    const attach = vi.fn(async (_input: Parameters<SeriesMemberAttachStore['attach']>[0]) => undefined)
    const store: SeriesMemberAttachStore = {
      loadMutation: vi.fn(async () => snapshot),
      attach,
    }
    const db = {
      prepare() {
        throw new Error('D1 must not be queried for Neon Series member attachment')
      },
      batch() {
        throw new Error('D1 must not be used for Neon Series member attachment')
      },
    }
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
      { D1_02: db } as never,
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

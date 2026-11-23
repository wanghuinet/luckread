import { describe, expect, it, vi } from 'vitest'

import { createW03ContentWorker } from './index.js'
import {
  createPostgresSeriesMemberReorderStore,
  type SeriesMemberReorderPostgresDatabase,
} from './content-series-member-reorder-store-postgres.js'
import {
  reorderSeriesMember,
  type SeriesMemberMutationRow,
  type SeriesMemberReorderStore,
  type SeriesMemberOrderRow,
} from './content-series-members.js'

const snapshot: SeriesMemberMutationRow = {
  series_id: 'series_1',
  series_owner_user_id: 'creator_1',
  series_state: 'DRAFT',
  series_version: 4,
  series_etag: 'W/"4"',
  content_id: 'content_3',
  content_owner_user_id: 'creator_1',
  content_slug: 'episode-3',
  content_type: 'article',
  content_state: 'PUBLISHED',
  content_title: 'Episode 3',
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_status: null,
  idem_response_json: null,
  idem_expires_at: null,
  membership_relationship_id: 'rel_3',
  membership_position: 2,
  membership_created_at: '2026-11-16T02:00:00.000Z',
  membership_updated_at: '2026-11-16T02:00:00.000Z',
  next_position: 3,
}

const members: readonly SeriesMemberOrderRow[] = [
  { relationship_id: 'rel_1', source_id: 'content_1', position: 0, created_at: '2026-11-16T01:00:00.000Z', updated_at: '2026-11-16T01:00:00.000Z' },
  { relationship_id: 'rel_2', source_id: 'content_2', position: 1, created_at: '2026-11-16T01:01:00.000Z', updated_at: '2026-11-16T01:01:00.000Z' },
  { relationship_id: 'rel_3', source_id: 'content_3', position: 2, created_at: '2026-11-16T01:02:00.000Z', updated_at: '2026-11-16T01:02:00.000Z' },
]

function createDatabase(options: {
  parentNoMatch?: boolean
  shiftedCount?: number
  missingRelationshipId?: string
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
      if (options.parentNoMatch && sql.startsWith('UPDATE content_series')) {
        return { rows: [] as Row[] }
      }
      if (sql.includes('position = position +')) {
        const count = options.shiftedCount ?? members.length
        return { rows: members.slice(0, count).map(item => ({ relationship_id: item.relationship_id })) as Row[] }
      }
      if (sql.includes('SET position = $1')) {
        const relationshipId = String(values?.[2] ?? '')
        if (relationshipId === options.missingRelationshipId) return { rows: [] as Row[] }
        return { rows: [{ relationship_id: relationshipId }] as Row[] }
      }
      if (sql.startsWith('UPDATE content_series')) return { rows: [{ id: 'series_1' }] as Row[] }
      return { rows: [] as Row[] }
    },
    release() { released = true },
  }

  const database: SeriesMemberReorderPostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.includes('FROM content_series s')) return { rows: [snapshot] as Row[] }
      if (sql.includes('FROM content_relationships r')) return { rows: members as Row[] }
      return { rows: [] as Row[] }
    },
    async connect() { return client },
  }

  return { database, directQueries, transactionQueries, isReleased: () => released }
}

describe('W03 Neon Series member reorder', () => {
  it('loads an owner-scoped snapshot and active Series order in deterministic order', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesMemberReorderStore(fixture.database)

    await expect(store.loadMutation(
      'creator_1', 'series_1', 'content_3', 'reorderSeriesMember', 'reorder-key',
    )).resolves.toMatchObject({
      series_owner_user_id: 'creator_1',
      membership_relationship_id: 'rel_3',
      membership_position: 2,
      series_version: 4,
    })
    await expect(store.listMembers('creator_1', 'series_1')).resolves.toEqual(members)
    expect(fixture.directQueries[0]?.sql).toContain('s.owner_user_id = $6')
    expect(fixture.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fixture.directQueries[0]?.sql).toContain("r.relation_type = 'series-member'")
    expect(fixture.directQueries[1]?.sql).toContain('s.owner_user_id = $2')
    expect(fixture.directQueries[1]?.sql).toContain('ORDER BY r.position ASC, r.relationship_id ASC')
  })

  it('commits idempotency, Series CAS, temporary offset and final positions in one transaction', async () => {
    const fixture = createDatabase()
    const store = createPostgresSeriesMemberReorderStore(fixture.database)

    await store.reorder({
      ownerUserId: 'creator_1',
      operationId: 'reorderSeriesMember',
      idempotencyKey: 'reorder-key',
      requestHash: 'request-hash',
      responseJson: '{"member":{"position":0}}',
      nowIso: '2026-11-16T02:00:00.000Z',
      expiresAt: '2026-11-17T02:00:00.000Z',
      seriesId: 'series_1',
      nextVersion: 5,
      seriesEtag: 'W/"5"',
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      members: [
        { relationshipId: 'rel_1', position: 1 },
        { relationshipId: 'rel_2', position: 2 },
        { relationshipId: 'rel_3', position: 0 },
      ],
    })

    const sql = fixture.transactionQueries.map(item => item.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('DELETE FROM content_mutation_idempotency')
    expect(sql[2]).toContain('INSERT INTO content_mutation_idempotency')
    expect(sql[3]).toContain('UPDATE content_series')
    expect(sql[4]).toContain('position = position + $1')
    expect(sql.slice(5, 8).every(statement => statement.includes('SET position = $1'))).toBe(true)
    expect(sql[8]).toBe('COMMIT')
    expect(fixture.transactionQueries[3]?.values).toEqual([5, 'W/"5"', '2026-11-16T02:00:00.000Z', 'series_1', 'creator_1', 4, 'W/"4"'])
    expect(fixture.transactionQueries[4]?.values).toEqual([4, 'series_1'])
    expect(fixture.transactionQueries.slice(5, 8).map(item => item.values)).toEqual([
      [1, '2026-11-16T02:00:00.000Z', 'rel_1', 'series_1'],
      [2, '2026-11-16T02:00:00.000Z', 'rel_2', 'series_1'],
      [0, '2026-11-16T02:00:00.000Z', 'rel_3', 'series_1'],
    ])
    expect(fixture.isReleased()).toBe(true)
  })

  it('rolls back when Series CAS or active membership set changed', async () => {
    for (const options of [{ parentNoMatch: true }, { shiftedCount: 2 }, { missingRelationshipId: 'rel_2' }]) {
      const fixture = createDatabase(options)
      const store = createPostgresSeriesMemberReorderStore(fixture.database)
      await expect(store.reorder({
        ownerUserId: 'creator_1',
        operationId: 'reorderSeriesMember',
        idempotencyKey: 'reorder-key',
        requestHash: 'request-hash',
        responseJson: '{}',
        nowIso: '2026-11-16T02:00:00.000Z',
        expiresAt: '2026-11-17T02:00:00.000Z',
        seriesId: 'series_1',
        nextVersion: 5,
        seriesEtag: 'W/"5"',
        expectedVersion: 4,
        expectedEtag: 'W/"4"',
        members: [
          { relationshipId: 'rel_1', position: 1 },
          { relationshipId: 'rel_2', position: 2 },
          { relationshipId: 'rel_3', position: 0 },
        ],
      })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
      expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
      expect(fixture.isReleased()).toBe(true)
    }
  })

  it('maps duplicate idempotency keys to the existing 409 response', async () => {
    const fixture = createDatabase({ duplicateIdempotency: true })
    const store = createPostgresSeriesMemberReorderStore(fixture.database)
    await expect(store.reorder({
      ownerUserId: 'creator_1',
      operationId: 'reorderSeriesMember',
      idempotencyKey: 'reorder-key',
      requestHash: 'request-hash',
      responseJson: '{}',
      nowIso: '2026-11-16T02:00:00.000Z',
      expiresAt: '2026-11-17T02:00:00.000Z',
      seriesId: 'series_1',
      nextVersion: 5,
      seriesEtag: 'W/"5"',
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      members: [{ relationshipId: 'rel_1', position: 0 }],
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 })
    expect(fixture.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
  })

  it('preserves the existing D1 batch implementation as the default fallback', async () => {
    const preparedSql: string[] = []
    let batchStatements: unknown[] = []
    const db = {
      prepare(sql: string) {
        preparedSql.push(sql)
        return {
          bind() {
            return {
              async first() { return snapshot },
              async all() { return { results: [...members] } },
            }
          },
        }
      },
      async batch(statements: unknown[]) {
        batchStatements = statements
        return []
      },
    }

    const result = await reorderSeriesMember(
      db as never,
      'creator_1',
      'series_1',
      'content_3',
      0,
      'W/"4"',
      'd1-reorder-key',
      new Date('2026-11-16T02:00:00.000Z'),
    )

    expect(result).toMatchObject({
      member: { relationshipId: 'rel_3', contentId: 'content_3', position: 0 },
      seriesVersion: 5,
      seriesEtag: 'W/"5"',
    })
    expect(preparedSql.length).toBeGreaterThan(2)
    expect(preparedSql[1]).toContain("target_type = 'series'")
    expect(batchStatements).toHaveLength(9)
  })

  it('routes the Series member PATCH through Neon without touching D1', async () => {
    const reorder = vi.fn(async () => undefined)
    const store: SeriesMemberReorderStore = {
      loadMutation: vi.fn(async () => snapshot),
      listMembers: vi.fn(async () => members),
      reorder,
    }
    const worker = createW03ContentWorker({ seriesMemberReorderStoreProvider: () => store })
    const response = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/series/series_1/members/content_3', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'series-member-reorder-neon-test',
          'X-LuckRead-Principal-User-Id': 'creator_1',
          'X-LuckRead-Principal-Layer': 'L3',
          'If-Match': 'W/"4"',
          'Idempotency-Key': 'series-member-reorder-neon-key',
        },
        body: JSON.stringify({ position: 0 }),
      }),
      { D1_02: {
        prepare() { throw new Error('D1 must not be queried for Neon Series member reorder') },
        batch() { throw new Error('D1 must not be used for Neon Series member reorder') },
      } } as never,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { member: { contentId: 'content_3', position: 0 }, seriesVersion: 5 },
    })
    expect(store.loadMutation).toHaveBeenCalledOnce()
    expect(store.listMembers).toHaveBeenCalledOnce()
    expect(reorder).toHaveBeenCalledOnce()
  })
})

import { describe, expect, it } from 'vitest'
import {
  persistAnalyticsEvents,
  type AnalyticsD1Database,
  type AnalyticsD1PreparedStatement,
  type AnalyticsD1Result,
} from './analytics-d1-store'
import {
  ANALYTICS_MAX_BATCH_SIZE,
  processAnalyticsBatch,
  type AnalyticsEvent,
} from './analytics-event-quality'

const now = Date.parse('2026-10-14T00:30:00.000Z')
const timestamp = '2026-10-14T00:12:34.000Z'

function event(overrides: Record<string, unknown> = {}): AnalyticsEvent {
  return {
    eventId: 'evt_store_0001',
    schemaVersion: '1.0',
    eventName: 'content_open',
    sourceWorker: 'W03',
    occurredAt: timestamp,
    receivedAt: timestamp,
    dedupeKey: 'dedupe_store_0001',
    actorType: 'user',
    actorId: 'private-user-id',
    visitorId: 'private-visitor-id',
    sessionId: 'private-session-id',
    contentId: 'content_01',
    contentType: 'article',
    ...overrides,
  } as AnalyticsEvent
}

interface CapturedStatement {
  sql: string
  bindings: (string | number | null)[]
}

function fakeDb(results: AnalyticsD1Result[]): {
  db: AnalyticsD1Database
  getBatches: () => CapturedStatement[][]
} {
  const batches: CapturedStatement[][] = []
  const db: AnalyticsD1Database = {
    prepare(sql: string): AnalyticsD1PreparedStatement {
      const captured: CapturedStatement = { sql, bindings: [] }
      const statement = {
        sql,
        bind(...bindings: (string | number | null)[]) {
          captured.bindings = bindings
          return statement
        },
        getCaptured: () => captured,
      }
      return statement as unknown as AnalyticsD1PreparedStatement
    },
    async batch(statements) {
      batches.push(
        statements.map((item) =>
          (item as unknown as { getCaptured: () => CapturedStatement }).getCaptured(),
        ),
      )
      return results
    },
  }
  return { db, getBatches: () => batches }
}

function successResults(insertedRows: number[]): AnalyticsD1Result[] {
  return [
    ...insertedRows.map((changes) => ({ success: true, meta: { changes } })),
    { success: true, meta: { changes: 1 } },
    { success: true, meta: { changes: 0 } },
    { success: true, meta: { changes: insertedRows.length } },
  ]
}

describe('W11 D1-05 analytics persistence adapter', () => {
  it('uses one atomic bounded batch and excludes raw identity/session fields', async () => {
    const { db, getBatches } = fakeDb(successResults([1]))
    const input = processAnalyticsBatch([event()], { now })

    const result = await persistAnalyticsEvents(db, input.accepted)
    const batches = getBatches()
    const statements = batches[0] ?? []
    const insert = statements[0]

    expect(result).toEqual({ attempted: 1, inserted: 1, duplicates: 0 })
    expect(batches).toHaveLength(1)
    expect(statements).toHaveLength(4)
    expect(insert?.sql).toContain('INSERT INTO analytics_event_dedupe')
    expect(insert?.sql).toContain('ON CONFLICT DO NOTHING')
    expect(insert?.sql.match(/\?/g)).toHaveLength(16)
    expect(insert?.bindings).toContain('2026-10-14T00:00:00.000Z')
    expect(insert?.bindings).toContain('PENDING')
    expect(insert?.bindings).not.toContain('private-user-id')
    expect(insert?.bindings).not.toContain('private-visitor-id')
    expect(insert?.bindings).not.toContain('private-session-id')
    expect(statements[1]?.sql).toContain('GROUP BY hour_start, content_type, content_id, metric_version')
    expect(statements[2]?.sql).toContain('GROUP BY hour_start, creator_id, metric_version')
    expect(statements[3]?.sql).toContain("SET projection_status = 'APPLIED'")
  })

  it('uses one prepared statement per event and totals inserts/duplicates', async () => {
    const { db, getBatches } = fakeDb(successResults([1, 0]))
    const input = processAnalyticsBatch(
      [
        event(),
        event({ eventId: 'evt_store_0002', dedupeKey: 'dedupe_store_0002' }),
      ],
      { now },
    )

    const result = await persistAnalyticsEvents(db, input.accepted)
    const statements = getBatches()[0] ?? []
    expect(result).toEqual({ attempted: 2, inserted: 1, duplicates: 1 })
    expect(statements).toHaveLength(5)
    expect(statements.slice(0, 2).every((item) => (item.sql.match(/\?/g) ?? []).length === 16)).toBe(true)
  })

  it('caps one D1 transaction at 93 statements and at most 16 parameters per INSERT', async () => {
    const { db, getBatches } = fakeDb(
      successResults(Array.from({ length: ANALYTICS_MAX_BATCH_SIZE }, () => 1)),
    )
    const batch = Array.from({ length: ANALYTICS_MAX_BATCH_SIZE }, (_, index) =>
      event({
        eventId: `evt_store_${String(index).padStart(4, '0')}`,
        dedupeKey: `dedupe_store_${String(index).padStart(4, '0')}`,
      }),
    )

    const result = await persistAnalyticsEvents(db, batch)
    const statements = getBatches()[0] ?? []
    expect(result.inserted).toBe(ANALYTICS_MAX_BATCH_SIZE)
    expect(statements).toHaveLength(ANALYTICS_MAX_BATCH_SIZE + 3)
    expect(statements).toHaveLength(93)
    expect(
      statements.slice(0, ANALYTICS_MAX_BATCH_SIZE).every(
        (statement) => (statement.sql.match(/\?/g) ?? []).length === 16,
      ),
    ).toBe(true)
  })

  it('does not open a D1 transaction for an empty batch', async () => {
    const { db, getBatches } = fakeDb(successResults([]))
    expect(await persistAnalyticsEvents(db, [])).toEqual({
      attempted: 0,
      inserted: 0,
      duplicates: 0,
    })
    expect(getBatches()).toHaveLength(0)
  })

  it('rejects oversized batches before constructing D1 statements', async () => {
    const { db, getBatches } = fakeDb(successResults([]))
    const oversized = Array.from({ length: ANALYTICS_MAX_BATCH_SIZE + 1 }, (_, index) =>
      event({
        eventId: `evt_store_${String(index).padStart(4, '0')}`,
        dedupeKey: `dedupe_store_${String(index).padStart(4, '0')}`,
      }),
    )
    await expect(persistAnalyticsEvents(db, oversized)).rejects.toThrow(
      new RegExp(`${ANALYTICS_MAX_BATCH_SIZE}-event limit`),
    )
    expect(getBatches()).toHaveLength(0)
  })

  it('fails closed if any statement fails or D1 omits insert changes metadata', async () => {
    const failed = fakeDb([
      { success: true, meta: { changes: 1 } },
      { success: false, error: 'projection upsert failed' },
      { success: true, meta: { changes: 0 } },
      { success: true, meta: { changes: 1 } },
    ])
    await expect(
      persistAnalyticsEvents(failed.db, [event()]),
    ).rejects.toThrow('projection upsert failed')

    const missingMetadata = fakeDb([
      { success: true },
      { success: true, meta: { changes: 0 } },
      { success: true, meta: { changes: 0 } },
      { success: true, meta: { changes: 0 } },
    ])
    await expect(
      persistAnalyticsEvents(missingMetadata.db, [event()]),
    ).rejects.toThrow('valid changes count')
  })
})

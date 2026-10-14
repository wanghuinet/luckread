import { describe, expect, it } from 'vitest'
import {
  persistAnalyticsEvents,
  type AnalyticsD1Database,
  type AnalyticsD1PreparedStatement,
  type AnalyticsD1Result,
} from './analytics-d1-store'
import { processAnalyticsBatch, type AnalyticsEvent } from './analytics-event-quality'

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

function fakeDb(result: AnalyticsD1Result): {
  db: AnalyticsD1Database
  getCalls: () => { sql: string; bindings: (string | number | null)[] }[]
} {
  const calls: { sql: string; bindings: (string | number | null)[] }[] = []
  const db: AnalyticsD1Database = {
    prepare(sql: string): AnalyticsD1PreparedStatement {
      const call = { sql, bindings: [] as (string | number | null)[] }
      calls.push(call)
      const statement: AnalyticsD1PreparedStatement = {
        bind(...bindings) {
          call.bindings = bindings
          return statement
        },
        async run() {
          return result
        },
      }
      return statement
    },
  }
  return { db, getCalls: () => calls }
}

describe('W11 D1-05 analytics persistence adapter', () => {
  it('uses one atomic insert, lets SQL triggers project events, and excludes identity fields', async () => {
    const { db, getCalls } = fakeDb({ success: true, meta: { changes: 1 } })
    const input = processAnalyticsBatch([event()], { now })

    const result = await persistAnalyticsEvents(db, input.accepted)
    const calls = getCalls()

    expect(result).toEqual({ attempted: 1, inserted: 1, duplicates: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('INSERT OR IGNORE INTO analytics_event_dedupe')
    expect(calls[0]?.sql.match(/\?/g)).toHaveLength(15)
    expect(calls[0]?.bindings).toContain('2026-10-14T00:00:00.000Z')
    expect(calls[0]?.bindings).not.toContain('private-user-id')
    expect(calls[0]?.bindings).not.toContain('private-visitor-id')
    expect(calls[0]?.bindings).not.toContain('private-session-id')
  })

  it('reports duplicate event IDs and dedupe keys from SQLite changes metadata', async () => {
    const { db } = fakeDb({ success: true, meta: { changes: 1 } })
    const input = processAnalyticsBatch(
      [event(), event({ eventId: 'evt_store_0002', dedupeKey: 'dedupe_store_0002' })],
      { now },
    )

    const result = await persistAnalyticsEvents(db, input.accepted)
    expect(result).toEqual({ attempted: 2, inserted: 1, duplicates: 1 })
  })

  it('does not hit D1 for an empty batch', async () => {
    const { db, getCalls } = fakeDb({ success: true, meta: { changes: 0 } })
    expect(await persistAnalyticsEvents(db, [])).toEqual({
      attempted: 0,
      inserted: 0,
      duplicates: 0,
    })
    expect(getCalls()).toHaveLength(0)
  })

  it('rejects oversized batches before constructing a D1 statement', async () => {
    const { db, getCalls } = fakeDb({ success: true, meta: { changes: 0 } })
    const oversized = Array.from({ length: 501 }, (_, index) =>
      event({
        eventId: `evt_store_${String(index).padStart(4, '0')}`,
        dedupeKey: `dedupe_store_${String(index).padStart(4, '0')}`,
      }),
    )
    await expect(persistAnalyticsEvents(db, oversized)).rejects.toThrow(/500-event limit/)
    expect(getCalls()).toHaveLength(0)
  })

  it('fails closed when D1 reports an error or omits changes metadata', async () => {
    const failed = fakeDb({ success: false, error: 'database unavailable' })
    await expect(
      persistAnalyticsEvents(failed.db, [event()]),
    ).rejects.toThrow('database unavailable')

    const missingMetadata = fakeDb({ success: true })
    await expect(
      persistAnalyticsEvents(missingMetadata.db, [event()]),
    ).rejects.toThrow('valid changes count')
  })

  it('surfaces D1 failures rather than pretending metrics were persisted', async () => {
    const broken = fakeDb({ success: false, error: 'trigger failed' })
    await expect(
      persistAnalyticsEvents(broken.db, [event()]),
    ).rejects.toThrow('trigger failed')
  })
})

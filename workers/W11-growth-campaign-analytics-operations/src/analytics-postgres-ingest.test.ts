import { describe, expect, it } from 'vitest'
import {
  persistAnalyticsEventsPostgres,
} from './analytics-postgres-ingest.js'
import type {
  AnalyticsPostgresClient,
  AnalyticsPostgresPool,
  AnalyticsPostgresQueryResult,
} from './analytics-postgres-store.js'
import type { AnalyticsEvent } from './analytics-event-quality.js'

const event = (eventId: string, overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent => ({
  eventId,
  schemaVersion: '1.0',
  eventName: 'content_open',
  sourceWorker: 'W01',
  occurredAt: '2026-11-19T10:34:12.000Z',
  receivedAt: '2026-11-19T10:35:00.000Z',
  dedupeKey: `dedupe_${eventId}`,
  actorType: 'visitor',
  visitorId: 'visitor_01',
  sessionId: 'session_01',
  contentId: 'content_01',
  contentType: 'article',
  ...overrides,
})

function fakePool(options: {
  duplicateInserts?: boolean
  failAtQuery?: number
} = {}): {
  pool: AnalyticsPostgresPool
  calls: string[]
  releases: () => number
} {
  const calls: string[] = []
  let releaseCount = 0
  let queryCount = 0
  const query = async <Row = Record<string, unknown>>(
    sql: string,
    _values: (string | number | null)[] = [],
  ): Promise<AnalyticsPostgresQueryResult<Row>> => {
    queryCount += 1
    calls.push(sql)
    if (options.failAtQuery === queryCount) throw new Error('injected PostgreSQL failure')
    const isInsert = sql.includes('INSERT INTO analytics_event_dedupe')
    return {
      rows: (isInsert && !options.duplicateInserts ? [{ event_id: 'inserted' }] : []) as Row[],
      rowCount: isInsert && !options.duplicateInserts ? 1 : 0,
    }
  }
  const client: AnalyticsPostgresClient = {
    query,
    release() {
      releaseCount += 1
    },
  }
  const pool: AnalyticsPostgresPool = {
    query,
    async connect() {
      return client
    },
  }
  return { pool, calls, releases: () => releaseCount }
}

describe('W11 native PostgreSQL analytics persistence', () => {
  it('serializes event inserts and projections in one transaction', async () => {
    const fake = fakePool()
    const result = await persistAnalyticsEventsPostgres(
      fake.pool,
      [event('event_live_01')],
      [event('event_late_01')],
    )

    expect(result).toMatchObject({
      attempted: 1,
      inserted: 1,
      duplicates: 0,
      lateAttempted: 1,
      lateInserted: 1,
      lateDuplicates: 0,
    })
    expect(fake.calls[0]).toBe('BEGIN')
    expect(fake.calls[1]).toContain('pg_advisory_xact_lock')
    expect(fake.calls[2]).toContain('INSERT INTO analytics_event_dedupe')
    expect(fake.calls[2]).toContain('RETURNING event_id')
    expect(fake.calls[4]).toContain('analytics_content_hourly')
    expect(fake.calls[5]).toContain('analytics_creator_hourly')
    expect(fake.calls[6]).toContain("SET projection_status = 'APPLIED'")
    expect(fake.calls.at(-1)).toBe('COMMIT')
    expect(fake.releases()).toBe(1)
  })

  it('records persisted conflicts against the exact incoming event IDs', async () => {
    const fake = fakePool({ duplicateInserts: true })
    const result = await persistAnalyticsEventsPostgres(
      fake.pool,
      [event('event_dup_01')],
      [event('event_dup_02')],
    )

    expect(result.duplicateEventIds).toEqual(['event_dup_01'])
    expect(result.lateDuplicateEventIds).toEqual(['event_dup_02'])
    expect(result.inserted).toBe(0)
    expect(result.lateInserted).toBe(0)
    expect(fake.calls.at(-1)).toBe('COMMIT')
  })

  it('skips aggregate projection work for a late-only batch', async () => {
    const fake = fakePool()
    const result = await persistAnalyticsEventsPostgres(
      fake.pool,
      [],
      [event('event_late_only_01')],
    )

    expect(result.lateInserted).toBe(1)
    expect(fake.calls.some((sql) => sql.includes('analytics_content_hourly'))).toBe(false)
    expect(fake.calls.some((sql) => sql.includes('analytics_creator_hourly'))).toBe(false)
    expect(fake.calls.at(-1)).toBe('COMMIT')
  })

  it('rolls back and releases the client after a projection failure', async () => {
    const fake = fakePool({ failAtQuery: 5 })
    await expect(persistAnalyticsEventsPostgres(
      fake.pool,
      [event('event_fail_01')],
    )).rejects.toThrow('injected PostgreSQL failure')
    expect(fake.calls.at(-1)).toBe('ROLLBACK')
    expect(fake.releases()).toBe(1)
  })

  it('does not open a transaction for an empty batch', async () => {
    const fake = fakePool()
    const result = await persistAnalyticsEventsPostgres(fake.pool, [])
    expect(result.attempted).toBe(0)
    expect(fake.calls).toEqual([])
    expect(fake.releases()).toBe(0)
  })
})

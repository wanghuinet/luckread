import { describe, expect, it } from 'vitest'
import { ingestAnalyticsBatchPostgres } from './analytics-ingest-postgres.js'
import type {
  AnalyticsPostgresClient,
  AnalyticsPostgresPool,
  AnalyticsPostgresQueryResult,
} from './analytics-postgres-store.js'

const now = Date.parse('2026-11-19T00:30:00.000Z')
const timestamp = '2026-11-19T00:12:34.000Z'

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt_pg_ingest_0001',
    schemaVersion: '1.0',
    eventName: 'content_open',
    sourceWorker: 'W01',
    occurredAt: timestamp,
    receivedAt: timestamp,
    dedupeKey: 'dedupe_pg_ingest_0001',
    actorType: 'user',
    actorId: 'user_001',
    sessionId: 'session_001',
    contentId: 'article_001',
    contentType: 'article',
    ...overrides,
  }
}

function fakePool(duplicate = false): {
  pool: AnalyticsPostgresPool
  calls: string[]
  released: () => number
} {
  const calls: string[] = []
  let releaseCount = 0
  const query = async <Row = Record<string, unknown>>(
    sql: string,
    _values: (string | number | null)[] = [],
  ): Promise<AnalyticsPostgresQueryResult<Row>> => {
    calls.push(sql)
    const isInsert = sql.includes('INSERT INTO analytics_event_dedupe')
    return {
      rows: (isInsert && !duplicate ? [{ event_id: 'inserted' }] : []) as Row[],
      rowCount: isInsert && !duplicate ? 1 : 0,
    }
  }
  const client: AnalyticsPostgresClient = {
    query,
    release() { releaseCount += 1 },
  }
  return {
    pool: { query, async connect() { return client } },
    calls,
    released: () => releaseCount,
  }
}

describe('W11 PostgreSQL analytics ingestion', () => {
  it('keeps event quality decisions and persistence counts aligned', async () => {
    const fake = fakePool()
    const result = await ingestAnalyticsBatchPostgres(
      fake.pool,
      [
        event(),
        event({
          eventId: 'evt_pg_ingest_invalid',
          dedupeKey: 'dedupe_pg_ingest_invalid',
          occurredAt: '2026-02-30T00:00:00.000Z',
        }),
        event({
          eventId: 'evt_pg_ingest_rejected',
          dedupeKey: 'dedupe_pg_ingest_rejected',
          schemaVersion: '99.0',
        }),
      ],
      { now },
    )

    expect(result.quality.accepted).toHaveLength(1)
    expect(result.quality.counts.VALID).toBe(1)
    expect(result.quality.counts.INVALID).toBe(1)
    expect(result.quality.counts.REJECTED).toBe(1)
    expect(result.persistence).toMatchObject({
      attempted: 1,
      inserted: 1,
      duplicates: 0,
    })
    expect(fake.calls.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true)
    expect(fake.released()).toBe(1)
  })

  it('reclassifies events already present in PostgreSQL as DUPLICATE', async () => {
    const fake = fakePool(true)
    const result = await ingestAnalyticsBatchPostgres(fake.pool, [event()], { now })

    expect(result.quality.counts.VALID).toBe(0)
    expect(result.quality.counts.DUPLICATE).toBe(1)
    expect(result.quality.accepted).toHaveLength(0)
    expect(result.quality.outcomes).toMatchObject([{
      quality: 'DUPLICATE',
      reason: 'PERSISTED_EVENT_ID_OR_DEDUPE_KEY',
      eventId: 'evt_pg_ingest_0001',
    }])
    expect(result.persistence.duplicateEventIds).toEqual(['evt_pg_ingest_0001'])
  })

  it('stores late events without projecting them into live aggregates', async () => {
    const fake = fakePool()
    const oldTimestamp = '2026-11-16T00:00:00.000Z'
    const result = await ingestAnalyticsBatchPostgres(
      fake.pool,
      [event({ occurredAt: oldTimestamp, receivedAt: oldTimestamp })],
      { now, maxLatenessMs: 60 * 60 * 1000 },
    )

    expect(result.quality.counts.LATE).toBe(1)
    expect(result.persistence).toMatchObject({
      attempted: 0,
      lateAttempted: 1,
      lateInserted: 1,
    })
    expect(fake.calls.some((sql) => sql.includes('analytics_content_hourly'))).toBe(false)
    expect(fake.calls.some((sql) => sql.includes('analytics_creator_hourly'))).toBe(false)
  })
})

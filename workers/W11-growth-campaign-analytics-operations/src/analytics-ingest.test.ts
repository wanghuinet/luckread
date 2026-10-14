import { describe, expect, it } from 'vitest'
import {
  ingestAnalyticsBatch,
} from './analytics-ingest'
import type {
  AnalyticsD1Database,
  AnalyticsD1PreparedStatement,
  AnalyticsD1Result,
} from './analytics-d1-store'

const now = Date.parse('2026-10-14T00:30:00.000Z')
const timestamp = '2026-10-14T00:12:34.000Z'

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt_ingest_0001',
    schemaVersion: '1.0',
    eventName: 'content_open',
    sourceWorker: 'W03',
    occurredAt: timestamp,
    receivedAt: timestamp,
    dedupeKey: 'dedupe_ingest_0001',
    actorType: 'user',
    actorId: 'user_001',
    sessionId: 'session_001',
    contentId: 'article_001',
    contentType: 'article',
    ...overrides,
  }
}

function fakeDb(
  resultFactory: (statementCount: number) => AnalyticsD1Result[],
): {
  db: AnalyticsD1Database
  getBatchSizes: () => number[]
} {
  const batchSizes: number[] = []
  const db: AnalyticsD1Database = {
    prepare(sql: string): AnalyticsD1PreparedStatement {
      const statement = {
        sql,
        bind() {
          return statement
        },
      }
      return statement as unknown as AnalyticsD1PreparedStatement
    },
    async batch(statements) {
      batchSizes.push(statements.length)
      return resultFactory(statements.length)
    },
  }
  return { db, getBatchSizes: () => batchSizes }
}

function successfulD1Batch(statementCount: number): AnalyticsD1Result[] {
  return Array.from({ length: statementCount }, (_, index) => ({
    success: true,
    meta: { changes: index === 0 ? 1 : 0 },
  }))
}

describe('W11 validated analytics ingestion', () => {
  it('persists only VALID events and returns per-quality counts', async () => {
    const { db, getBatchSizes } = fakeDb(successfulD1Batch)
    const result = await ingestAnalyticsBatch(
      db,
      [
        event(),
        event({
          eventId: 'evt_ingest_0002',
          dedupeKey: 'dedupe_ingest_0002',
          schemaVersion: '99.0',
        }),
        event({
          eventId: 'evt_ingest_0003',
          dedupeKey: 'dedupe_ingest_0003',
          occurredAt: '2026-02-30T00:00:00.000Z',
        }),
      ],
      { now },
    )

    expect(result.quality.accepted).toHaveLength(1)
    expect(result.quality.counts.VALID).toBe(1)
    expect(result.quality.counts.REJECTED).toBe(1)
    expect(result.quality.counts.INVALID).toBe(1)
    expect(result.persistence).toEqual({
      attempted: 1,
      inserted: 1,
      duplicates: 0,
    })
    expect(getBatchSizes()).toEqual([4])
  })

  it('does not call D1 when no event is accepted', async () => {
    const { db, getBatchSizes } = fakeDb(successfulD1Batch)
    const result = await ingestAnalyticsBatch(
      db,
      [event({ schemaVersion: '99.0' })],
      { now },
    )

    expect(result.quality.accepted).toHaveLength(0)
    expect(result.persistence).toEqual({
      attempted: 0,
      inserted: 0,
      duplicates: 0,
    })
    expect(getBatchSizes()).toEqual([])
  })

  it('propagates persistence failures so callers cannot claim events were saved', async () => {
    const { db } = fakeDb((statementCount) =>
      Array.from({ length: statementCount }, (_, index) => ({
        success: index !== 1,
        error: index === 1 ? 'projection write failed' : undefined,
        meta: { changes: index === 0 ? 1 : 0 },
      })),
    )

    await expect(
      ingestAnalyticsBatch(db, [event()], { now }),
    ).rejects.toThrow('projection write failed')
  })
})

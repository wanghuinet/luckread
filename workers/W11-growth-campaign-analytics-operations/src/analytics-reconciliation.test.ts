import { describe, expect, it, vi } from 'vitest'
import type {
  AnalyticsD1Database,
  AnalyticsD1PreparedStatement,
  AnalyticsD1Result,
} from './analytics-d1-store'
import { reconcileAnalyticsHour } from './analytics-reconciliation'

interface CapturedStatement {
  sql: string
  bindings: (string | number | null)[]
}

function fakeDb(results: AnalyticsD1Result[]): {
  db: AnalyticsD1Database
  statements: CapturedStatement[][]
} {
  const batches: CapturedStatement[][] = []
  const db: AnalyticsD1Database = {
    prepare(sql: string): AnalyticsD1PreparedStatement {
      const captured: CapturedStatement = { sql, bindings: [] }
      const statement = {
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
  return { db, statements: batches }
}

const hourStart = '2026-10-14T00:00:00.000Z'

describe('W11 analytics hourly reconciliation', () => {
  it('rebuilds content and creator buckets atomically from the durable event ledger', async () => {
    const { db, statements: batches } = fakeDb([
      { success: true, meta: { changes: 4 } },
      { success: true, meta: { changes: 8 } },
      { success: true, meta: { changes: 2 } },
      { success: true, meta: { changes: 3 } },
      { success: true, meta: { changes: 5 } },
    ])

    const result = await reconcileAnalyticsHour(db, hourStart)
    const statements = batches[0] ?? []

    expect(result).toEqual({
      hourStart,
      contentBucketsRebuilt: 8,
      creatorBucketsRebuilt: 3,
    })
    expect(batches).toHaveLength(1)
    expect(statements).toHaveLength(5)
    expect(statements[0]?.sql).toContain('DELETE FROM analytics_content_hourly')
    expect(statements[1]?.sql).toContain('FROM analytics_event_dedupe')
    expect(statements[1]?.sql).toContain('GROUP BY hour_start, content_type, content_id, metric_version')
    expect(statements[1]?.sql).toContain('WHERE hour_start = ?')
    expect(statements[1]?.sql).not.toContain("projection_status = 'PENDING'")
    expect(statements[2]?.sql).toContain('DELETE FROM analytics_creator_hourly')
    expect(statements[3]?.sql).toContain('GROUP BY hour_start, creator_id, metric_version')
    expect(statements[4]?.sql).toContain("SET projection_status = 'APPLIED'")
    expect(statements.every((statement) => statement.bindings.length === 1)).toBe(true)
    expect(statements.every((statement) => statement.bindings[0] === hourStart)).toBe(true)
  })

  it('rejects noncanonical, non-hour-aligned and impossible timestamps before database access', async () => {
    const { db, statements } = fakeDb([])

    await expect(reconcileAnalyticsHour(db, '2026-10-14T00:01:00.000Z')).rejects.toThrow(
      'canonical UTC hour boundary',
    )
    await expect(reconcileAnalyticsHour(db, '2026-02-30T00:00:00.000Z')).rejects.toThrow(
      'real UTC calendar hour',
    )
    await expect(reconcileAnalyticsHour(db, '2026-10-14')).rejects.toThrow(
      'canonical UTC hour boundary',
    )
    expect(statements).toHaveLength(0)
  })

  it('fails closed when any statement in the reconciliation transaction fails', async () => {
    const { db } = fakeDb([
      { success: true },
      { success: true },
      { success: false, error: 'rebuild failed' },
      { success: true },
      { success: true },
    ])

    await expect(reconcileAnalyticsHour(db, hourStart)).rejects.toThrow('rebuild failed')
  })

  it('rejects incomplete D1 batch results instead of reporting successful reconciliation', async () => {
    const { db } = fakeDb([{ success: true }])

    await expect(reconcileAnalyticsHour(db, hourStart)).rejects.toThrow(
      'unexpected result count',
    )
  })
})

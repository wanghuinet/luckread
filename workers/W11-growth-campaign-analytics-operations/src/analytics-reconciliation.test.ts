import { describe, expect, it } from 'vitest'
import type {
  AnalyticsD1Database,
  AnalyticsD1PreparedStatement,
  AnalyticsD1Result,
} from './analytics-d1-store'
import { reconcileAnalyticsHour } from './analytics-reconciliation'
import {
  getLatestAnalyticsProjectionRebuildStatus,
  type AnalyticsRebuildStatusDatabase,
} from './analytics-reconciliation-status'

interface CapturedStatement {
  sql: string
  bindings: (string | number | null)[]
}

function fakeDb(batchResults: AnalyticsD1Result[][]): {
  db: AnalyticsD1Database
  batches: CapturedStatement[][]
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
      const callIndex = batches.length
      batches.push(
        statements.map((item) =>
          (item as unknown as { getCaptured: () => CapturedStatement }).getCaptured(),
        ),
      )
      return batchResults[callIndex] ?? []
    },
  }
  return { db, batches }
}

const hourStart = '2026-10-14T00:00:00.000Z'
const startSuccess: AnalyticsD1Result[] = [{ success: true, meta: { changes: 1 } }]
const repairSuccess: AnalyticsD1Result[] = [
  { success: true, meta: { changes: 4 } },
  { success: true, meta: { changes: 8 } },
  { success: true, meta: { changes: 2 } },
  { success: true, meta: { changes: 3 } },
  { success: true, meta: { changes: 5 } },
  { success: true, meta: { changes: 1 } },
]

describe('W11 analytics hourly reconciliation', () => {
  it('rebuilds projections atomically and records a bounded successful status', async () => {
    const { db, batches } = fakeDb([startSuccess, repairSuccess])

    const result = await reconcileAnalyticsHour(db, hourStart)
    const start = batches[0]?.[0]
    const statements = batches[1] ?? []

    expect(result).toMatchObject({
      hourStart,
      status: 'SUCCEEDED',
      contentBucketsRebuilt: 8,
      creatorBucketsRebuilt: 3,
    })
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(batches).toHaveLength(2)
    expect(start?.sql).toContain('INSERT INTO analytics_projection_rebuild_state')
    expect(start?.bindings).toEqual([result.runId, hourStart])
    expect(statements).toHaveLength(6)
    expect(statements[0]?.sql).toContain('DELETE FROM analytics_content_hourly')
    expect(statements[1]?.sql).toContain('FROM analytics_event_dedupe')
    expect(statements[1]?.sql).toContain('GROUP BY hour_start, content_type, content_id, metric_version')
    expect(statements[1]?.sql).toContain('WHERE hour_start = ?')
    expect(statements[1]?.sql).not.toContain("projection_status = 'PENDING'")
    expect(statements[1]?.sql).toContain("projection_status <> 'LATE'")
    expect(statements[2]?.sql).toContain('DELETE FROM analytics_creator_hourly')
    expect(statements[3]?.sql).toContain('GROUP BY hour_start, creator_id, metric_version')
    expect(statements[3]?.sql).toContain("projection_status <> 'LATE'")
    expect(statements[4]?.sql).toContain("SET projection_status = 'APPLIED'")
    expect(statements[5]?.sql).toContain("status = 'SUCCEEDED'")
    expect(statements[5]?.bindings).toEqual([hourStart, hourStart, result.runId])
    expect(statements.slice(0, 5).every((statement) => statement.bindings[0] === hourStart)).toBe(true)
  })

  it('replays only late events for the requested hour in the same atomic rebuild transaction', async () => {
    const replayBatch: AnalyticsD1Result[] = [
      { success: true, meta: { changes: 2 } },
      ...repairSuccess,
    ]
    const { db, batches } = fakeDb([startSuccess, replayBatch])

    const result = await reconcileAnalyticsHour(db, hourStart, { replayLateEvents: true })
    const statements = batches[1] ?? []

    expect(result).toMatchObject({
      hourStart,
      status: 'SUCCEEDED',
      contentBucketsRebuilt: 8,
      creatorBucketsRebuilt: 3,
      lateEventsReplayed: 2,
    })
    expect(statements).toHaveLength(7)
    expect(statements[0]?.sql).toContain("SET projection_status = 'PENDING'")
    expect(statements[0]?.sql).toContain("projection_status = 'LATE'")
    expect(statements[0]?.bindings).toEqual([hourStart])
    expect(statements[2]?.sql).toContain("projection_status <> 'LATE'")
    expect(statements[4]?.sql).toContain("projection_status <> 'LATE'")
    expect(statements[5]?.sql).toContain("SET projection_status = 'APPLIED'")
    expect(statements[6]?.sql).toContain("status = 'SUCCEEDED'")
  })

  it('rejects noncanonical, non-hour-aligned and impossible timestamps before database access', async () => {
    const { db, batches } = fakeDb([])

    await expect(reconcileAnalyticsHour(db, '2026-10-14T00:01:00.000Z')).rejects.toThrow(
      'canonical UTC hour boundary',
    )
    await expect(reconcileAnalyticsHour(db, '2026-02-30T00:00:00.000Z')).rejects.toThrow(
      'real UTC calendar hour',
    )
    await expect(reconcileAnalyticsHour(db, '2026-10-14')).rejects.toThrow(
      'canonical UTC hour boundary',
    )
    expect(batches).toHaveLength(0)
  })

  it('marks repair as failed without exposing provider errors when a batch fails', async () => {
    const failedRepair = [
      ...repairSuccess.slice(0, 2),
      { success: false, error: 'sensitive provider SQL details' },
      ...repairSuccess.slice(3),
    ]
    const { db, batches } = fakeDb([
      startSuccess,
      failedRepair,
      [{ success: true, meta: { changes: 1 } }],
    ])

    await expect(reconcileAnalyticsHour(db, hourStart)).rejects.toThrow(
      'D1 analytics reconciliation failed',
    )
    expect(batches).toHaveLength(3)
    expect(batches[2]?.[0]?.sql).toContain("status = 'FAILED'")
    expect(batches[2]?.[0]?.bindings).toEqual(['REBUILD_FAILED', expect.any(String)])
  })

  it('records incomplete batch metadata as a sanitized failure', async () => {
    const { db, batches } = fakeDb([
      startSuccess,
      [{ success: true, meta: { changes: 1 } }],
      [{ success: true, meta: { changes: 1 } }],
    ])

    await expect(reconcileAnalyticsHour(db, hourStart)).rejects.toThrow(
      'D1 analytics reconciliation failed',
    )
    expect(batches).toHaveLength(3)
    expect(batches[2]?.[0]?.bindings?.[0]).toBe('REBUILD_BATCH_INCOMPLETE')
  })

describe('W11 latest analytics projection rebuild status', () => {
  const baseRow = {
    run_id: '1b6f3e20-43a1-4b22-8d20-7f63a6b92d12',
    hour_start: hourStart,
    status: 'SUCCEEDED',
    started_at: '2026-10-14T00:01:00.123Z',
    completed_at: '2026-10-14T00:02:00.456Z',
    content_buckets_rebuilt: 8,
    creator_buckets_rebuilt: 3,
    error_code: null,
  }

  function statusDb(row: Record<string, unknown> | null): {
    db: AnalyticsRebuildStatusDatabase
    query: string[]
  } {
    const queries: string[] = []
    return {
      db: {
        prepare(sql: string) {
          queries.push(sql)
          return { first: async () => row }
        },
      },
      query: queries,
    }
  }

  it('returns null when no rebuild has been recorded yet', async () => {
    const { db, query } = statusDb(null)
    expect(await getLatestAnalyticsProjectionRebuildStatus(db)).toBeNull()
    expect(query).toHaveLength(1)
    expect(query[0]).toContain('WHERE singleton_id = 1')
  })

  it('returns a validated success summary without arbitrary persisted fields', async () => {
    const { db } = statusDb({
      ...baseRow,
      internal_debug: 'must not be returned',
    })
    const result = await getLatestAnalyticsProjectionRebuildStatus(db)
    expect(result).toEqual({
      runId: baseRow.run_id,
      hourStart,
      status: 'SUCCEEDED',
      startedAt: baseRow.started_at,
      completedAt: baseRow.completed_at,
      contentBucketsRebuilt: 8,
      creatorBucketsRebuilt: 3,
      errorCode: null,
    })
    expect(JSON.stringify(result)).not.toContain('internal_debug')
  })

  it('returns a RUNNING state when the caller timed out before completion', async () => {
    const { db } = statusDb({
      ...baseRow,
      status: 'RUNNING',
      completed_at: null,
      content_buckets_rebuilt: null,
      creator_buckets_rebuilt: null,
      error_code: null,
    })
    const result = await getLatestAnalyticsProjectionRebuildStatus(db)
    expect(result).toMatchObject({
      status: 'RUNNING',
      completedAt: null,
      contentBucketsRebuilt: null,
      creatorBucketsRebuilt: null,
      errorCode: null,
    })
  })

  it('returns only an enumerated sanitized failure code', async () => {
    const { db } = statusDb({
      ...baseRow,
      status: 'FAILED',
      completed_at: baseRow.completed_at,
      content_buckets_rebuilt: null,
      creator_buckets_rebuilt: null,
      error_code: 'REBUILD_FAILED',
      provider_error: 'private SQL details',
    })
    const result = await getLatestAnalyticsProjectionRebuildStatus(db)
    expect(result).toMatchObject({
      status: 'FAILED',
      errorCode: 'REBUILD_FAILED',
    })
    expect(JSON.stringify(result)).not.toContain('private SQL details')
  })

  it('rejects impossible hours, malformed counts and unrecognized stored errors', async () => {
    for (const row of [
      { ...baseRow, hour_start: '2026-02-30T00:00:00.000Z' },
      { ...baseRow, content_buckets_rebuilt: -1 },
      { ...baseRow, error_code: 'provider token=secret' },
      { ...baseRow, started_at: 'not-a-timestamp' },
    ]) {
      const { db } = statusDb(row)
      await expect(getLatestAnalyticsProjectionRebuildStatus(db)).rejects.toThrow(
        'Stored analytics projection rebuild status is invalid',
      )
    }
  })
})

})

import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsPostgresPool } from './analytics-postgres-store.js'
import {
  getLatestAnalyticsProjectionRebuildStatusPostgres,
  reconcileAnalyticsHourPostgres,
} from './analytics-reconciliation-postgres.js'

const hourStart = '2026-10-14T00:00:00.000Z'

function fakePool(options: { failOnContentInsert?: boolean } = {}) {
  const calls: { sql: string; values: (string | number | null)[] }[] = []
  const clientQuery = vi.fn(async (sql: string, values: (string | number | null)[] = []) => {
    calls.push({ sql, values })
    if (options.failOnContentInsert && sql.includes('INSERT INTO analytics_content_hourly')) {
      throw new Error('private provider SQL detail')
    }
    if (sql.includes('INSERT INTO analytics_content_hourly')) return { rows: [], rowCount: 8 }
    if (sql.includes('INSERT INTO analytics_creator_hourly')) return { rows: [], rowCount: 3 }
    if (sql.includes("projection_status = 'LATE'")) return { rows: [], rowCount: 2 }
    if (sql.includes("status = 'SUCCEEDED'")) {
      return { rows: [{ content_buckets_rebuilt: 8, creator_buckets_rebuilt: 3 }], rowCount: 1 }
    }
    return { rows: [], rowCount: 1 }
  })
  const client = { query: clientQuery, release: vi.fn() }
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
  } as unknown as AnalyticsPostgresPool
  return { pool, clientQuery, calls, client }
}

describe('W11 PostgreSQL hourly analytics reconciliation', () => {
  it('rebuilds content and creator buckets under a session advisory lock in one transaction', async () => {
    const { pool, calls, clientQuery, client } = fakePool()
    const result = await reconcileAnalyticsHourPostgres(pool, hourStart)

    expect(result).toMatchObject({
      hourStart,
      status: 'SUCCEEDED',
      contentBucketsRebuilt: 8,
      creatorBucketsRebuilt: 3,
    })
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(calls[0]?.sql).toContain('pg_advisory_lock')
    expect(calls[1]?.sql).toContain('INSERT INTO analytics_projection_rebuild_state')
    expect(calls[1]?.values).toEqual([result.runId, hourStart])
    expect(calls.some((call) => call.sql === 'BEGIN')).toBe(true)
    expect(calls.some((call) => call.sql === 'COMMIT')).toBe(true)
    expect(calls.some((call) => call.sql.includes('INSERT INTO analytics_content_hourly'))).toBe(true)
    expect(calls.some((call) => call.sql.includes('INSERT INTO analytics_creator_hourly'))).toBe(true)
    expect(calls.some((call) => call.sql.includes("projection_status = 'APPLIED'"))).toBe(true)
    expect(calls.at(-1)?.sql).toContain('pg_advisory_unlock')
    expect(client.release).toHaveBeenCalledTimes(1)
    expect(clientQuery).toHaveBeenCalled()
  })

  it('replays only late events for the requested hour before rebuilding', async () => {
    const { pool, calls } = fakePool()
    const result = await reconcileAnalyticsHourPostgres(pool, hourStart, { replayLateEvents: true })
    const replayIndex = calls.findIndex((call) => call.sql.includes("projection_status = 'LATE'"))
    const deleteIndex = calls.findIndex((call) => call.sql.includes('DELETE FROM analytics_content_hourly'))

    expect(result.lateEventsReplayed).toBe(2)
    expect(replayIndex).toBeGreaterThan(-1)
    expect(replayIndex).toBeLessThan(deleteIndex)
    expect(calls[replayIndex]?.values).toEqual([hourStart])
  })

  it('rejects invalid hour boundaries before acquiring a database connection', async () => {
    const { pool } = fakePool()
    await expect(reconcileAnalyticsHourPostgres(pool, '2026-10-14T00:01:00.000Z'))
      .rejects.toThrow('canonical UTC hour boundary')
    await expect(reconcileAnalyticsHourPostgres(pool, '2026-02-30T00:00:00.000Z'))
      .rejects.toThrow('real UTC calendar hour')
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rolls back and records a sanitized failure when projection rebuilding fails', async () => {
    const { pool, calls } = fakePool({ failOnContentInsert: true })
    await expect(reconcileAnalyticsHourPostgres(pool, hourStart))
      .rejects.toThrow('PostgreSQL analytics reconciliation failed')

    expect(calls.some((call) => call.sql === 'ROLLBACK')).toBe(true)
    const failed = calls.find((call) => call.sql.includes("status = 'FAILED'"))
    expect(failed?.values).toEqual(['REBUILD_FAILED', expect.any(String)])
    expect(JSON.stringify(calls)).not.toContain('private provider SQL detail')
  })
})

describe('W11 PostgreSQL latest analytics rebuild status', () => {
  const baseRow = {
    run_id: '1b6f3e20-43a1-4b22-8d20-7f63a6b92d12',
    hour_start: hourStart,
    status: 'SUCCEEDED',
    started_at: '2026-10-14T00:01:00.123Z',
    completed_at: '2026-10-14T00:02:00.456Z',
    content_buckets_rebuilt: '8',
    creator_buckets_rebuilt: '3',
    error_code: null,
  }

  it('returns a validated status summary without arbitrary provider fields', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [{ ...baseRow, private_debug: 'not returned' }], rowCount: 1 })),
      connect: vi.fn(),
    } as unknown as AnalyticsPostgresPool
    const result = await getLatestAnalyticsProjectionRebuildStatusPostgres(pool)

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
    expect(JSON.stringify(result)).not.toContain('private_debug')
  })

  it('returns null when no rebuild has been recorded', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: vi.fn(),
    } as unknown as AnalyticsPostgresPool
    await expect(getLatestAnalyticsProjectionRebuildStatusPostgres(pool)).resolves.toBeNull()
  })

  it('rejects malformed persisted status rather than returning unsafe provider data', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ ...baseRow, error_code: 'provider secret' }],
        rowCount: 1,
      })),
      connect: vi.fn(),
    } as unknown as AnalyticsPostgresPool
    await expect(getLatestAnalyticsProjectionRebuildStatusPostgres(pool))
      .rejects.toThrow('Stored analytics projection rebuild status is invalid')
  })
})

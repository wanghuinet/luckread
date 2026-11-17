import { describe, expect, it } from 'vitest'
import {
  createPostgresAnalyticsDatabase,
  translateAnalyticsSqlToPostgres,
  type AnalyticsPostgresClient,
  type AnalyticsPostgresPool,
  type AnalyticsPostgresQueryResult,
} from './analytics-postgres-store.js'

interface QueryCall {
  sql: string
  values: (string | number | null)[]
}

function fakePool(options: {
  failAtQuery?: number
  rows?: Record<string, unknown>[]
  rowCount?: number
} = {}): {
  pool: AnalyticsPostgresPool
  calls: QueryCall[]
  released: () => number
} {
  const calls: QueryCall[] = []
  let releaseCount = 0
  let queryCount = 0

  const query = async <Row = Record<string, unknown>>(
    sql: string,
    values: (string | number | null)[] = [],
  ): Promise<AnalyticsPostgresQueryResult<Row>> => {
    queryCount += 1
    calls.push({ sql, values })
    if (options.failAtQuery === queryCount) throw new Error('injected PostgreSQL failure')
    return {
      rows: (options.rows ?? []) as Row[],
      rowCount: options.rowCount ?? 1,
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

  return {
    pool,
    calls,
    released: () => releaseCount,
  }
}

describe('W11 PostgreSQL compatibility adapter', () => {
  it('converts positional SQLite placeholders to PostgreSQL parameters', async () => {
    const fake = fakePool({ rows: [{ content_id: 'content_01' }] })
    const db = createPostgresAnalyticsDatabase(fake.pool)
    const statement = db.prepare(
      'SELECT content_id FROM analytics_content_hourly WHERE content_id = ? AND metric_version = ?',
    ).bind('content_01', '1.0')

    await expect(statement.first()).resolves.toEqual({ content_id: 'content_01' })
    expect(fake.calls).toEqual([{
      sql: 'SELECT content_id FROM analytics_content_hourly WHERE content_id = $1 AND metric_version = $2',
      values: ['content_01', '1.0'],
    }])
  })

  it('runs a D1-style batch in one PostgreSQL transaction and returns affected-row metadata', async () => {
    const fake = fakePool({ rowCount: 1 })
    const db = createPostgresAnalyticsDatabase(fake.pool)

    const results = await db.batch([
      db.prepare('INSERT INTO analytics_event_dedupe (event_id) VALUES (?) ON CONFLICT DO NOTHING')
        .bind('event_0001'),
      db.prepare('UPDATE analytics_event_dedupe SET projection_status = ? WHERE event_id = ?')
        .bind('APPLIED', 'event_0001'),
    ])

    expect(results).toEqual([
      { success: true, meta: { changes: 1 } },
      { success: true, meta: { changes: 1 } },
    ])
    expect(fake.calls.map((call) => call.sql)).toEqual([
      'BEGIN',
      'INSERT INTO analytics_event_dedupe (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
      'UPDATE analytics_event_dedupe SET projection_status = $1 WHERE event_id = $2',
      'COMMIT',
    ])
    expect(fake.calls[1]?.values).toEqual(['event_0001'])
    expect(fake.calls[2]?.values).toEqual(['APPLIED', 'event_0001'])
    expect(fake.released()).toBe(1)
  })

  it('rolls back the complete batch after a PostgreSQL statement fails', async () => {
    const fake = fakePool({ failAtQuery: 3 })
    const db = createPostgresAnalyticsDatabase(fake.pool)

    await expect(db.batch([
      db.prepare('INSERT INTO analytics_event_dedupe (event_id) VALUES (?)').bind('event_0001'),
      db.prepare('UPDATE analytics_event_dedupe SET projection_status = ?').bind('APPLIED'),
    ])).rejects.toThrow('injected PostgreSQL failure')

    expect(fake.calls.map((call) => call.sql)).toEqual([
      'BEGIN',
      'INSERT INTO analytics_event_dedupe (event_id) VALUES ($1)',
      'UPDATE analytics_event_dedupe SET projection_status = $1',
      'ROLLBACK',
    ])
    expect(fake.released()).toBe(1)
  })

  it('maps the SQLite schema readiness probe to PostgreSQL catalogs and constraints', async () => {
    const fake = fakePool({ rows: [{ type: 'table', name: 'analytics_event_dedupe', sql: "CHECK (source_worker IN ('W01','W03','W05'))" }] })
    const db = createPostgresAnalyticsDatabase(fake.pool)

    const result = await db.prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE type = 'table'",
    ).all()

    expect(result.results[0]?.name).toBe('analytics_event_dedupe')
    expect(fake.calls[0]?.sql).toContain('pg_catalog.pg_constraint')
    expect(fake.calls[0]?.sql).toContain('pg_catalog.pg_indexes')
    expect(fake.calls[0]?.sql).not.toContain('sqlite_master')
  })

  it('preserves UTC millisecond timestamps when translating D1 reconciliation SQL', () => {
    const sql = translateAnalyticsSqlToPostgres(
      "UPDATE analytics_projection_rebuild_state SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE run_id = ?",
    )

    expect(sql).toContain('clock_timestamp() AT TIME ZONE')
    expect(sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    expect(sql).toContain('WHERE run_id = $1')
    expect(sql).not.toContain('strftime')
  })

  it('does not open a transaction for an empty batch', async () => {
    const fake = fakePool()
    const db = createPostgresAnalyticsDatabase(fake.pool)

    await expect(db.batch([])).resolves.toEqual([])
    expect(fake.calls).toHaveLength(0)
    expect(fake.released()).toBe(0)
  })
})

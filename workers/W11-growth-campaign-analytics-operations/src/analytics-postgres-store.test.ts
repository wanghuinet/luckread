import { describe, expect, it } from 'vitest'
import {
  checkAnalyticsPostgresHealth,
  readAnalyticsPostgresSchemaObjects,
  type AnalyticsPostgresClient,
  type AnalyticsPostgresPool,
  type AnalyticsPostgresQueryResult,
} from './analytics-postgres-store.js'

interface QueryCall {
  sql: string
  values: (string | number | null)[]
}

function fakePool(options: {
  rows?: Record<string, unknown>[]
  rowCount?: number
} = {}): {
  pool: AnalyticsPostgresPool
  calls: QueryCall[]
  released: () => number
} {
  const calls: QueryCall[] = []
  let releaseCount = 0
  const query = async <Row = Record<string, unknown>>(
    sql: string,
    values: (string | number | null)[] = [],
  ): Promise<AnalyticsPostgresQueryResult<Row>> => {
    calls.push({ sql, values })
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
  return { pool, calls, released: () => releaseCount }
}

describe('W11 native PostgreSQL health and schema access', () => {
  it('checks connectivity using a native PostgreSQL scalar query', async () => {
    const fake = fakePool({ rows: [{ ok: 1 }] })
    await expect(checkAnalyticsPostgresHealth(fake.pool)).resolves.toBe(true)
    expect(fake.calls).toEqual([{ sql: 'SELECT 1::int AS ok', values: [] }])
  })

  it('fails health when PostgreSQL does not return the expected scalar', async () => {
    const fake = fakePool({ rows: [{ ok: 0 }] })
    await expect(checkAnalyticsPostgresHealth(fake.pool)).resolves.toBe(false)
  })

  it('inspects PostgreSQL information_schema, constraints and indexes without SQLite catalog SQL', async () => {
    const fake = fakePool({
      rows: [{ type: 'table', name: 'analytics_event_dedupe', sql: "CHECK (source_worker IN ('W01','W03','W05')) CHECK (projection_status IN ('PENDING','APPLIED','LATE'))" }],
    })
    const rows = await readAnalyticsPostgresSchemaObjects(fake.pool)
    expect(rows[0]?.name).toBe('analytics_event_dedupe')
    expect(fake.calls[0]?.sql).toContain('information_schema.tables')
    expect(fake.calls[0]?.sql).toContain('pg_catalog.pg_constraint')
    expect(fake.calls[0]?.sql).toContain('pg_catalog.pg_indexes')
    expect(fake.calls[0]?.sql).not.toContain('sqlite_master')
  })
})

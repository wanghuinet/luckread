import type {
  AnalyticsD1Database,
  AnalyticsD1PreparedStatement,
  AnalyticsD1Result,
} from './analytics-d1-store'

export interface AnalyticsPostgresQueryResult<Row = Record<string, unknown>> {
  rows: Row[]
  rowCount: number | null
}

export interface AnalyticsPostgresExecutor {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: (string | number | null)[],
  ): Promise<AnalyticsPostgresQueryResult<Row>>
}

export interface AnalyticsPostgresClient extends AnalyticsPostgresExecutor {
  release(): void
}

export interface AnalyticsPostgresPool extends AnalyticsPostgresExecutor {
  connect(): Promise<AnalyticsPostgresClient>
}

export interface AnalyticsPostgresPreparedStatement extends AnalyticsD1PreparedStatement {
  bind(...values: (string | number | null)[]): AnalyticsPostgresPreparedStatement
  all<Row = Record<string, unknown>>(): Promise<{ results: Row[] }>
  first<Row = Record<string, unknown>>(): Promise<Row | null>
}

const POSTGRES_SCHEMA_PROBE = String.raw`
  SELECT 'table'::text AS type,
         table_name AS name,
         COALESCE((
           SELECT string_agg(pg_catalog.pg_get_constraintdef(c.oid), ' ')
           FROM pg_catalog.pg_constraint c
           JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = current_schema()
             AND t.relname = table_name
             AND c.contype = 'c'
         ), '') AS sql
    FROM information_schema.tables
   WHERE table_schema = current_schema()
     AND table_type = 'BASE TABLE'
     AND table_name IN (
       'analytics_event_dedupe',
       'analytics_content_hourly',
       'analytics_creator_hourly',
       'analytics_rollup_watermark',
       'analytics_reconciliation_status',
       'analytics_projection_rebuild_state'
     )
  UNION ALL
  SELECT 'index'::text AS type, indexname AS name, indexdef AS sql
    FROM pg_catalog.pg_indexes
   WHERE schemaname = current_schema()
     AND indexname IN (
       'analytics_event_dedupe_ingested_at_idx',
       'analytics_event_dedupe_occurred_at_idx',
       'analytics_event_dedupe_hour_start_idx',
       'analytics_event_dedupe_pending_idx',
       'analytics_content_hourly_content_time_idx',
       'analytics_content_hourly_content_id_time_idx',
       'analytics_content_hourly_time_idx',
       'analytics_creator_hourly_creator_time_idx'
     )
`

/**
 * Translate only the small SQLite compatibility surface used by the existing
 * analytics store. Business SQL and its parameter ordering remain unchanged.
 */
export function translateAnalyticsSqlToPostgres(sql: string): string {
  if (/\bFROM\s+sqlite_master\b/i.test(sql)) return POSTGRES_SCHEMA_PROBE

  const withPostgresClock = sql.replace(
    /strftime\(\s*'%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\s*\)/gi,
    `to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  )

  let parameter = 0
  return withPostgresClock.replace(/\?/g, () => `${++parameter}`)
}

class PostgresPreparedStatement implements AnalyticsPostgresPreparedStatement {
  private values: (string | number | null)[] = []

  constructor(
    private readonly pool: AnalyticsPostgresPool,
    private readonly sql: string,
  ) {}

  bind(...values: (string | number | null)[]): AnalyticsPostgresPreparedStatement {
    this.values = values
    return this
  }

  async all<Row = Record<string, unknown>>(): Promise<{ results: Row[] }> {
    const result = await this.pool.query<Row>(
      translateAnalyticsSqlToPostgres(this.sql),
      this.values,
    )
    return { results: result.rows }
  }

  async first<Row = Record<string, unknown>>(): Promise<Row | null> {
    const result = await this.pool.query<Row>(
      translateAnalyticsSqlToPostgres(this.sql),
      this.values,
    )
    return result.rows[0] ?? null
  }

  getBatchStatement(): { sql: string; values: (string | number | null)[] } {
    return {
      sql: translateAnalyticsSqlToPostgres(this.sql),
      values: [...this.values],
    }
  }
}

/**
 * Adapts the existing bounded analytics SQL to PostgreSQL. A D1 batch is
 * represented by one PostgreSQL transaction, preserving atomic event,
 * projection and reconciliation writes.
 */
export function createPostgresAnalyticsDatabase(
  pool: AnalyticsPostgresPool,
): AnalyticsD1Database & {
  prepare(sql: string): AnalyticsPostgresPreparedStatement
} {
  return {
    prepare(sql: string): AnalyticsPostgresPreparedStatement {
      return new PostgresPreparedStatement(pool, sql)
    },

    async batch(statements: AnalyticsD1PreparedStatement[]): Promise<AnalyticsD1Result[]> {
      if (statements.length === 0) return []

      const client = await pool.connect()
      const results: AnalyticsD1Result[] = []
      let transactionStarted = false

      try {
        await client.query('BEGIN')
        transactionStarted = true

        for (const statement of statements) {
          if (!(statement instanceof PostgresPreparedStatement)) {
            throw new TypeError('PostgreSQL analytics batch contains a foreign statement')
          }
          const prepared = statement.getBatchStatement()
          const result = await client.query(prepared.sql, prepared.values)
          results.push({
            success: true,
            meta: { changes: result.rowCount ?? 0 },
          })
        }

        await client.query('COMMIT')
        transactionStarted = false
        return results
      } catch (error) {
        if (transactionStarted) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // Preserve the original failure; the connection is released below.
          }
        }
        throw error
      } finally {
        client.release()
      }
    },
  }
}

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

export interface AnalyticsPostgresSchemaObject {
  type: string
  name: string
  sql?: string | null
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

export async function checkAnalyticsPostgresHealth(
  pool: AnalyticsPostgresPool,
): Promise<boolean> {
  const result = await pool.query<{ ok: number }>('SELECT 1::int AS ok')
  return result.rows[0]?.ok === 1
}

export async function readAnalyticsPostgresSchemaObjects(
  pool: AnalyticsPostgresPool,
): Promise<AnalyticsPostgresSchemaObject[]> {
  const result = await pool.query<AnalyticsPostgresSchemaObject>(POSTGRES_SCHEMA_PROBE)
  return result.rows
}

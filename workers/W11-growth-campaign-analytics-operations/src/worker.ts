interface AnalyticsSchemaObject {
  type: string
  name: string
  sql?: string | null
}

interface AnalyticsD1Statement {
  first(): Promise<{ ok: number } | null>
  all(): Promise<{ results?: AnalyticsSchemaObject[] }>
}

interface AnalyticsHealthDatabase {
  prepare(query: string): AnalyticsD1Statement
}

export interface W11Env {
  D1_05: AnalyticsHealthDatabase
}

const REQUIRED_SCHEMA_OBJECTS = [
  { type: 'table', name: 'analytics_event_dedupe' },
  { type: 'table', name: 'analytics_content_hourly' },
  { type: 'table', name: 'analytics_creator_hourly' },
  { type: 'table', name: 'analytics_rollup_watermark' },
  { type: 'table', name: 'analytics_reconciliation_status' },
  { type: 'table', name: 'analytics_projection_rebuild_state' },
  { type: 'index', name: 'analytics_event_dedupe_ingested_at_idx' },
  { type: 'index', name: 'analytics_event_dedupe_occurred_at_idx' },
  { type: 'index', name: 'analytics_event_dedupe_hour_start_idx' },
  { type: 'index', name: 'analytics_event_dedupe_pending_idx' },
  { type: 'index', name: 'analytics_content_hourly_content_time_idx' },
  { type: 'index', name: 'analytics_content_hourly_content_id_time_idx' },
  { type: 'index', name: 'analytics_content_hourly_time_idx' },
  { type: 'index', name: 'analytics_creator_hourly_creator_time_idx' },
] as const

const ANALYTICS_SCHEMA_PROBE = `
  SELECT type, name, sql
  FROM sqlite_master
  WHERE
    (type = 'table' AND name IN (
      'analytics_event_dedupe',
      'analytics_content_hourly',
      'analytics_creator_hourly',
      'analytics_rollup_watermark',
      'analytics_reconciliation_status',
      'analytics_projection_rebuild_state'
    ))
    OR
    (type = 'index' AND name IN (
      'analytics_event_dedupe_ingested_at_idx',
      'analytics_event_dedupe_occurred_at_idx',
      'analytics_event_dedupe_hour_start_idx',
      'analytics_event_dedupe_pending_idx',
      'analytics_content_hourly_content_time_idx',
      'analytics_content_hourly_content_id_time_idx',
      'analytics_content_hourly_time_idx',
      'analytics_creator_hourly_creator_time_idx'
    ))
`

const jsonResponse = (body: Record<string, string>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })

const notFound = (): Response =>
  new Response('Not Found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  })

const worker = {
  async fetch(request: Request, env: W11Env): Promise<Response> {
    const url = new URL(request.url)
    if (
      request.method !== 'GET' ||
      (url.pathname !== '/healthz' && url.pathname !== '/readyz')
    ) {
      return notFound()
    }

    if (url.pathname === '/healthz') {
      try {
        const probe = await env.D1_05.prepare('SELECT 1 AS ok').first()
        if (probe?.ok !== 1) throw new Error('D1-05 health probe returned no result')
        return jsonResponse({ worker: 'W11', status: 'ok', database: 'reachable' })
      } catch {
        // Do not leak provider errors, SQL details or configuration to callers.
        return jsonResponse({ worker: 'W11', status: 'degraded', database: 'unavailable' }, 503)
      }
    }

    try {
      const result = await env.D1_05.prepare(ANALYTICS_SCHEMA_PROBE).all()
      const schemaRows = result.results ?? []
      const found = new Set(
        schemaRows.map(({ type, name }) => `${type}:${name}`),
      )
      const eventLedgerDefinition = schemaRows.find(
        ({ type, name }) => type === 'table' && name === 'analytics_event_dedupe',
      )?.sql?.toUpperCase() ?? ''
      // A table/index-only probe can report ready while migration 0003 (which
      // admits the LATE status needed for durable quarantine/replay) is absent.
      const lateEventSchemaReady =
        eventLedgerDefinition.includes('PROJECTION_STATUS') &&
        eventLedgerDefinition.includes("'LATE'")
      const schemaReady =
        lateEventSchemaReady &&
        REQUIRED_SCHEMA_OBJECTS.every(({ type, name }) =>
          found.has(`${type}:${name}`),
        )

      if (!schemaReady) {
        return jsonResponse({
          worker: 'W11',
          status: 'not_ready',
          database: 'reachable',
          schema: 'incomplete',
        }, 503)
      }

      return jsonResponse({
        worker: 'W11',
        status: 'ready',
        database: 'reachable',
        schema: 'ready',
      })
    } catch {
      // The readiness surface is intentionally diagnostic-free for callers.
      return jsonResponse({
        worker: 'W11',
        status: 'degraded',
        database: 'unavailable',
        schema: 'unknown',
      }, 503)
    }
  },
}

export default worker

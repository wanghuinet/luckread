import { describe, expect, it, vi } from 'vitest'
import worker, { type W11Env } from './worker'
import type { AnalyticsD1PreparedStatement, AnalyticsD1Result } from './analytics-d1-store'

type SchemaRow = { type: string; name: string; sql?: string | null }
type HealthStatement = AnalyticsD1PreparedStatement & {
  first(): Promise<{ ok: number } | null>
  all(): Promise<{ results?: SchemaRow[] }>
}

const readySchemaRows: SchemaRow[] = [
  { type: 'table', name: 'analytics_event_dedupe', sql: "CREATE TABLE analytics_event_dedupe (source_worker TEXT CHECK (source_worker IN ('W01', 'W03', 'W05')), projection_status TEXT CHECK (projection_status IN ('PENDING', 'APPLIED', 'LATE')))" },
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
]

function environment(
  first: () => Promise<{ ok: number } | null>,
  all: () => Promise<{ results?: SchemaRow[] }> = async () => ({ results: readySchemaRows }),
  batch: (statements: AnalyticsD1PreparedStatement[]) => Promise<AnalyticsD1Result[]> =
    async (statements) => statements.map((_, index) => ({
      success: true,
      meta: { changes: index === 0 ? 1 : 0 },
    })),
): W11Env {
  return {
    D1_05: {
      prepare: vi.fn((query: string) => {
        const statement: HealthStatement = {
          bind: vi.fn((..._values: (string | number | null)[]) => statement),
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({ results: [] })),
        }
        if (query === 'SELECT 1 AS ok') {
          statement.first = vi.fn(first)
          return statement
        }
        if (query.includes('FROM sqlite_master')) {
          expect(query).toContain('SELECT type, name, sql')
          statement.all = vi.fn(all)
          return statement
        }
        return statement
      }),
      batch: vi.fn(batch),
    },
  }
}

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'evt_route_0001',
  dedupeKey: 'dedupe_route_0001',
  eventName: 'content_open',
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  sessionId: 'session_route_01',
  contentId: 'content_route_01',
  contentType: 'article',
  ...overrides,
})

const trustedHeaders = {
  'Content-Type': 'application/json',
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'corr_route_000001',
}

describe('W11 runtime boundary', () => {
  it('confirms the D1-05 binding with a minimal read-only health probe', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(new Request('https://w11.internal/healthz'), env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ worker: 'W11', status: 'ok', database: 'reachable' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(env.D1_05.prepare).toHaveBeenCalledTimes(1)
  })

  it('confirms readiness only when the late replay and W01 telemetry migrations are present', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(new Request('https://w11.internal/readyz'), env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      worker: 'W11',
      status: 'ready',
      database: 'reachable',
      schema: 'ready',
    })
    expect(env.D1_05.prepare).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(env.D1_05.prepare).mock.calls[0]?.[0])).toContain('sqlite_master')
  })

  it('does not report ready before the late-event replay migration is installed', async () => {
    const legacySchemaRows = readySchemaRows.map((row) =>
      row.type === 'table' && row.name === 'analytics_event_dedupe'
        ? { ...row, sql: "CREATE TABLE analytics_event_dedupe (source_worker TEXT CHECK (source_worker IN ('W01', 'W03', 'W05')), projection_status TEXT CHECK (projection_status IN ('PENDING', 'APPLIED')))" }
        : row,
    )
    const env = environment(async () => ({ ok: 1 }), async () => ({ results: legacySchemaRows }))
    const response = await worker.fetch(new Request('https://w11.internal/readyz'), env)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      worker: 'W11',
      status: 'not_ready',
      database: 'reachable',
      schema: 'incomplete',
    })
  })

  it('does not report ready before W01 is admitted as an event source', async () => {
    const legacySchemaRows = readySchemaRows.map((row) =>
      row.type === 'table' && row.name === 'analytics_event_dedupe'
        ? { ...row, sql: "CREATE TABLE analytics_event_dedupe (source_worker TEXT CHECK (source_worker IN ('W03', 'W05')), projection_status TEXT CHECK (projection_status IN ('PENDING', 'APPLIED', 'LATE')))" }
        : row,
    )
    const env = environment(async () => ({ ok: 1 }), async () => ({ results: legacySchemaRows }))
    const response = await worker.fetch(new Request('https://w11.internal/readyz'), env)
    expect(response.status).toBe(503)
  })

  it('accepts a bounded W01 content telemetry batch, derives actor fields, and persists aggregate counts only', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(
      new Request('https://w11.internal/internal/analytics/events', {
        method: 'POST',
        headers: { ...trustedHeaders, 'X-LuckRead-Principal-User-Id': 'user_route_01' },
        body: JSON.stringify({ events: [event()] }),
      }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json() as {
      data: { received: number; qualityCounts: { VALID: number }; persistence: { inserted: number } }
      requestId: string
    }
    expect(body.data.received).toBe(1)
    expect(body.data.qualityCounts.VALID).toBe(1)
    expect(body.data.persistence.inserted).toBe(1)
    expect(body.requestId).toBe('corr_route_000001')
    expect(env.D1_05.batch).toHaveBeenCalledTimes(1)
  })

  it('rejects missing W01 transport provenance without touching D1', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(
      new Request('https://w11.internal/internal/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-LuckRead-Transport-Version': '1.0' },
        body: JSON.stringify({ events: [event()] }),
      }),
      env,
    )
    expect(response.status).toBe(404)
    expect(env.D1_05.prepare).not.toHaveBeenCalled()
    expect(env.D1_05.batch).not.toHaveBeenCalled()
  })

  it('rejects client-originated social events on the telemetry transport', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(
      new Request('https://w11.internal/internal/analytics/events', {
        method: 'POST',
        headers: trustedHeaders,
        body: JSON.stringify({ events: [event({ eventName: 'like_created' })] }),
      }),
      env,
    )
    expect(response.status).toBe(422)
    expect(env.D1_05.batch).not.toHaveBeenCalled()
  })

  it('rejects event batches over the hard limit before persistence', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const events = Array.from({ length: 91 }, (_, index) => event({
      eventId: `evt_route_${String(index).padStart(4, '0')}`,
      dedupeKey: `dedupe_route_${String(index).padStart(4, '0')}`,
    }))
    const response = await worker.fetch(
      new Request('https://w11.internal/internal/analytics/events', {
        method: 'POST',
        headers: trustedHeaders,
        body: JSON.stringify({ events }),
      }),
      env,
    )
    expect(response.status).toBe(422)
    expect(env.D1_05.batch).not.toHaveBeenCalled()
  })

  it('keeps unadmitted analytics read endpoints closed', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(
      new Request('https://w11.internal/api/analytics/creators'),
      env,
    )
    expect(response.status).toBe(404)
    expect(env.D1_05.prepare).not.toHaveBeenCalled()
  })

  it('does not expose health or readiness endpoints to non-GET methods', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const healthResponse = await worker.fetch(
      new Request('https://w11.internal/healthz', { method: 'POST' }),
      env,
    )
    const readinessResponse = await worker.fetch(
      new Request('https://w11.internal/readyz', { method: 'POST' }),
      env,
    )
    expect(healthResponse.status).toBe(404)
    expect(readinessResponse.status).toBe(404)
    expect(env.D1_05.prepare).not.toHaveBeenCalled()
  })
})

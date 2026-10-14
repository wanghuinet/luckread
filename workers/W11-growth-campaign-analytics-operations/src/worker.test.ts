import { describe, expect, it, vi } from 'vitest'
import worker, { type W11Env } from './worker'

type SchemaRow = { type: string; name: string }

const readySchemaRows: SchemaRow[] = [
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
]

function environment(
  first: () => Promise<{ ok: number } | null>,
  all: () => Promise<{ results?: SchemaRow[] }> = async () => ({
    results: readySchemaRows,
  }),
): W11Env {
  return {
    D1_05: {
      prepare: vi.fn((query: string) => {
        if (query === 'SELECT 1 AS ok') {
          return {
            first: vi.fn(first),
            all: vi.fn(async () => ({ results: [] })),
          }
        }

        expect(query).toContain('FROM sqlite_master')
        return {
          first: vi.fn(async () => null),
          all: vi.fn(all),
        }
      }),
    },
  }
}

describe('W11 runtime boundary', () => {
  it('confirms the D1-05 binding with a minimal read-only health probe', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(
      new Request('https://w11.internal/healthz'),
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      worker: 'W11',
      status: 'ok',
      database: 'reachable',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(env.D1_05.prepare).toHaveBeenCalledTimes(1)
  })

  it('reports ready only when every required table and index is present', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(
      new Request('https://w11.internal/readyz'),
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      worker: 'W11',
      status: 'ready',
      database: 'reachable',
      schema: 'ready',
    })
    expect(env.D1_05.prepare).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(env.D1_05.prepare).mock.calls[0]?.[0])).toContain(
      'sqlite_master',
    )
  })

  it('returns 503 when the database is reachable but the analytics schema is incomplete', async () => {
    const env = environment(async () => ({ ok: 1 }), async () => ({
      results: readySchemaRows.filter(
        (row) => row.name !== 'analytics_content_hourly_content_id_time_idx',
      ),
    }))
    const response = await worker.fetch(
      new Request('https://w11.internal/readyz'),
      env,
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      worker: 'W11',
      status: 'not_ready',
      database: 'reachable',
      schema: 'incomplete',
    })
  })

  it('returns a sanitized degraded response when a readiness probe fails', async () => {
    const env = environment(async () => ({ ok: 1 }), async () => {
      throw new Error('sensitive provider configuration')
    })
    const response = await worker.fetch(
      new Request('https://w11.internal/readyz'),
      env,
    )

    expect(response.status).toBe(503)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({
      worker: 'W11',
      status: 'degraded',
      database: 'unavailable',
      schema: 'unknown',
    })
    expect(body).not.toContain('sensitive provider configuration')
  })

  it('keeps analytics data routes closed until an admitted transport is connected', async () => {
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

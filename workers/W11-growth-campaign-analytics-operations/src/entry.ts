import worker, { type W11PostgresEnv } from './worker.js'
import {
  getW11AnalyticsPostgresPool,
  type W11AnalyticsHyperdriveBinding,
} from './analytics-postgres-runtime.js'

interface W11NeonEnv {
  W11_DATABASE_DRIVER?: string
  W11_ANALYTICS_INGEST_ENABLED?: string
  HYPERDRIVE_ANALYTICS_PG?: W11AnalyticsHyperdriveBinding
}

/**
 * Neon-only deployment entrypoint. It passes a native PostgreSQL pool to the
 * worker and deliberately has no D1_05 compatibility binding or fallback.
 */
const entry = {
  async fetch(request: Request, env: W11NeonEnv): Promise<Response> {
    if (env.W11_DATABASE_DRIVER !== 'neon') {
      return new Response(JSON.stringify({
        worker: 'W11',
        status: 'degraded',
        database: 'unconfigured',
      }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    }

    try {
      const pool = getW11AnalyticsPostgresPool(
        env.HYPERDRIVE_ANALYTICS_PG as W11AnalyticsHyperdriveBinding,
      )
      return worker.fetch(request, {
        W11_POSTGRES: pool,
        W11_ANALYTICS_INGEST_ENABLED: env.W11_ANALYTICS_INGEST_ENABLED,
      } satisfies W11PostgresEnv)
    } catch {
      return new Response(JSON.stringify({
        worker: 'W11',
        status: 'degraded',
        database: 'unavailable',
      }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    }
  },
}

export default entry

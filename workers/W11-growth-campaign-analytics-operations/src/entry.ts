import worker, { type W11Env } from './worker.js'
import {
  getW11AnalyticsPostgresDatabase,
  type W11AnalyticsHyperdriveBinding,
} from './analytics-postgres-runtime.js'

interface W11NeonEnv {
  W11_DATABASE_DRIVER?: string
  HYPERDRIVE_ANALYTICS_PG?: W11AnalyticsHyperdriveBinding
}

/**
 * Neon-only deployment entrypoint. This wrapper deliberately does not fall
 * back to D1 when the driver or Hyperdrive binding is absent.
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
      const database = getW11AnalyticsPostgresDatabase(
        env.HYPERDRIVE_ANALYTICS_PG as W11AnalyticsHyperdriveBinding,
      )
      /**
       * @deprecated-next-version
       * Reason: Neon analytics database is still injected into a D1_05-shaped worker contract.
       * Replacement: Native PostgreSQL analytics repository/worker contract.
       * Removal: Next release.
       * Condition: worker.ts and analytics-ingest use PostgreSQL-native stores and no longer require D1_05.
       */
      const compatibleEnv = {
        ...env,
        D1_05: database,
      } as unknown as W11Env
      return worker.fetch(request, compatibleEnv)
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

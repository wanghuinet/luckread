import { Pool } from 'pg'

import type { AnalyticsPostgresPool } from './analytics-postgres-store.js'

export interface W11AnalyticsHyperdriveBinding {
  connectionString?: string
}

interface RuntimeState {
  pool: Pool
}

const runtimes = new WeakMap<object, RuntimeState>()

function validateConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('W11_ANALYTICS_HYPERDRIVE_CONNECTION_STRING_REQUIRED')
  }

  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new Error('W11_ANALYTICS_HYPERDRIVE_CONNECTION_STRING_INVALID')
  }

  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !target.hostname ||
    target.pathname.length < 2
  ) {
    throw new Error('W11_ANALYTICS_HYPERDRIVE_CONNECTION_STRING_INVALID')
  }

  return value
}

/** Lazily constructs one bounded native PostgreSQL pool per Hyperdrive binding. */
export function getW11AnalyticsPostgresPool(
  binding: W11AnalyticsHyperdriveBinding,
): AnalyticsPostgresPool {
  if (!binding || typeof binding !== 'object') {
    throw new Error('W11_ANALYTICS_HYPERDRIVE_BINDING_REQUIRED')
  }

  const cached = runtimes.get(binding)
  if (cached) return cached.pool as unknown as AnalyticsPostgresPool

  const pool = new Pool({
    connectionString: validateConnectionString(binding.connectionString),
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  })

  pool.on('error', (error) => {
    console.error(JSON.stringify({
      event: 'w11.analytics.postgres.pool_error',
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    }))
  })

  runtimes.set(binding, { pool })
  return pool as unknown as AnalyticsPostgresPool
}

/**
 * Closes the cached pool created for a disposable integration-test binding.
 * Workers do not call this: Hyperdrive pools live for the isolate lifetime.
 */
export async function closeW11AnalyticsPostgresPoolForTest(
  binding: W11AnalyticsHyperdriveBinding,
): Promise<void> {
  const runtime = runtimes.get(binding)
  if (!runtime) return
  runtimes.delete(binding)
  await runtime.pool.end()
}

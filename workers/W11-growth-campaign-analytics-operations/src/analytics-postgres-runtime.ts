import { Pool } from 'pg'

import {
  createPostgresAnalyticsDatabase,
  type AnalyticsPostgresPool,
} from './analytics-postgres-store.js'

export interface W11AnalyticsHyperdriveBinding {
  connectionString?: string
}

const databases = new WeakMap<object, ReturnType<typeof createPostgresAnalyticsDatabase>>()

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

/** Lazily constructs one bounded PostgreSQL pool per Hyperdrive binding. */
export function getW11AnalyticsPostgresDatabase(
  binding: W11AnalyticsHyperdriveBinding,
): ReturnType<typeof createPostgresAnalyticsDatabase> {
  if (!binding || typeof binding !== 'object') {
    throw new Error('W11_ANALYTICS_HYPERDRIVE_BINDING_REQUIRED')
  }

  const cached = databases.get(binding)
  if (cached) return cached

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

  const database = createPostgresAnalyticsDatabase(
    pool as unknown as AnalyticsPostgresPool,
  )
  databases.set(binding, database)
  return database
}

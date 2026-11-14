import { Pool } from 'pg'

import {
  createD1W08CreatorStore,
  createPostgresW08CreatorStore,
  type W08CreatorStore,
  type W08D1Database,
} from '../creator-store.js'

export type W08DatabaseDriver = 'd1' | 'neon'

export type W08RuntimeEnv = Readonly<{
  D1_01?: W08D1Database
  W08_DATABASE_DRIVER?: string
  HYPERDRIVE?: Readonly<{ connectionString?: string }>
}>

const pools = new WeakMap<object, Pool>()
const stores = new WeakMap<object, W08CreatorStore>()

/** Wrangler selects Neon for production; D1 remains an explicit rollback and local fallback. */
export function resolveW08DatabaseDriver(env: W08RuntimeEnv): W08DatabaseDriver {
  const configured = env.W08_DATABASE_DRIVER?.trim().toLowerCase() || 'd1'
  if (configured === 'd1' || configured === 'neon') return configured
  throw new Error('W08_DATABASE_DRIVER_UNSUPPORTED')
}

function hyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('W08_HYPERDRIVE_CONNECTION_STRING_REQUIRED')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('W08_HYPERDRIVE_CONNECTION_STRING_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2
  ) {
    throw new Error('W08_HYPERDRIVE_CONNECTION_STRING_INVALID')
  }
  return value
}

export function getW08PostgresPool(env: W08RuntimeEnv): Pool {
  if (resolveW08DatabaseDriver(env) !== 'neon') {
    throw new Error('W08_POSTGRES_POOL_REQUIRES_NEON_DRIVER')
  }
  const binding = env.HYPERDRIVE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W08_HYPERDRIVE_BINDING_REQUIRED')
  }
  const cached = pools.get(binding)
  if (cached) return cached

  const pool = new Pool({
    connectionString: hyperdriveConnectionString(binding.connectionString),
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  })
  pool.on('error', (error) => {
    console.error(JSON.stringify({
      event: 'w08.postgres.pool_error',
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    }))
  })
  pools.set(binding, pool)
  return pool
}

/**
 * Every W08-owned creator table is selected from one provider. W02 identity
 * and RoleAssignment operations remain on the existing W02 Service Binding.
 */
export function getW08CreatorStore(env: W08RuntimeEnv): W08CreatorStore {
  const driver = resolveW08DatabaseDriver(env)
  if (driver === 'd1') {
    if (!env.D1_01) throw new Error('W08_D1_01_BINDING_REQUIRED')
    return createD1W08CreatorStore(env.D1_01)
  }

  const binding = env.HYPERDRIVE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W08_HYPERDRIVE_BINDING_REQUIRED')
  }
  const cached = stores.get(binding)
  if (cached) return cached
  const store = createPostgresW08CreatorStore(getW08PostgresPool(env))
  stores.set(binding, store)
  return store
}

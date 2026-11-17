import { Pool } from 'pg'

import { createPostgresW08CreatorStore, type W08CreatorStore } from '../creator-store.js'

/** W08 database provider is PostgreSQL only. */
export type W08DatabaseDriver = 'neon'

export type W08RuntimeEnv = Readonly<{
  W08_DATABASE_DRIVER?: string
  HYPERDRIVE?: Readonly<{ connectionString?: string }>
}>

const pools = new WeakMap<object, Pool>()
const stores = new WeakMap<object, W08CreatorStore>()

/** W08 production and runtime are Neon-only; legacy D1 driver selection is rejected. */
export function resolveW08DatabaseDriver(env: W08RuntimeEnv): W08DatabaseDriver {
  const configured = env.W08_DATABASE_DRIVER?.trim().toLowerCase() || 'neon'
  if (configured !== 'neon') throw new Error('W08_DATABASE_DRIVER_UNSUPPORTED')
  return 'neon'
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
  resolveW08DatabaseDriver(env)
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

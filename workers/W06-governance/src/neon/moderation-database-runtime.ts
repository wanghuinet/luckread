import { Pool } from 'pg'

import { createPostgresModerationD1Database } from '../neon-postgres-d1-database.js'
import { createPostgresModerationQueueReadStore } from '../moderation-queue-read-store-postgres.js'
import type { ModerationQueueReadStore } from '../moderation-queue-read-store.js'

export type W06ModerationDatabaseDriver = 'd1' | 'neon'

export type W06ModerationDatabaseRuntimeEnv = Readonly<{
  D1_03: D1Database
  W06_MODERATION_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_03?: Readonly<{ connectionString?: string }>
}>

const pools = new WeakMap<object, Pool>()
const databases = new WeakMap<object, D1Database>()
const queueStores = new WeakMap<object, ModerationQueueReadStore>()

export function resolveW06ModerationDatabaseDriver(
  env: W06ModerationDatabaseRuntimeEnv,
): W06ModerationDatabaseDriver {
  const configured = env.W06_MODERATION_DATABASE_DRIVER?.trim().toLowerCase() || 'd1'
  if (configured === 'd1' || configured === 'neon') return configured
  throw new Error('W06_MODERATION_DATABASE_DRIVER_UNSUPPORTED')
}

function validateHyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('W06_HYPERDRIVE_D1_03_CONNECTION_STRING_REQUIRED')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('W06_HYPERDRIVE_D1_03_CONNECTION_STRING_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2 ||
    decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) !== 'luckread_governance'
  ) {
    throw new Error('W06_HYPERDRIVE_D1_03_CONNECTION_STRING_INVALID')
  }
  return value
}

export function getW06ModerationPostgresPool(env: W06ModerationDatabaseRuntimeEnv): Pool {
  if (resolveW06ModerationDatabaseDriver(env) !== 'neon') {
    throw new Error('W06_POSTGRES_POOL_REQUIRES_NEON_DRIVER')
  }
  const binding = env.HYPERDRIVE_D1_03
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_D1_03_BINDING_REQUIRED')
  }
  const cached = pools.get(binding)
  if (cached) return cached

  const pool = new Pool({
    connectionString: validateHyperdriveConnectionString(binding.connectionString),
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  })
  pool.on('error', (error) => {
    console.error(JSON.stringify({
      event: 'w06.moderation.postgres.pool_error',
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    }))
  })
  pools.set(binding, pool)
  return pool
}

export function getW06ModerationDatabase(env: W06ModerationDatabaseRuntimeEnv): D1Database {
  if (resolveW06ModerationDatabaseDriver(env) === 'd1') {
    if (!env.D1_03) throw new Error('W06_D1_03_BINDING_REQUIRED')
    return env.D1_03
  }

  const binding = env.HYPERDRIVE_D1_03
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_D1_03_BINDING_REQUIRED')
  }
  const cached = databases.get(binding)
  if (cached) return cached

  const database = createPostgresModerationD1Database(getW06ModerationPostgresPool(env))
  databases.set(binding, database)
  return database
}

/** Dedicated PostgreSQL projection preserves native keyset timestamp precision. */
export function getW06ModerationQueueReadStore(
  env: W06ModerationDatabaseRuntimeEnv,
): ModerationQueueReadStore | undefined {
  if (resolveW06ModerationDatabaseDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_03
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_D1_03_BINDING_REQUIRED')
  }
  const cached = queueStores.get(binding)
  if (cached) return cached

  const store = createPostgresModerationQueueReadStore(getW06ModerationPostgresPool(env))
  queueStores.set(binding, store)
  return store
}

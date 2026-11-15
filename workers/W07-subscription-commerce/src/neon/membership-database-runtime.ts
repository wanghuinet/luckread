import { Pool, type PoolConfig } from 'pg'

import { createPostgresD1Database, type W07WebhookPostgresPool } from '../payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from '../subscription-runtime.js'

export type W07MembershipDatabaseRuntimeEnv = Readonly<{
  D1_01: D1Database
  W07_MEMBERSHIP_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_01?: Readonly<{ connectionString?: string }>
}>

type W07MembershipPoolFactory = (config: PoolConfig) => Pool

const pools = new WeakMap<object, Pool>()
const databases = new WeakMap<object, D1Database>()

export function resolveW07MembershipDatabaseDriver(
  env: W07MembershipDatabaseRuntimeEnv,
): 'd1' | 'neon' {
  const configured = env.W07_MEMBERSHIP_DATABASE_DRIVER?.trim().toLowerCase() || 'd1'
  if (configured === 'd1' || configured === 'neon') return configured
  throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
}

function validateD101HyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  let databaseName = ''
  try {
    databaseName = decodeURIComponent(target.pathname.replace(/^\\/+/, ''))
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !target.hostname ||
    databaseName !== 'luckread'
  ) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  return value
}

function getW07MembershipPostgresPool(
  env: W07MembershipDatabaseRuntimeEnv,
  poolFactory: W07MembershipPoolFactory,
): Pool {
  const binding = env.HYPERDRIVE_D1_01
  if (!binding || typeof binding !== 'object') {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const cached = pools.get(binding)
  if (cached) return cached

  const connectionString = validateD101HyperdriveConnectionString(binding.connectionString)
  const pool = poolFactory({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  })
  pool.on('error', (error) => {
    console.error(JSON.stringify({
      event: 'w07.membership.postgres.pool_error',
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    }))
  })
  pools.set(binding, pool)
  return pool
}

/**
 * Selects the D1-01 membership database. The existing W07 D1_01 business logic
 * runs through the PostgreSQL compatibility bridge when Neon is explicitly
 * selected; D1 remains the default and rollback binding.
 */
export function getW07SelectedD101Database(
  env: W07MembershipDatabaseRuntimeEnv,
  poolFactory: W07MembershipPoolFactory = (config) => new Pool(config),
): D1Database {
  if (resolveW07MembershipDatabaseDriver(env) === 'd1') return env.D1_01

  const binding = env.HYPERDRIVE_D1_01
  if (!binding || typeof binding !== 'object') {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const cached = databases.get(binding)
  if (cached) return cached

  const pool = getW07MembershipPostgresPool(env, poolFactory)
  const database = createPostgresD1Database(pool as unknown as W07WebhookPostgresPool)
  databases.set(binding, database)
  return database
}

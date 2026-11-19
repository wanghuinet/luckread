import { Pool, type PoolConfig } from 'pg'

import type { W07WebhookPostgresPool } from '../payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from '../subscription-runtime.js'

export type W07MembershipDatabaseRuntimeEnv = Readonly<{
  W07_MEMBERSHIP_DATABASE_DRIVER?: string
  HYPERDRIVE_MEMBERSHIP_DB?: Readonly<{ connectionString?: string }>
}>

type W07MembershipPoolFactory = (config: PoolConfig) => Pool

const pools = new WeakMap<object, Pool>()

export function resolveW07MembershipDatabaseDriver(
  env: W07MembershipDatabaseRuntimeEnv,
): 'neon' {
  const configured = env.W07_MEMBERSHIP_DATABASE_DRIVER?.trim().toLowerCase() || 'neon'
  if (configured !== 'neon') throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  return 'neon'
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
    databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ''))
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

function getOrCreateW07MembershipPostgresPool(
  env: W07MembershipDatabaseRuntimeEnv,
  poolFactory: W07MembershipPoolFactory,
): Pool {
  const binding = env.HYPERDRIVE_MEMBERSHIP_DB
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

/** Return the shared native D1-01 pool for PostgreSQL membership stores. */
export function getW07MembershipPostgresPool(
  env: W07MembershipDatabaseRuntimeEnv,
  poolFactory: W07MembershipPoolFactory = (config) => new Pool(config),
): W07WebhookPostgresPool {
  resolveW07MembershipDatabaseDriver(env)
  return getOrCreateW07MembershipPostgresPool(env, poolFactory) as unknown as W07WebhookPostgresPool
}

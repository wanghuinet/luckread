import { Pool, type PoolConfig } from 'pg'

import {
  PaymentMethodRuntimeError,
} from '../payment-method-runtime.js'
import { createPostgresPaymentMethodReadStore } from '../payment-method-read-store-postgres.js'
import type { PaymentMethodReadStore } from '../payment-method-read-store.js'
import { createPostgresWebhookD1Database } from '../payment-webhook-database-postgres.js'
import type { W07WebhookPostgresPool } from '../payment-webhook-database-postgres.js'

export type W07PaymentMethodReadRuntimeEnv = Readonly<{
  W07_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_04?: { connectionString?: string }
}>

type W07PoolFactory = (config: PoolConfig) => Pool

const pools = new WeakMap<object, Pool>()
const stores = new WeakMap<object, PaymentMethodReadStore>()
const webhookDatabases = new WeakMap<object, D1Database>()

export function resolveW07DatabaseDriver(
  env: W07PaymentMethodReadRuntimeEnv,
): 'd1' | 'neon' {
  const configured = env.W07_DATABASE_DRIVER?.trim().toLowerCase() || 'd1'
  if (configured === 'd1' || configured === 'neon') return configured
  throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
}

function validateHyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !target.hostname ||
    target.pathname.length < 2
  ) {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  return value
}

function getW07PostgresPool(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory,
): Pool | undefined {
  if (resolveW07DatabaseDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_04
  if (!binding || typeof binding !== 'object') {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  let pool = pools.get(binding)
  if (!pool) {
    const connectionString = validateHyperdriveConnectionString(binding.connectionString)
    pool = poolFactory({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    })
    pool.on('error', (error) => {
      console.error(JSON.stringify({
        event: 'w07.payment_method.postgres.pool_error',
        errorType: error instanceof Error ? error.name : 'UNKNOWN',
      }))
    })
    pools.set(binding, pool)
  }
  return pool
}

/**
 * Neon composition for the W07 D1-04 Hyperdrive binding. The same bounded
 * pool is shared by the payment-method store and the signed-webhook database
 * bridge. D1 remains the default when W07_DATABASE_DRIVER is unset.
 */
export function getW07PaymentMethodReadStore(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): PaymentMethodReadStore | undefined {
  if (resolveW07DatabaseDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_04
  if (!binding || typeof binding !== 'object') {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const cachedStore = stores.get(binding)
  if (cachedStore) return cachedStore

  const pool = getW07PostgresPool(env, poolFactory)
  if (!pool) throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  const store = createPostgresPaymentMethodReadStore(pool)
  stores.set(binding, store)
  return store
}

/**
 * Select the D1-04 webhook persistence database. In Neon mode this exposes
 * the existing webhook business logic through a D1-compatible PostgreSQL
 * adapter whose batch operation is one explicit PostgreSQL transaction.
 */
export function getW07PaymentWebhookDatabase(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): D1Database | undefined {
  if (resolveW07DatabaseDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_04
  if (!binding || typeof binding !== 'object') {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const cachedDatabase = webhookDatabases.get(binding)
  if (cachedDatabase) return cachedDatabase

  const pool = getW07PostgresPool(env, poolFactory)
  if (!pool) throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  const database = createPostgresWebhookD1Database(pool as unknown as W07WebhookPostgresPool)
  webhookDatabases.set(binding, database)
  return database
}

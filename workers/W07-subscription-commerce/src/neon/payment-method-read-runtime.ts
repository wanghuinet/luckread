import { Pool, type PoolConfig } from 'pg'

import {
  PaymentMethodRuntimeError,
} from '../payment-method-runtime.js'
import { createPostgresPaymentMethodReadStore } from '../payment-method-read-store-postgres.js'
import { createPostgresOrderCreateStore, type OrderPersistencePostgresPool } from '../order-create-store-postgres.js'
import type { OrderCreatePersistenceStore } from '../order-persistence.js'
import type { PaymentMethodReadStore } from '../payment-method-read-store.js'
import type { W07WebhookPostgresPool } from '../payment-webhook-database-postgres.js'
import { createPostgresRevenueCatWebhookReceiptStore } from '../revenuecat-webhook-postgres-persistence.js'
import type { RevenueCatWebhookReceiptStore } from '../revenuecat-webhook-persistence.js'

export type W07PaymentMethodReadRuntimeEnv = Readonly<{
  W07_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_04?: { connectionString?: string }
  W07_MEMBERSHIP_DATABASE_DRIVER?: string
}>

type W07PoolFactory = (config: PoolConfig) => Pool

const pools = new WeakMap<object, Pool>()
const stores = new WeakMap<object, PaymentMethodReadStore>()
const orderCreateStores = new WeakMap<object, OrderCreatePersistenceStore>()
const revenueCatReceiptStores = new WeakMap<object, RevenueCatWebhookReceiptStore>()

/** W07 finance persistence is Neon-only; reject stale D1 selector configuration. */
export function resolveW07DatabaseDriver(
  env: W07PaymentMethodReadRuntimeEnv,
): 'neon' {
  const configured = env.W07_DATABASE_DRIVER?.trim().toLowerCase()
  if (!configured || configured === 'neon') return 'neon'
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
): Pool {
  resolveW07DatabaseDriver(env)

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

/** Resolve the native PostgreSQL payment-method read Store. */
export function getW07PaymentMethodReadStore(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): PaymentMethodReadStore {
  const binding = env.HYPERDRIVE_D1_04
  if (!binding || typeof binding !== 'object') {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const cachedStore = stores.get(binding)
  if (cachedStore) return cachedStore

  const store = createPostgresPaymentMethodReadStore(getW07PostgresPool(env, poolFactory))
  stores.set(binding, store)
  return store
}

/** Return the shared Neon Hyperdrive pool for native PostgreSQL finance Stores. */
export function getW07PaymentWebhookPostgresPool(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): W07WebhookPostgresPool {
  return getW07PostgresPool(env, poolFactory) as unknown as W07WebhookPostgresPool
}

/** Resolve the native RevenueCat inbox Store on the shared finance Pool. */
export function getW07RevenueCatWebhookReceiptStore(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): RevenueCatWebhookReceiptStore {
  const binding = env.HYPERDRIVE_D1_04
  if (!binding || typeof binding !== 'object') {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const cached = revenueCatReceiptStores.get(binding)
  if (cached) return cached
  const store = createPostgresRevenueCatWebhookReceiptStore(
    getW07PostgresPool(env, poolFactory) as unknown as W07WebhookPostgresPool,
  )
  revenueCatReceiptStores.set(binding, store)
  return store
}

/**
 * Close the Neon pool cached by the real W07 Worker entrypoint in a disposable
 * PostgreSQL integration test. Production isolates keep this pool for their
 * lifetime and never call this helper.
 */
export async function closeW07PostgresRuntimeForTest(
  env: W07PaymentMethodReadRuntimeEnv,
): Promise<void> {
  const binding = env.HYPERDRIVE_D1_04
  if (!binding || typeof binding !== 'object') return
  const pool = pools.get(binding)
  if (!pool) return

  pools.delete(binding)
  stores.delete(binding)
  orderCreateStores.delete(binding)
  revenueCatReceiptStores.delete(binding)
  await pool.end()
}

/** Reuse the atomic order-create adapter over the shared bounded Hyperdrive pool. */
export function getW07OrderCreatePersistenceStore(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): OrderCreatePersistenceStore {
  const binding = env.HYPERDRIVE_D1_04
  if (!binding || typeof binding !== 'object') {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const cached = orderCreateStores.get(binding)
  if (cached) return cached
  const store = createPostgresOrderCreateStore(
    getW07PostgresPool(env, poolFactory) as unknown as OrderPersistencePostgresPool,
  )
  orderCreateStores.set(binding, store)
  return store
}

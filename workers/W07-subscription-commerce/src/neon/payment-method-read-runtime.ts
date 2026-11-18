import { Pool, type PoolConfig } from 'pg'

import {
  PaymentMethodRuntimeError,
} from '../payment-method-runtime.js'
import { createPostgresPaymentMethodReadStore } from '../payment-method-read-store-postgres.js'
import { createPostgresOrderCreateStore, type OrderPersistencePostgresPool } from '../order-create-store-postgres.js'
import type { OrderCreatePersistenceStore } from '../order-persistence.js'
import type { PaymentMethodReadStore } from '../payment-method-read-store.js'
import { createPostgresWebhookD1Database, type W07WebhookPostgresPool } from '../payment-webhook-database-postgres.js'
import { createPostgresRevenueCatWebhookReceiptStore } from '../revenuecat-webhook-postgres-persistence.js'
import type { RevenueCatWebhookReceiptStore } from '../revenuecat-webhook-persistence.js'

export type W07PaymentMethodReadRuntimeEnv = Readonly<{
  D1_04?: D1Database
  W07_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_04?: { connectionString?: string }
  W07_MEMBERSHIP_DATABASE_DRIVER?: string
}>

type W07PoolFactory = (config: PoolConfig) => Pool

const pools = new WeakMap<object, Pool>()
const stores = new WeakMap<object, PaymentMethodReadStore>()
const webhookDatabases = new WeakMap<object, D1Database>()
const orderCreateStores = new WeakMap<object, OrderCreatePersistenceStore>()
const revenueCatReceiptStores = new WeakMap<object, RevenueCatWebhookReceiptStore>()

export function resolveW07DatabaseDriver(
  env: W07PaymentMethodReadRuntimeEnv,
): 'd1' | 'neon' {
  const configured = env.W07_DATABASE_DRIVER?.trim().toLowerCase() || 'neon'
  /**
   * @deprecated-next-version
   * Reason: The explicit legacy D1 selector remains only for existing D1-backed SQL consumers and isolated tests.
   * Replacement: The existing D1-04 Neon Hyperdrive bridge and PostgreSQL-native payment/order Stores.
   * Removal: Next release.
   * Condition: All W07 finance consumers and tests use PostgreSQL-native Stores instead of D1Database.
   */
  if (configured === 'd1') return 'd1'
  if (configured === 'neon') return 'neon'
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
 * Neon composition for the W07 D1-04 domain. The same bounded Hyperdrive pool
 * is shared by payment-method reads, order creation and signed-webhook writes.
 * D1 compatibility is available only for explicit local/test profiles.
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
/** Return the existing D1-04 Hyperdrive pool for native PostgreSQL webhook stores. */
export function getW07PaymentWebhookPostgresPool(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): W07WebhookPostgresPool | undefined {
  const pool = getW07PostgresPool(env, poolFactory)
  return pool ? pool as unknown as W07WebhookPostgresPool : undefined
}

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

/** Resolve the native RevenueCat inbox Store on the shared D1-04 Hyperdrive Pool. */
export function getW07RevenueCatWebhookReceiptStore(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): RevenueCatWebhookReceiptStore | undefined {
  if (resolveW07DatabaseDriver(env) === 'd1') return undefined
  const binding = env.HYPERDRIVE_D1_04
  if (!binding || typeof binding !== 'object') throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  const cached = revenueCatReceiptStores.get(binding)
  if (cached) return cached
  const pool = getW07PostgresPool(env, poolFactory)
  if (!pool) throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  const store = createPostgresRevenueCatWebhookReceiptStore(pool as unknown as W07WebhookPostgresPool)
  revenueCatReceiptStores.set(binding, store)
  return store
}


/** Resolve the one selected D1-04 finance database for W07 business paths. */
export function getW07SelectedD104Database(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): D1Database {
  const selected = getW07PaymentWebhookDatabase(env, poolFactory)
  if (selected) return selected
  if (!env.D1_04) throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  return env.D1_04
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
  webhookDatabases.delete(binding)
  orderCreateStores.delete(binding)
  revenueCatReceiptStores.delete(binding)
  await pool.end()
}

/** Reuse the existing atomic order-create adapter over the shared bounded Hyperdrive pool. */
export function getW07OrderCreatePersistenceStore(
  env: W07PaymentMethodReadRuntimeEnv,
  poolFactory: W07PoolFactory = (config) => new Pool(config),
): OrderCreatePersistenceStore | undefined {
  if (resolveW07DatabaseDriver(env) === 'd1') return undefined
  const binding = env.HYPERDRIVE_D1_04
  if (!binding || typeof binding !== 'object') {
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const cached = orderCreateStores.get(binding)
  if (cached) return cached
  const pool = getW07PostgresPool(env, poolFactory)
  if (!pool) throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503)
  const store = createPostgresOrderCreateStore(pool as unknown as OrderPersistencePostgresPool)
  orderCreateStores.set(binding, store)
  return store
}

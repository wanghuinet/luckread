import { Pool, type PoolConfig } from 'pg'

import {
  PaymentMethodRuntimeError,
} from '../payment-method-runtime.js'
import { createPostgresPaymentMethodReadStore } from '../payment-method-read-store-postgres.js'
import type { PaymentMethodReadStore } from '../payment-method-read-store.js'

export type W07PaymentMethodReadRuntimeEnv = Readonly<{
  W07_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_04?: { connectionString?: string }
}>

type W07PoolFactory = (config: PoolConfig) => Pool

const pools = new WeakMap<object, Pool>()
const stores = new WeakMap<object, PaymentMethodReadStore>()

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

/**
 * Read-only PAY-003 adapter composition. D1 remains the runtime default;
 * Neon uses only the existing D1-04 Hyperdrive connection and existing
 * payment-method read adapter. Mutation, provider-webhook and revocation
 * persistence are intentionally not composed here.
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

  const connectionString = validateHyperdriveConnectionString(binding.connectionString)
  let pool = pools.get(binding)
  if (!pool) {
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

  const store = createPostgresPaymentMethodReadStore(pool)
  stores.set(binding, store)
  return store
}

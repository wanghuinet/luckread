import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

import {
  getW07OrderCreatePersistenceStore,
  getW07PaymentMethodReadStore,
  getW07PaymentWebhookPostgresPool,
  getW07RevenueCatWebhookReceiptStore,
  resolveW07DatabaseDriver,
} from './payment-method-read-runtime.js'

describe('W07 payment-method Neon read runtime', () => {
  it('defaults to Neon and rejects the retired D1 finance driver', () => {
    const pool = { on: vi.fn(), query: vi.fn(), connect: vi.fn() } as unknown as Pool
    const poolFactory = vi.fn(() => pool)
    const binding = {
      connectionString: 'postgresql://user:password@localhost:5432/luckread_finance',
    }
    const neonEnv = { HYPERDRIVE_D1_04: binding }

    expect(resolveW07DatabaseDriver({})).toBe('neon')
    expect(resolveW07DatabaseDriver(neonEnv)).toBe('neon')
    expect(getW07PaymentMethodReadStore(neonEnv, poolFactory)).toBeDefined()
    expect(poolFactory).toHaveBeenCalledTimes(1)

    const legacyEnv = { W07_DATABASE_DRIVER: 'd1', HYPERDRIVE_D1_04: binding }
    expect(() => resolveW07DatabaseDriver(legacyEnv)).toThrow('SERVICE_UNAVAILABLE')
    expect(() => getW07PaymentMethodReadStore(legacyEnv, poolFactory)).toThrow('SERVICE_UNAVAILABLE')
    expect(poolFactory).toHaveBeenCalledTimes(1)
  })

  it('fails closed on unsupported driver, missing Hyperdrive or invalid connection string', () => {
    expect(() => resolveW07DatabaseDriver({ W07_DATABASE_DRIVER: 'postgres' }))
      .toThrow('SERVICE_UNAVAILABLE')
    expect(() => getW07PaymentMethodReadStore({ W07_DATABASE_DRIVER: 'neon' }))
      .toThrow('SERVICE_UNAVAILABLE')
    expect(() => getW07PaymentMethodReadStore({
      W07_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_04: { connectionString: 'https://example.test/database' },
    })).toThrow('SERVICE_UNAVAILABLE')
  })

  it('reuses one Pool and wires native PostgreSQL Stores over the same owner-scoped runtime', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const pool = {
      on: vi.fn(),
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values })
        return { rows: [] }
      }),
    } as unknown as Pool
    const poolFactory = vi.fn(() => pool)
    const binding = {
      connectionString: 'postgresql://user:password@localhost:5432/luckread',
    }
    const env = { W07_DATABASE_DRIVER: 'neon', HYPERDRIVE_D1_04: binding }

    const first = getW07PaymentMethodReadStore(env, poolFactory)
    const second = getW07PaymentMethodReadStore(env, poolFactory)
    const directWebhookPool = getW07PaymentWebhookPostgresPool(env, poolFactory)
    const revenueCatStore = getW07RevenueCatWebhookReceiptStore(env, poolFactory)
    const secondRevenueCatStore = getW07RevenueCatWebhookReceiptStore(env, poolFactory)
    const orderCreateStore = getW07OrderCreatePersistenceStore(env, poolFactory)
    const secondOrderCreateStore = getW07OrderCreatePersistenceStore(env, poolFactory)

    expect(orderCreateStore).toBeDefined()
    expect(orderCreateStore).toBe(secondOrderCreateStore)
    expect(first).toBeDefined()
    expect(first).toBe(second)
    expect(directWebhookPool).toBe(pool)
    expect(revenueCatStore).toBeDefined()
    expect(revenueCatStore).toBe(secondRevenueCatStore)
    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(pool.on).toHaveBeenCalledTimes(1)

    await first.listSavedPaymentMethodRecords('customer_01', 'merchant_01')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['hyperswitch', 'merchant_01', 'customer_01'])
    expect(calls[0]?.sql).toContain('s.customer_id = $3')
    expect(calls[0]?.sql).toContain('LIMIT 100')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

import {
  getW07PaymentMethodReadStore,
  resolveW07DatabaseDriver,
} from './payment-method-read-runtime.js'

describe('W07 payment-method Neon read runtime', () => {
  it('keeps D1 as the default and does not create a PostgreSQL pool', () => {
    const poolFactory = vi.fn()
    expect(resolveW07DatabaseDriver({})).toBe('d1')
    expect(getW07PaymentMethodReadStore({}, poolFactory)).toBeUndefined()
    expect(poolFactory).not.toHaveBeenCalled()
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

  it('reuses one Pool and wires the existing PostgreSQL read store for the exact owner-scoped query', async () => {
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
    expect(first).toBeDefined()
    expect(first).toBe(second)
    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(pool.on).toHaveBeenCalledTimes(1)

    await first!.listSavedPaymentMethodRecords('customer_01', 'merchant_01')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['hyperswitch', 'merchant_01', 'customer_01'])
    expect(calls[0]?.sql).toContain('s.customer_id = $3')
    expect(calls[0]?.sql).toContain('LIMIT 100')
  })
})

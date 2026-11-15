import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolConfig } from 'pg'
import { getW05NotificationPushDeliveryDependencies } from './neon/runtime.js'
import { runNotificationPushBatch, type NotificationPushDeliveryEnv } from './notification-push-delivery-runtime.js'

describe('W05 notification push Neon runtime', () => {
  it('uses PostgreSQL for W05 outbox, delivery claim and receipt state while preserving W09 D1-03 authority', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = []
    const pool = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values })
        return { rows: [] }
      }),
      on: vi.fn(),
    } as unknown as Pool
    const poolFactory = vi.fn((_config: PoolConfig) => pool)
    const binding = { connectionString: 'postgresql://user:secret@hyperdrive.example/db?sslmode=require' }
    const dependencies = getW05NotificationPushDeliveryDependencies({
      W05_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    }, poolFactory)
    const d1Prepare = vi.fn(() => { throw new Error('W05 D1-02 fallback must not run in Neon mode') })
    const d1_03Prepare = vi.fn(() => { throw new Error('W09 D1-03 endpoint adapter should remain dormant for an empty batch') })
    const env = {
      PUSH_DELIVERY_ENABLED: 'true',
      DB: { prepare: d1Prepare },
      D1_03: { prepare: d1_03Prepare },
      W05_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_02: binding,
    } as unknown as NotificationPushDeliveryEnv

    await expect(runNotificationPushBatch(
      env,
      new Date('2026-11-15T00:00:00.000Z'),
      dependencies,
    )).resolves.toMatchObject({ status: 'COMPLETED', fannedOut: 0, sent: 0, providerAccepted: 0 })

    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(calls.length).toBeGreaterThanOrEqual(3)
    expect(calls.some(call => call.sql.includes('social_notification_push_outbox'))).toBe(true)
    expect(calls.some(call => call.sql.includes('social_notification_push_deliveries'))).toBe(true)
    expect(d1Prepare).not.toHaveBeenCalled()
    expect(d1_03Prepare).not.toHaveBeenCalled()
    expect(dependencies).not.toHaveProperty('endpointAccessStore')
  })
})

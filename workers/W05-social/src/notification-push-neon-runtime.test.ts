import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolConfig } from 'pg'
import { getW05NotificationPushDeliveryDependencies } from './neon/runtime.js'
import { runNotificationPushBatch, type NotificationPushDeliveryEnv } from './notification-push-delivery-runtime.js'

describe('W05 notification push Neon runtime', () => {
  it('uses PostgreSQL for W05 outbox, delivery claim and receipt state while preserving W09 D1-03 authority', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = []
    const socialPool = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values })
        return { rows: [] }
      }),
      on: vi.fn(),
    } as unknown as Pool
    const endpointPool = {
      query: vi.fn(async () => ({ rows: [] })),
      on: vi.fn(),
    } as unknown as Pool
    const socialBinding = { connectionString: 'postgresql://user:secret@hyperdrive.example/db?sslmode=require' }
    const endpointBinding = {
      connectionString: 'postgresql://user:secret@governance.example:5432/luckread_governance?sslmode=require',
    }
    const poolFactory = vi.fn((config: PoolConfig) =>
      config.connectionString === endpointBinding.connectionString ? endpointPool : socialPool,
    )
    const dependencies = getW05NotificationPushDeliveryDependencies({
      W05_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_02: socialBinding,
      HYPERDRIVE_D1_03: endpointBinding,
    }, poolFactory)
    const env = { PUSH_DELIVERY_ENABLED: 'true' } as NotificationPushDeliveryEnv

    await expect(runNotificationPushBatch(
      env,
      new Date('2026-11-15T00:00:00.000Z'),
      dependencies,
    )).resolves.toMatchObject({ status: 'COMPLETED', fannedOut: 0, sent: 0, providerAccepted: 0 })

    expect(poolFactory).toHaveBeenCalledTimes(2)
    expect(calls.length).toBeGreaterThanOrEqual(3)
    expect(calls.some(call => call.sql.includes('social_notification_push_outbox'))).toBe(true)
    expect(calls.some(call => call.sql.includes('social_notification_push_deliveries'))).toBe(true)
    expect(endpointPool.query).not.toHaveBeenCalled()
    expect(dependencies.endpointAccessStore).toBeDefined()
  })
})

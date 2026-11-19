import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

import {
  getW07MembershipPostgresPool,
  resolveW07MembershipDatabaseDriver,
} from './membership-database-runtime.js'

describe('W07 Neon membership pool', () => {
  it('defaults to the existing D1-01 Hyperdrive and rejects the legacy D1 selector', () => {
    const pool = {
      on: vi.fn(),
      query: vi.fn(),
      connect: vi.fn(),
    } as unknown as Pool
    const poolFactory = vi.fn(() => pool)
    const binding = {
      connectionString: 'postgresql://user:password@localhost:5432/luckread',
    }
    const neonEnv = {
      W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_01: binding,
    }

    expect(resolveW07MembershipDatabaseDriver({})).toBe('neon')
    expect(resolveW07MembershipDatabaseDriver(neonEnv)).toBe('neon')
    expect(getW07MembershipPostgresPool(neonEnv, poolFactory)).toBe(pool)
    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(() => resolveW07MembershipDatabaseDriver({
      W07_MEMBERSHIP_DATABASE_DRIVER: 'd1',
    })).toThrow('SERVICE_UNAVAILABLE')
  })

  it('fails closed for unsupported driver, missing Hyperdrive, and wrong database name', () => {
    expect(() => resolveW07MembershipDatabaseDriver({
      W07_MEMBERSHIP_DATABASE_DRIVER: 'postgres',
    })).toThrow('SERVICE_UNAVAILABLE')
    expect(() => getW07MembershipPostgresPool({
      W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
    })).toThrow('SERVICE_UNAVAILABLE')
    expect(() => getW07MembershipPostgresPool({
      W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_01: { connectionString: 'postgresql://user:password@localhost:5432/luckread_finance' },
    })).toThrow('SERVICE_UNAVAILABLE')
  })

  it('reuses the existing D1-01 Hyperdrive pool for direct parameterized PostgreSQL membership reads', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const pool = {
      on: vi.fn(),
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values })
        return {
          rows: [{
            subscription_id: 'sub_01',
            subscriber_id: 'user_01',
            plan_version: 3,
            version: 5,
            created_at: new Date('2026-11-15T12:00:00.000Z'),
          }],
          rowCount: 1,
        }
      }),
      connect: vi.fn(),
    } as unknown as Pool
    const poolFactory = vi.fn(() => pool)
    const binding = {
      connectionString: 'postgresql://user:password@localhost:5432/luckread',
    }
    const env = {
      W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_01: binding,
    }

    const first = getW07MembershipPostgresPool(env, poolFactory)
    const second = getW07MembershipPostgresPool(env, poolFactory)
    expect(first).toBe(second)
    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(pool.on).toHaveBeenCalledOnce()

    const row = await first.query<{ subscription_id: string } & Record<string, unknown>>(
      'SELECT subscription_id FROM membership_subscriptions WHERE subscription_id = $1 AND subscriber_id = $2 LIMIT 1',
      ['sub_01', 'user_01'],
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('subscription_id = $1 AND subscriber_id = $2')
    expect(calls[0]?.values).toEqual(['sub_01', 'user_01'])
    expect(row.rows[0]).toMatchObject({
      subscription_id: 'sub_01',
      subscriber_id: 'user_01',
      plan_version: 3,
      version: 5,
    })
  })
})

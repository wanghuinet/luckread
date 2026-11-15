import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

import {
  getW07SelectedD101Database,
  resolveW07MembershipDatabaseDriver,
} from './membership-database-runtime.js'

describe('W07 D1-01 Neon membership runtime', () => {
  it('keeps D1 as the default and does not allocate a PostgreSQL pool', () => {
    const d1 = {} as D1Database
    const poolFactory = vi.fn()
    const env = { D1_01: d1 }

    expect(resolveW07MembershipDatabaseDriver(env)).toBe('d1')
    expect(getW07SelectedD101Database(env, poolFactory)).toBe(d1)
    expect(poolFactory).not.toHaveBeenCalled()
  })

  it('fails closed for unsupported driver, missing Hyperdrive, and wrong database name', () => {
    const d1 = {} as D1Database
    expect(() => resolveW07MembershipDatabaseDriver({
      D1_01: d1,
      W07_MEMBERSHIP_DATABASE_DRIVER: 'postgres',
    })).toThrow('SERVICE_UNAVAILABLE')
    expect(() => getW07SelectedD101Database({
      D1_01: d1,
      W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
    })).toThrow('SERVICE_UNAVAILABLE')
    expect(() => getW07SelectedD101Database({
      D1_01: d1,
      W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_01: { connectionString: 'postgresql://user:password@localhost:5432/luckread_finance' },
    })).toThrow('SERVICE_UNAVAILABLE')
  })

  it('reuses the existing D1-01 Hyperdrive pool and routes membership reads through PostgreSQL', async () => {
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
      D1_01: {} as D1Database,
      W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_01: binding,
    }

    const first = getW07SelectedD101Database(env, poolFactory)
    const second = getW07SelectedD101Database(env, poolFactory)
    expect(first).toBe(second)
    expect(first).not.toBe(env.D1_01)
    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(pool.on).toHaveBeenCalledOnce()

    const row = await first.prepare(
      'SELECT subscription_id FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind('sub_01', 'user_01').first<{
      subscription_id: string
      subscriber_id: string
      plan_version: number
      version: number
      created_at: string
    }>()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('subscription_id = $1 AND subscriber_id = $2')
    expect(calls[0]?.values).toEqual(['sub_01', 'user_01'])
    expect(row).toMatchObject({
      subscription_id: 'sub_01',
      subscriber_id: 'user_01',
      plan_version: 3,
      version: 5,
      created_at: '2026-11-15T12:00:00.000Z',
    })
  })
})

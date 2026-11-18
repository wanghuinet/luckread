import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { hasActiveCreatorMembership, SubscriptionRuntimeError } from './subscription-runtime.js'

const subscriberId = 'user_01'
const creatorId = 'creator_01'
const now = new Date('2026-11-18T12:00:00.000Z')

function poolWith(rows: Array<{ subscription_id: string }>) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    return { rows, rowCount: rows.length }
  })
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    query,
    calls,
  }
}

describe('native PostgreSQL W03 creator membership decision', () => {
  it('allows only an active or trialing subscription within its paid/trial period and before cancellation', async () => {
    const f = poolWith([{ subscription_id: 'sub_active_01' }])

    await expect(hasActiveCreatorMembership(f.pool, subscriberId, creatorId, now)).resolves.toBe(true)

    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.sql).toContain("status IN ('ACTIVE','TRIALING')")
    expect(f.calls[0]?.sql).toContain('current_period_start <= $3::timestamptz')
    expect(f.calls[0]?.sql).toContain('current_period_end > $4::timestamptz')
    expect(f.calls[0]?.sql).toContain('(cancel_at IS NULL OR cancel_at > $5::timestamptz)')
    expect(f.calls[0]?.sql).toContain('ORDER BY current_period_end DESC, subscription_id ASC LIMIT 1')
    expect(f.calls[0]?.values).toEqual([
      subscriberId, creatorId, now.toISOString(), now.toISOString(), now.toISOString(),
    ])
  })

  it('returns false when the subscriber has no currently entitled creator subscription', async () => {
    const f = poolWith([])

    await expect(hasActiveCreatorMembership(f.pool, subscriberId, creatorId, now)).resolves.toBe(false)
    expect(f.calls[0]?.values).toHaveLength(5)
  })

  it('sanitizes PostgreSQL failures to a retryable service-unavailable error', async () => {
    const pool = {
      query: vi.fn(async () => { throw new Error('private connection string and SQL detail') }),
      connect: vi.fn(),
    } as unknown as W07WebhookPostgresPool

    await expect(hasActiveCreatorMembership(pool, subscriberId, creatorId, now))
      .rejects.toBeInstanceOf(SubscriptionRuntimeError)
    await expect(hasActiveCreatorMembership(pool, subscriberId, creatorId, now))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('rejects an invalid clock before querying the membership store', async () => {
    const f = poolWith([{ subscription_id: 'sub_active_01' }])

    await expect(hasActiveCreatorMembership(
      f.pool, subscriberId, creatorId, new Date(Number.NaN),
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(f.query).not.toHaveBeenCalled()
  })
})

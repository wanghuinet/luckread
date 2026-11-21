import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  getSubscription,
  listSubscriptions,
  type SubscriptionRow,
} from './subscription-runtime.js'

function subscriptionRow(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    subscription_id: 'sub_existing',
    subscriber_id: 'user_1',
    plan_id: 'plan_basic',
    plan_version: 1,
    creator_id: 'creator_1',
    status: 'ACTIVE',
    started_at: '2026-10-02T12:00:00.000Z',
    current_period_start: '2026-10-02T12:00:00.000Z',
    current_period_end: '2026-11-02T12:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    trial_converted_at: null,
    cancel_at: null,
    entitlement_snapshot_ref: null,
    created_at: '2026-10-02T12:00:00.000Z',
    updated_at: '2026-10-02T12:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

function nativePool(
  handler: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>,
) {
  const query = vi.fn((sql: string, values: unknown[] = []) => handler(sql, values))
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    query,
  }
}

describe('native PostgreSQL subscription reads', () => {
  it('reads one subscriber-owned subscription with canonical timestamps', async () => {
    const row = subscriptionRow({ entitlement_snapshot_ref: 'private-reference' })
    const pg = nativePool(async () => ({
      rows: [row as unknown as Record<string, unknown>],
      rowCount: 1,
    }))

    const result = await getSubscription(pg.pool, 'user_1', 'sub_existing')

    expect(result).toMatchObject({
      subscriptionId: 'sub_existing',
      subscriberId: 'user_1',
      status: 'ACTIVE',
      version: 1,
      etag: '"lr-v1"',
    })
    expect(result).not.toHaveProperty('entitlementSnapshotRef')
    expect(pg.query.mock.calls[0]?.[0]).toContain('subscription_id = $1 AND subscriber_id = $2 LIMIT 1')
    expect(pg.query.mock.calls[0]?.[0]).toContain("to_char(started_at AT TIME ZONE 'UTC'")
    expect(pg.query.mock.calls[0]?.[1]).toEqual(['sub_existing', 'user_1'])
  })

  it('lists only the authenticated subscriber rows with bounded pagination', async () => {
    const newest = subscriptionRow({
      subscription_id: 'sub_new',
      created_at: '2026-10-02T13:00:00.000Z',
      updated_at: '2026-10-02T13:00:00.000Z',
    })
    const older = subscriptionRow({
      subscription_id: 'sub_old',
      created_at: '2026-10-01T12:00:00.000Z',
      updated_at: '2026-10-01T12:00:00.000Z',
    })
    const pg = nativePool(async () => ({
      rows: [newest, older] as unknown as Record<string, unknown>[],
      rowCount: 2,
    }))

    const result = await listSubscriptions(pg.pool, 'user_1', 1, 1)

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]?.subscriptionId).toBe('sub_new')
    expect(result).toMatchObject({ limit: 1, page: 1, hasNextPage: true })
    expect(pg.query.mock.calls[0]?.[0]).toContain(
      'WHERE subscriber_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    )
    expect(pg.query.mock.calls[0]?.[1]).toEqual(['user_1', 2, 0])
  })

  it('returns a scoped 404 for a subscription owned by another subscriber', async () => {
    const pg = nativePool(async () => ({ rows: [], rowCount: 0 }))

    await expect(getSubscription(pg.pool, 'user_other', 'sub_existing'))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    expect(pg.query).toHaveBeenCalledTimes(1)
  })

  it('maps native PostgreSQL read failures to a sanitized 503', async () => {
    const pg = nativePool(async () => { throw new Error('private connection string') })

    await expect(getSubscription(pg.pool, 'user_1', 'sub_existing'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(listSubscriptions(pg.pool, 'user_1', 20, 1))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from './subscription-runtime.js'
import {
  listActiveMembershipPlans,
  listCreatorMembershipPlans,
} from './subscription-runtime.js'

const creatorId = 'creator_01'
const planId = 'plan_' + 'a'.repeat(64)
const createdAt = '2026-10-26T12:00:00.000Z'
const updatedAt = '2026-10-27T12:00:00.000Z'
const cursorValue = btoa(JSON.stringify({
  createdAt: '2026-10-25T12:00:00.000Z',
  planId: 'plan_' + 'b'.repeat(64),
})).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

function activePlanRow() {
  return {
    plan_id: planId,
    owner_id: creatorId,
    current_version: 3,
    created_at: createdAt,
    updated_at: updatedAt,
    name: 'Supporter',
    tier: 'supporter',
    billing_interval: 'MONTHLY',
    price_minor: 900,
    currency: 'USD',
    benefits_json: JSON.stringify(['member-posts', 'supporter-badge']),
    trial_period_days: 7,
  }
}

function creatorPlanRow() {
  return {
    ...activePlanRow(),
    status: 'DRAFT',
    visibility: 'PRIVATE',
    version: 4,
  }
}

function nativePool(
  handler: (sql: string, values: unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>
    rowCount: number | null
  }>,
) {
  const query = vi.fn((sql: string, values: unknown[] = []) => handler(sql, values))
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    query,
  }
}

describe('native PostgreSQL membership plan catalogs', () => {
  it('lists public active creator offers with immutable versions and stable keyset cursor', async () => {
    const pool = nativePool(async () => ({
      rows: [activePlanRow()],
      rowCount: 1,
    }))

    const result = await listActiveMembershipPlans(pool.pool, 10, cursorValue, creatorId)

    expect(result).toMatchObject({
      limit: 10,
      hasMore: false,
      nextCursor: null,
      docs: [{
        planId,
        creatorId,
        planVersion: 3,
        name: 'Supporter',
        trialPeriodDays: 7,
        benefits: ['member-posts', 'supporter-badge'],
        createdAt,
        updatedAt,
      }],
    })
    expect(pool.query).toHaveBeenCalledTimes(1)
    const [sql, values] = pool.query.mock.calls[0]!
    expect(sql).toContain("p.owner_type = 'CREATOR' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC'")
    expect(sql).toContain('v.plan_version = p.current_version')
    expect(sql).toContain('AND p.owner_id = $1')
    expect(sql).toContain('p.created_at < $2::timestamptz')
    expect(sql).toContain('p.created_at = $3::timestamptz AND p.plan_id < $4')
    expect(sql).toContain('ORDER BY p.created_at DESC, p.plan_id DESC LIMIT $5')
    expect(sql).toContain("to_char(p.created_at AT TIME ZONE 'UTC'")
    expect(values).toEqual([
      creatorId,
      '2026-10-25T12:00:00.000Z',
      '2026-10-25T12:00:00.000Z',
      'plan_' + 'b'.repeat(64),
      11,
    ])
  })

  it('lists a creator’s private drafts using an owner-scoped cursor query', async () => {
    const pool = nativePool(async () => ({
      rows: [creatorPlanRow()],
      rowCount: 1,
    }))

    const result = await listCreatorMembershipPlans(pool.pool, creatorId, 5, cursorValue)

    expect(result).toMatchObject({
      limit: 5,
      hasMore: false,
      nextCursor: null,
      docs: [{
        planId,
        creatorId,
        status: 'DRAFT',
        visibility: 'PRIVATE',
        planVersion: 3,
        version: 4,
        etag: '"lr-plan-v4"',
        createdAt,
        updatedAt,
      }],
    })
    const [sql, values] = pool.query.mock.calls[0]!
    expect(sql).toContain("p.owner_type = 'CREATOR' AND p.owner_id = $1")
    expect(sql).toContain('v.plan_version = p.current_version')
    expect(sql).toContain('p.created_at < $2::timestamptz')
    expect(sql).toContain('ORDER BY p.created_at DESC, p.plan_id DESC LIMIT $5')
    expect(values).toEqual([
      creatorId,
      '2026-10-25T12:00:00.000Z',
      '2026-10-25T12:00:00.000Z',
      'plan_' + 'b'.repeat(64),
      6,
    ])
  })

  it('caps pagination and includes one extra public candidate to produce hasMore', async () => {
    const candidates = Array.from({ length: 51 }, (_, index) => ({
      ...activePlanRow(),
      plan_id: 'plan_' + index.toString(16).padStart(64, '0'),
    }))
    const pool = nativePool(async () => ({
      rows: candidates as unknown as Record<string, unknown>[],
      rowCount: candidates.length,
    }))

    const result = await listActiveMembershipPlans(pool.pool, 1000)

    expect(result.limit).toBe(50)
    expect(result.docs).toHaveLength(50)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeTruthy()
    expect(pool.query.mock.calls[0]?.[1]).toEqual([51])
  })

  it('maps both catalog PostgreSQL query failures to a sanitized service error', async () => {
    const pool = nativePool(async () => {
      throw new Error('private Neon connection string')
    })

    await expect(listActiveMembershipPlans(pool.pool)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    })
    await expect(listCreatorMembershipPlans(pool.pool, creatorId)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    })
    expect(pool.query).toHaveBeenCalledTimes(2)
    expect(pool.query.mock.calls[0]?.[0]).not.toContain('private Neon connection string')
  })
})

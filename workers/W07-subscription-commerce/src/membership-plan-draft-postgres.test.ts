import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError, createMembershipPlanDraft } from './subscription-runtime.js'

const actorId = 'user_01'
const creatorId = 'creator_01'
const idempotencyKey = 'draft-create-postgres-01'
const createdAt = '2026-11-18T12:00:00.000Z'

const input = {
  name: 'Supporter',
  tier: 'supporter',
  billingInterval: 'MONTHLY' as const,
  priceMinor: 900,
  currency: 'USD',
  benefits: ['member-posts', 'supporter-badge'],
  trialPeriodDays: 7,
}

function storedDraft(planId: string, overrides: Record<string, unknown> = {}) {
  return {
    plan_id: planId,
    owner_id: creatorId,
    current_version: 3,
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    version: 5,
    created_at: createdAt,
    updated_at: '2026-11-18T13:00:00.000Z',
    name: input.name,
    tier: input.tier,
    billing_interval: input.billingInterval,
    price_minor: input.priceMinor,
    currency: input.currency,
    benefits_json: JSON.stringify(input.benefits),
    trial_period_days: input.trialPeriodDays,
    ...overrides,
  }
}

function nativePool(
  selectHandler: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>,
  transactionHandler: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>,
) {
  const selectQuery = vi.fn((sql: string, values: unknown[] = []) => selectHandler(sql, values))
  const transactionCalls: Array<{ sql: string; values: unknown[] }> = []
  const transactionQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
    transactionCalls.push({ sql, values })
    return transactionHandler(sql, values)
  })
  const release = vi.fn()
  const client = { query: transactionQuery, release } as unknown as W07WebhookPostgresClient
  const connect = vi.fn(async () => client)
  return {
    pool: { query: selectQuery, connect } as unknown as W07WebhookPostgresPool,
    selectQuery,
    transactionQuery,
    transactionCalls,
    connect,
    release,
  }
}

function emptySelect() {
  return { rows: [], rowCount: 0 }
}

function successfulTransaction(sql: string, values: unknown[]) {
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
  if (sql.includes('INSERT INTO membership_plans')) {
    return { rows: [{ plan_id: values[0] }], rowCount: 1 }
  }
  if (sql.includes('INSERT INTO membership_plan_versions')) {
    return { rows: [{ plan_id: values[0] }], rowCount: 1 }
  }
  throw new Error('unexpected PostgreSQL transaction statement')
}

describe('native PostgreSQL membership plan draft creation', () => {
  it('commits the plan row and immutable v1 snapshot in one transaction', async () => {
    const pg = nativePool(async () => emptySelect(), async (sql, values) => successfulTransaction(sql, values))

    const result = await createMembershipPlanDraft(pg.pool, actorId, creatorId, input, idempotencyKey)

    expect(result).toMatchObject({
      creatorId,
      planVersion: 1,
      name: 'Supporter',
      status: 'DRAFT',
      visibility: 'PRIVATE',
      version: 1,
      benefits: input.benefits,
      trialPeriodDays: 7,
      etag: '"lr-plan-v1"',
      replayed: false,
    })
    expect(result.planId).toMatch(/^plan_[a-f0-9]{64}$/)
    expect(pg.selectQuery).toHaveBeenCalledTimes(1)
    expect(pg.selectQuery.mock.calls[0]?.[0]).toContain('v.plan_version = 1 WHERE p.plan_id = $1')
    expect(pg.selectQuery.mock.calls[0]?.[1]).toEqual([result.planId])
    expect(pg.connect).toHaveBeenCalledTimes(1)
    expect(pg.transactionCalls.map(x => x.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO membership_plans'),
      expect.stringContaining('INSERT INTO membership_plan_versions'),
      'COMMIT',
    ])
    expect(pg.transactionCalls[1]?.sql).toContain("VALUES ($1, 'CREATOR', $2, 1, 'DRAFT', 'PRIVATE', 1")
    expect(pg.transactionCalls[2]?.sql).toContain('VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)')
    expect(pg.transactionCalls[1]?.values).toEqual([
      result.planId, creatorId, result.createdAt, result.createdAt,
    ])
    expect(pg.transactionCalls[2]?.values).toEqual([
      result.planId, input.name, input.tier, input.billingInterval, input.priceMinor,
      input.currency, JSON.stringify(input.benefits), input.trialPeriodDays, result.createdAt,
    ])
    expect(pg.release).toHaveBeenCalledTimes(1)
  })

  it('replays the immutable original v1 create result without opening a transaction', async () => {
    let existingId = ''
    const pg = nativePool(async (_sql, values) => {
      existingId = String(values[0])
      return { rows: [storedDraft(existingId) ], rowCount: 1 }
    }, async () => { throw new Error('transaction must not run on replay') })

    const result = await createMembershipPlanDraft(pg.pool, actorId, creatorId, input, idempotencyKey)

    expect(result).toMatchObject({
      planId: existingId,
      creatorId,
      planVersion: 1,
      status: 'DRAFT',
      visibility: 'PRIVATE',
      version: 1,
      createdAt,
      updatedAt: createdAt,
      etag: '"lr-plan-v1"',
      replayed: true,
    })
    expect(pg.connect).not.toHaveBeenCalled()
  })

  it('rejects reuse of a deterministic plan id with changed draft content', async () => {
    const pg = nativePool(async (_sql, values) => ({
      rows: [storedDraft(String(values[0]), { price_minor: 500 })],
      rowCount: 1,
    }), async () => { throw new Error('transaction must not run for conflicting replay') })

    await expect(createMembershipPlanDraft(
      pg.pool, actorId, creatorId, input, idempotencyKey,
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(pg.connect).not.toHaveBeenCalled()
  })

  it('rolls back both inserts when the immutable v1 insert loses its uniqueness race', async () => {
    const pg = nativePool(async () => emptySelect(), async (sql, values) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
      if (sql.includes('INSERT INTO membership_plans')) return { rows: [{ plan_id: values[0] }], rowCount: 1 }
      if (sql.includes('INSERT INTO membership_plan_versions')) return { rows: [], rowCount: 0 }
      throw new Error('unexpected transaction statement')
    })

    await expect(createMembershipPlanDraft(
      pg.pool, actorId, creatorId, input, idempotencyKey,
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(pg.transactionCalls.map(x => x.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO membership_plans'),
      expect.stringContaining('INSERT INTO membership_plan_versions'),
      'ROLLBACK',
    ])
    expect(pg.transactionCalls.some(x => x.sql === 'COMMIT')).toBe(false)
    expect(pg.selectQuery).toHaveBeenCalledTimes(2)
    expect(pg.release).toHaveBeenCalledTimes(1)
  })

  it('maps PostgreSQL read failures to a sanitized service error', async () => {
    const pg = nativePool(async () => {
      throw new Error('private Neon connection string and credentials')
    }, async () => emptySelect())

    await expect(createMembershipPlanDraft(
      pg.pool, actorId, creatorId, input, idempotencyKey,
    )).rejects.toBeInstanceOf(SubscriptionRuntimeError)
    await expect(createMembershipPlanDraft(
      pg.pool, actorId, creatorId, input, idempotencyKey,
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(pg.connect).not.toHaveBeenCalled()
  })
})

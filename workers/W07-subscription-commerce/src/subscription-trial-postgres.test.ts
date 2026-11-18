import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from './subscription-runtime.js'
import { startSubscriptionTrialPostgres } from './subscription-trial-postgres.js'
import { trialSubscriptionId, type TrialSubscriptionRow } from './subscription-trial-runtime.js'

const subscriberId = 'user_01'
const creatorId = 'creator_01'
const planId = 'plan_' + 'a'.repeat(64)
const idempotencyKey = 'trial-request-001'
const now = new Date('2026-11-18T12:00:00.000Z')
const nowIso = now.toISOString()
const trialEndsAt = '2026-11-25T12:00:00.000Z'

function planRow() {
  return {
    plan_id: planId,
    owner_id: creatorId,
    current_version: 1,
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    name: 'Creator membership',
    tier: 'supporter',
    billing_interval: 'MONTHLY',
    price_minor: 1000,
    currency: 'USD',
    trial_period_days: 7,
  }
}

function subscriptionRow(
  subscriptionId: string,
  status: 'PENDING' | 'TRIALING',
  version = status === 'TRIALING' ? 2 : 1,
): TrialSubscriptionRow {
  return {
    subscription_id: subscriptionId,
    subscriber_id: subscriberId,
    plan_id: planId,
    plan_version: 1,
    creator_id: creatorId,
    status,
    started_at: nowIso,
    current_period_start: nowIso,
    current_period_end: trialEndsAt,
    trial_started_at: nowIso,
    trial_ends_at: trialEndsAt,
    trial_converted_at: null,
    created_at: nowIso,
    updated_at: nowIso,
    version,
  }
}

function poolWith(
  results: Array<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>,
) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    return results.shift() ?? { rows: [], rowCount: 0 }
  })
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    query,
    calls,
  }
}

function environment(auditStatus = 201) {
  const fetch = vi.fn(async (request: Request) => {
    const payload = await request.json() as Record<string, unknown>
    return new Response(JSON.stringify({
      eventId: payload.eventId,
      action: 'subscription.trial_started',
      targetId: payload.subscriptionId,
    }), { status: auditStatus })
  })
  return {
    env: {
      D1_01: {} as D1Database,
      W06_GOVERNANCE: { fetch } as unknown as Fetcher,
    },
    fetch,
  }
}

describe('native PostgreSQL subscription trial runtime', () => {
  it('creates PENDING, confirms the W06 audit, and activates TRIALING on the existing Neon pool', async () => {
    const subscriptionId = await trialSubscriptionId(subscriberId, idempotencyKey)
    const f = poolWith([
      { rows: [], rowCount: 0 },
      { rows: [planRow()], rowCount: 1 },
      { rows: [{ subscription_id: subscriptionId }], rowCount: 1 },
      { rows: [subscriptionRow(subscriptionId, 'PENDING') as unknown as Record<string, unknown>], rowCount: 1 },
      { rows: [{ subscription_id: subscriptionId }], rowCount: 1 },
      { rows: [subscriptionRow(subscriptionId, 'TRIALING') as unknown as Record<string, unknown>], rowCount: 1 },
    ])
    const { env, fetch } = environment()
    const result = await startSubscriptionTrialPostgres(
      env, f.pool, subscriberId, { planId }, idempotencyKey, { now: () => now },
    )

    expect(result).toMatchObject({
      subscriptionId,
      subscriberId,
      planId,
      status: 'TRIALING',
      trialStartedAt: nowIso,
      trialEndsAt,
      version: 2,
      replayed: false,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(f.calls).toHaveLength(6)
    expect(f.calls[1]?.sql).toContain('FROM membership_plans p INNER JOIN membership_plan_versions')
    expect(f.calls[2]?.sql).toContain("SELECT $1, $2, $3, $4, $5, 'PENDING'")
    expect(f.calls[2]?.values).toEqual([
      subscriptionId, subscriberId, planId, 1, creatorId,
      nowIso, nowIso, trialEndsAt, nowIso, trialEndsAt, nowIso, nowIso,
      planId, 1, creatorId, subscriberId, creatorId, subscriberId, creatorId, nowIso,
    ])
    expect(f.calls[4]?.sql).toContain("SET status = 'TRIALING'")
    expect(f.calls[4]?.sql).toContain("status = 'PENDING' AND version = 1")
    expect(f.calls.every(({ sql }) => !/\b(orders|payments|order_lines)\b/i.test(sql))).toBe(true)
  })

  it('resumes an existing PENDING trial idempotently after repeating the durable W06 audit', async () => {
    const subscriptionId = await trialSubscriptionId(subscriberId, idempotencyKey)
    const f = poolWith([
      { rows: [subscriptionRow(subscriptionId, 'PENDING') as unknown as Record<string, unknown>], rowCount: 1 },
      { rows: [{ trial_period_days: 7 }], rowCount: 1 },
      { rows: [{ subscription_id: subscriptionId }], rowCount: 1 },
      { rows: [subscriptionRow(subscriptionId, 'TRIALING') as unknown as Record<string, unknown>], rowCount: 1 },
    ])
    const { env, fetch } = environment()
    const result = await startSubscriptionTrialPostgres(
      env, f.pool, subscriberId, { planId }, idempotencyKey, { now: () => now },
    )

    expect(result).toMatchObject({ subscriptionId, status: 'TRIALING', replayed: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(f.calls[2]?.sql).toContain("status = 'PENDING'")
  })

  it('does not activate or continue when W06 audit confirmation fails', async () => {
    const subscriptionId = await trialSubscriptionId(subscriberId, idempotencyKey)
    const f = poolWith([
      { rows: [subscriptionRow(subscriptionId, 'PENDING') as unknown as Record<string, unknown>], rowCount: 1 },
      { rows: [{ trial_period_days: 7 }], rowCount: 1 },
    ])
    const { env, fetch } = environment(503)

    await expect(startSubscriptionTrialPostgres(
      env, f.pool, subscriberId, { planId }, idempotencyKey, { now: () => now },
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(f.query).toHaveBeenCalledTimes(2)
  })

  it('rejects a plan that is no longer an active public creator trial offer', async () => {
    const f = poolWith([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ])
    const { env } = environment()

    await expect(startSubscriptionTrialPostgres(
      env, f.pool, subscriberId, { planId }, idempotencyKey, { now: () => now },
    )).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
    expect(f.query).toHaveBeenCalledTimes(2)
  })

  it('maps unique trial conflicts to HTTP 409 without leaking PostgreSQL details', async () => {
    const brokenPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [planRow()], rowCount: 1 })
        .mockRejectedValueOnce(Object.assign(new Error('constraint details'), { code: '23505' })),
      connect: vi.fn(),
    } as unknown as W07WebhookPostgresPool
    const { env } = environment()

    await expect(startSubscriptionTrialPostgres(
      env, brokenPool, subscriberId, { planId }, idempotencyKey, { now: () => now },
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect((brokenPool.query as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3)
  })
})

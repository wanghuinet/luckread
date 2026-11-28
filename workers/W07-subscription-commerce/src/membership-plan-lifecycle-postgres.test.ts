import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  publishMembershipPlan,
  reviseMembershipPlan,
  transitionMembershipPlanLifecycle,
} from './subscription-runtime.js'

const planId = 'plan_' + 'a'.repeat(64)
const creatorId = 'creator_01'
type PlanRow = Record<string, unknown>

function planRow(overrides: PlanRow = {}): PlanRow {
  return {
    plan_id: planId,
    owner_id: creatorId,
    current_version: 1,
    status: 'DRAFT',
    visibility: 'PRIVATE',
    version: 1,
    created_at: '2026-11-01T12:00:00.000Z',
    updated_at: '2026-11-01T12:00:00.000Z',
    name: 'Supporter',
    tier: 'supporter',
    billing_interval: 'MONTHLY',
    price_minor: 500,
    currency: 'USD',
    benefits_json: JSON.stringify(['member-posts']),
    trial_period_days: 7,
    ...overrides,
  }
}

function pgPool(
  handler: (sql: string, values: unknown[]) => Promise<{ rows: PlanRow[]; rowCount: number | null }>,
  connect?: () => Promise<W07WebhookPostgresClient>,
) {
  const query = vi.fn((sql: string, values: unknown[] = []) => handler(sql, values))
  return {
    pool: { query, connect: vi.fn(connect) } as unknown as W07WebhookPostgresPool,
    query,
  }
}

describe('native PostgreSQL membership plan lifecycle writes', () => {
  it('publishes an owner-scoped draft with the same version CAS and public state', async () => {
    let current = planRow()
    const pg = pgPool(async (sql, values) => {
      if (sql.startsWith('SELECT p.plan_id')) return { rows: [current], rowCount: 1 }
      if (sql.startsWith("UPDATE membership_plans SET status = 'ACTIVE'")) {
        expect(values).toEqual([expect.any(String), planId, creatorId, 1])
        current = {
          ...current,
          status: 'ACTIVE',
          visibility: 'PUBLIC',
          updated_at: values[0] as string,
          version: 2,
        }
        return { rows: [{ plan_id: planId }], rowCount: 1 }
      }
      throw new Error('unexpected PostgreSQL publish SQL')
    })

    const result = await publishMembershipPlan(pg.pool, creatorId, planId, '"lr-plan-v1"')

    expect(result).toMatchObject({
      planId,
      creatorId,
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      planVersion: 1,
      version: 2,
      etag: '"lr-plan-v2"',
      replayed: false,
    })
    const update = pg.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE membership_plans SET status = 'ACTIVE'"))
    expect(update?.[0]).toContain("owner_type = 'CREATOR' AND owner_id = $3")
    expect(update?.[0]).toContain("status = 'DRAFT' AND visibility = 'PRIVATE' AND version = $4")
    expect(update?.[0]).toContain('RETURNING plan_id')
  })

  it('revises a plan by committing the immutable next version and current pointer CAS together', async () => {
    let current = planRow({ status: 'ACTIVE', visibility: 'PUBLIC', version: 2 })
    const transactionCalls: Array<{ sql: string; values: unknown[] }> = []
    const clientQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
      transactionCalls.push({ sql, values })
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: null }
      }
      if (sql.startsWith('INSERT INTO membership_plan_versions')) {
        return { rows: [{ plan_id: planId }], rowCount: 1 }
      }
      if (sql.startsWith('UPDATE membership_plans SET current_version')) {
        expect(values).toEqual([
          2, expect.any(String), planId, creatorId, 1, 2, 2,
          'Creator Plus', 'plus', 'YEARLY', 7500, 'FIXED', null, null, null, 'STANDARD', null, 'USD',
          JSON.stringify(['member-posts', 'monthly-live']), 7,
        ])
        current = {
          ...current,
          current_version: 2,
          name: 'Creator Plus',
          tier: 'plus',
          billing_interval: 'YEARLY',
          price_minor: 7500,
          benefits_json: JSON.stringify(['member-posts', 'monthly-live']),
          updated_at: values[1] as string,
          version: 3,
        }
        return { rows: [{ plan_id: planId }], rowCount: 1 }
      }
      throw new Error('unexpected PostgreSQL revision SQL')
    })
    const release = vi.fn()
    const client = { query: clientQuery, release } as unknown as W07WebhookPostgresClient
    const pg = pgPool(async () => ({ rows: [current], rowCount: 1 }), async () => client)

    const result = await reviseMembershipPlan(pg.pool, creatorId, planId, '"lr-plan-v2"', {
      name: 'Creator Plus',
      tier: 'plus',
      billingInterval: 'YEARLY',
      priceMinor: 7500,
      currency: 'USD',
      benefits: ['member-posts', 'monthly-live'],
    })

    expect(result).toMatchObject({
      planId,
      creatorId,
      planVersion: 2,
      name: 'Creator Plus',
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      version: 3,
      etag: '"lr-plan-v3"',
      replayed: false,
    })
    expect(transactionCalls.map(x => x.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO membership_plan_versions'),
      expect.stringContaining('UPDATE membership_plans SET current_version'),
      'COMMIT',
    ])
    expect(transactionCalls[1]?.sql).toContain('ON CONFLICT (plan_id, plan_version) DO NOTHING')
    expect(transactionCalls[1]?.sql).toContain("p.status IN ('DRAFT','ACTIVE','PAUSED')")
    expect(transactionCalls[2]?.sql).toContain('current_version = $5 AND version = $6')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('does not allow a founding offer capacity to be reset by a later plan version', async () => {
    const current = planRow({
      offer_kind: 'FOUNDING',
      founding_capacity: 100,
      price_mode: 'FIXED',
      price_minor: 9900,
    })
    const connect = vi.fn()
    const pg = pgPool(async () => ({ rows: [current], rowCount: 1 }), connect as never)
    await expect(reviseMembershipPlan(pg.pool, creatorId, planId, '"lr-plan-v1"', {
      name: 'Founding Member',
      tier: 'founding',
      billingInterval: 'MONTHLY',
      priceMode: 'FIXED',
      priceMinor: 9900,
      offerKind: 'FOUNDING',
      foundingCapacity: 101,
      currency: 'USD',
      benefits: ['founding-badge'],
    })).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
    expect(connect).not.toHaveBeenCalled()
  })

  it('rolls back a new immutable version when the main plan version CAS loses', async () => {
    let current = planRow({ status: 'ACTIVE', visibility: 'PUBLIC', version: 2, current_version: 2 })
    const transactionSql: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        transactionSql.push(sql)
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
        if (sql.startsWith('INSERT INTO membership_plan_versions')) return { rows: [{ plan_id: planId }], rowCount: 1 }
        if (sql.startsWith('UPDATE membership_plans SET current_version')) {
          current = { ...current, status: 'PAUSED', visibility: 'PRIVATE', version: 3 }
          return { rows: [], rowCount: 0 }
        }
        throw new Error('unexpected PostgreSQL revision SQL')
      }),
      release: vi.fn(),
    } as unknown as W07WebhookPostgresClient
    const pg = pgPool(async () => ({ rows: [current], rowCount: 1 }), async () => client)

    await expect(reviseMembershipPlan(pg.pool, creatorId, planId, '"lr-plan-v2"', {
      name: 'Different terms',
      tier: 'plus',
      billingInterval: 'MONTHLY',
      priceMinor: 800,
      currency: 'USD',
      benefits: ['member-posts'],
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })

    expect(transactionSql).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO membership_plan_versions'),
      expect.stringContaining('UPDATE membership_plans SET current_version'),
      'ROLLBACK',
    ])
    expect(transactionSql).not.toContain('COMMIT')
  })

  it('pauses, resumes and retires a plan with owner/version/source-state CAS and exact retries', async () => {
    let current = planRow({
      current_version: 3,
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      version: 4,
    })
    const updates: Array<{ sql: string; values: unknown[] }> = []
    const pg = pgPool(async (sql, values) => {
      if (sql.startsWith('SELECT p.plan_id')) return { rows: [current], rowCount: 1 }
      if (sql.startsWith('UPDATE membership_plans SET status')) {
        updates.push({ sql, values })
        const [status, visibility, updatedAt, id, owner, version, fromStatus, fromVisibility] = values
        if (id !== planId || owner !== creatorId || version !== current.version ||
            fromStatus !== current.status || fromVisibility !== current.visibility) {
          return { rows: [], rowCount: 0 }
        }
        current = {
          ...current,
          status,
          visibility,
          updated_at: updatedAt,
          version: Number(current.version) + 1,
        }
        return { rows: [{ plan_id: planId }], rowCount: 1 }
      }
      throw new Error('unexpected PostgreSQL lifecycle SQL')
    })

    const paused = await transitionMembershipPlanLifecycle(pg.pool, creatorId, planId, '"lr-plan-v4"', 'pause')
    const resumed = await transitionMembershipPlanLifecycle(pg.pool, creatorId, planId, '"lr-plan-v5"', 'resume')
    const pausedAgain = await transitionMembershipPlanLifecycle(pg.pool, creatorId, planId, '"lr-plan-v6"', 'pause')
    const retired = await transitionMembershipPlanLifecycle(pg.pool, creatorId, planId, '"lr-plan-v7"', 'retire')
    const retireReplay = await transitionMembershipPlanLifecycle(pg.pool, creatorId, planId, '"lr-plan-v7"', 'retire')

    expect(paused).toMatchObject({ status: 'PAUSED', visibility: 'PRIVATE', planVersion: 3, version: 5, replayed: false })
    expect(resumed).toMatchObject({ status: 'ACTIVE', visibility: 'PUBLIC', planVersion: 3, version: 6, replayed: false })
    expect(pausedAgain).toMatchObject({ status: 'PAUSED', visibility: 'PRIVATE', version: 7 })
    expect(retired).toMatchObject({ status: 'RETIRED', visibility: 'PRIVATE', planVersion: 3, version: 8, replayed: false })
    expect(retireReplay).toMatchObject({ status: 'RETIRED', version: 8, replayed: true })
    expect(updates).toHaveLength(4)
    expect(updates.every(x => x.sql.includes("owner_type = 'CREATOR'") && x.sql.includes('version = $6'))).toBe(true)
    expect(updates[0]?.values).toEqual(['PAUSED', 'PRIVATE', expect.any(String), planId, creatorId, 4, 'ACTIVE', 'PUBLIC'])
    expect(updates[3]?.values).toEqual(['RETIRED', 'PRIVATE', expect.any(String), planId, creatorId, 7, 'PAUSED', 'PRIVATE'])
  })

  it('returns a scoped not-found result for another creator and sanitizes PostgreSQL failures', async () => {
    const pg = pgPool(async () => ({ rows: [], rowCount: 0 }))
    await expect(publishMembershipPlan(pg.pool, 'creator_other', planId, '"lr-plan-v1"'))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })

    const failed = pgPool(async () => { throw new Error('private Neon credentials') })
    await expect(publishMembershipPlan(failed.pool, creatorId, planId, '"lr-plan-v1"'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(transitionMembershipPlanLifecycle(failed.pool, creatorId, planId, '"lr-plan-v1"', 'pause'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

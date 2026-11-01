import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { addBillingPeriod, changeSubscriptionPlan, createMembershipPlanDraft, createSubscription, etagForVersion, getSubscription, listActiveMembershipPlans, listCreatorMembershipPlans, listSubscriptions, normalizeMembershipPlanDraft, parseBoundedPositiveInt, publishMembershipPlan, reviseMembershipPlan, transitionMembershipPlanLifecycle, transitionSubscription, type SubscriptionRow, type SubscriptionStatus } from './subscription-runtime.js'
import w07 from './index.js'
import { verifyD1SubscriptionPostflight, verifyD1SubscriptionPreflight } from '../scripts/verify-remote-preflight.mjs'

type Statement = { bind: (...values: unknown[]) => Statement; first: <T>() => Promise<T | null>; all: <T>() => Promise<{ results: T[] }>; run: () => Promise<{ meta: { changes: number } }> }
type MembershipPlanRow = { plan_id: string; owner_type: 'CREATOR' | 'COMMUNITY' | 'PLATFORM'; owner_id: string; current_version: number; status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED'; visibility: 'PRIVATE' | 'PUBLIC'; version: number; has_current_version: boolean; created_at: string; updated_at: string; name: string; tier: string; billing_interval: string; price_minor: number; currency: string; benefits_json: string; trial_period_days: number }
type PlanVersionRow = { plan_id: string; plan_version: number; name: string; tier: string; billing_interval: string; price_minor: number; currency: string; benefits_json: string; trial_period_days: number; created_at: string }

function fakeDb(rows: SubscriptionRow[], plans: MembershipPlanRow[] = []): D1Database {
  const state = new Map(rows.map((row) => [row.subscription_id, { ...row }]))
  const planState = new Map(plans.map((plan) => [plan.plan_id, { ...plan }]))
  const planVersionState = new Map<string, PlanVersionRow>()
  for (const plan of plans) {
    if (plan.has_current_version) planVersionState.set(plan.plan_id + ':' + plan.current_version, {
      plan_id: plan.plan_id, plan_version: plan.current_version, name: plan.name, tier: plan.tier,
      billing_interval: plan.billing_interval, price_minor: plan.price_minor, currency: plan.currency,
      benefits_json: plan.benefits_json, trial_period_days: plan.trial_period_days, created_at: plan.created_at,
    })
  }
  return {
    prepare(sql: string) {
      let values: unknown[] = []
      const statement: Statement = {
        bind(...args) { values = args; return statement },
        async first<T>() {
          if (sql.includes('WHERE subscription_id = ? AND subscriber_id = ?')) {
            const row = state.get(String(values[0]))
            return (row && row.subscriber_id === String(values[1]) ? { ...row } : null) as T | null
          }
          if (sql.includes('FROM membership_plans AS p')) {
            const plan = planState.get(String(values[0]))
            const ownerScoped = sql.includes('p.owner_id = ?')
            if (ownerScoped && plan?.owner_id !== String(values[1])) return null
            const version = plan ? planVersionState.get(plan.plan_id + ':' + plan.current_version) : undefined
            return (plan && version ? { ...plan, ...version, current_version: plan.current_version } : null) as T | null
          }
          const row = state.get(String(values[0]))
          return row ? { ...row } as T : null
        },
        async all<T>() {
          if (sql.includes('FROM membership_plans AS p')) {
            const hasCursor = sql.includes('p.created_at < ?')
            const creatorFilterQuery = sql.includes("p.status = 'ACTIVE' AND p.visibility = 'PUBLIC'") && sql.includes('p.owner_id = ?')
            const ownerQuery = sql.includes('p.owner_id = ?') && !creatorFilterQuery
            const cursorOffset = ownerQuery || creatorFilterQuery ? 1 : 0
            const limit = Number(values[values.length - 1])
            const cursorCreatedAt = hasCursor ? String(values[cursorOffset]) : null
            const cursorPlanId = hasCursor ? String(values[cursorOffset + 2]) : null
            const results = Array.from(planState.values())
              .filter((plan) => !ownerQuery || (plan.owner_type === 'CREATOR' && plan.owner_id === String(values[0])))
              .filter((plan) => !creatorFilterQuery || (plan.owner_type === 'CREATOR' && plan.owner_id === String(values[0]) && plan.status === 'ACTIVE' && plan.visibility === 'PUBLIC'))
              .filter((plan) => ownerQuery || creatorFilterQuery || (plan.owner_type === 'CREATOR' && plan.status === 'ACTIVE' && plan.visibility === 'PUBLIC'))
              .filter((plan) => plan.has_current_version)
              .filter((plan) => !hasCursor || plan.created_at < cursorCreatedAt! || (plan.created_at === cursorCreatedAt && plan.plan_id < cursorPlanId!))
              .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.plan_id.localeCompare(left.plan_id))
              .slice(0, limit)
              .map((plan) => {
                const version = planVersionState.get(plan.plan_id + ':' + plan.current_version)
                return version ? { ...plan, ...version, current_version: plan.current_version } : null
              })
              .filter((plan) => plan !== null)
            return { results: results as unknown as T[] }
          }
          if (sql.includes('WHERE subscriber_id = ?')) {
            const limit = Number(values[1])
            const offset = Number(values[2])
            const results = Array.from(state.values())
              .filter((row) => row.subscriber_id === String(values[0]))
              .sort((left, right) => right.created_at.localeCompare(left.created_at))
              .slice(offset, offset + limit)
            return { results: results.map((row) => ({ ...row })) as T[] }
          }
          return { results: [] as T[] }
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO membership_plans')) {
            const planId = String(values[0])
            if (planState.has(planId)) return { meta: { changes: 0 } }
            planState.set(planId, {
              plan_id: planId, owner_type: 'CREATOR', owner_id: String(values[1]), current_version: 1,
              status: 'DRAFT', visibility: 'PRIVATE', version: 1, has_current_version: false,
              created_at: String(values[2]), updated_at: String(values[3]),
              name: '', tier: '', billing_interval: 'MONTHLY', price_minor: 0, currency: 'USD', benefits_json: '[]', trial_period_days: 0,
            })
            return { meta: { changes: 1 } }
          }
          if (sql.includes('INSERT OR IGNORE INTO membership_plan_versions') && sql.includes('SELECT')) {
            const [planId, planVersion, name, tier, billingInterval, priceMinor, currency, benefitsJson, trialPeriodDays, createdAt,
              guardPlanId, ownerId, currentVersion, lifecycleVersion] = values as
              [string, number, string, string, string, number, string, string, number, string, string, string, number, number]
            const plan = planState.get(guardPlanId)
            if (!plan || planId !== guardPlanId || plan.owner_type !== 'CREATOR' || plan.owner_id !== ownerId ||
                !['DRAFT', 'ACTIVE', 'PAUSED'].includes(plan.status) || plan.current_version !== currentVersion ||
                plan.version !== lifecycleVersion) return { meta: { changes: 0 } }
            const key = planId + ':' + planVersion
            if (planVersionState.has(key)) return { meta: { changes: 0 } }
            planVersionState.set(key, { plan_id: planId, plan_version: planVersion, name, tier,
              billing_interval: billingInterval, price_minor: priceMinor, currency, benefits_json: benefitsJson,
              trial_period_days: trialPeriodDays, created_at: createdAt })
            return { meta: { changes: 1 } }
          }
          if (sql.includes('INSERT OR IGNORE INTO membership_plan_versions')) {
            const key = String(values[0]) + ':1'
            if (planVersionState.has(key)) return { meta: { changes: 0 } }
            const version: PlanVersionRow = {
              plan_id: String(values[0]), plan_version: 1, name: String(values[1]), tier: String(values[2]),
              billing_interval: String(values[3]), price_minor: Number(values[4]), currency: String(values[5]),
              benefits_json: String(values[6]), trial_period_days: 0, created_at: String(values[7]),
            }
            planVersionState.set(key, version)
            const plan = planState.get(version.plan_id)
            if (plan) {
              plan.name = version.name; plan.tier = version.tier; plan.billing_interval = version.billing_interval
              plan.price_minor = version.price_minor; plan.currency = version.currency; plan.benefits_json = version.benefits_json
              plan.has_current_version = true
            }
            return { meta: { changes: 1 } }
          }
          if (sql.includes('INSERT INTO membership_subscriptions')) {
            const plan = planState.get(String(values[8]))
            if (!plan || plan.owner_type !== 'CREATOR' || plan.status !== 'ACTIVE' || plan.visibility !== 'PUBLIC' || !plan.has_current_version) return { meta: { changes: 0 } }
            const start = String(values[3])
            const row: SubscriptionRow = {
              subscription_id: String(values[0]), subscriber_id: String(values[1]), plan_id: plan.plan_id,
              plan_version: plan.current_version, creator_id: plan.owner_id, status: 'PENDING',
              started_at: String(values[2]), current_period_start: start,
              current_period_end: addBillingPeriod(start, plan.billing_interval as 'MONTHLY' | 'YEARLY'),
              trial_started_at: null, trial_ends_at: null, trial_converted_at: null,
              cancel_at: null, entitlement_snapshot_ref: null, created_at: String(values[6]), updated_at: String(values[7]), version: 1,
            }
            if (state.has(row.subscription_id)) throw new Error('UNIQUE constraint failed')
            state.set(row.subscription_id, row)
            return { meta: { changes: 1 } }
          }
          if (sql.includes('UPDATE membership_plans SET current_version = ?')) {
            const [nextVersion, updatedAt, planId, ownerId, currentVersion, lifecycleVersion,
              versionForCheck, name, tier, billingInterval, priceMinor, currency, benefitsJson, trialPeriodDays] = values as
              [number, string, string, string, number, number, number, string, string, string, number, string, string, number]
            const plan = planState.get(planId)
            const target = planVersionState.get(planId + ':' + versionForCheck)
            if (!plan || plan.owner_type !== 'CREATOR' || plan.owner_id !== ownerId ||
                !['DRAFT', 'ACTIVE', 'PAUSED'].includes(plan.status) || plan.current_version !== currentVersion ||
                plan.version !== lifecycleVersion || nextVersion !== currentVersion + 1 ||
                !target || target.name !== name || target.tier !== tier || target.billing_interval !== billingInterval ||
                target.price_minor !== priceMinor || target.currency !== currency || target.benefits_json !== benefitsJson ||
                target.trial_period_days !== trialPeriodDays) {
              return { meta: { changes: 0 } }
            }
            plan.current_version = nextVersion
            plan.updated_at = updatedAt
            plan.version += 1
            const latest = planVersionState.get(plan.plan_id + ':' + nextVersion)!
            plan.name = latest.name; plan.tier = latest.tier; plan.billing_interval = latest.billing_interval
            plan.price_minor = latest.price_minor; plan.currency = latest.currency; plan.benefits_json = latest.benefits_json
            plan.trial_period_days = latest.trial_period_days
            plan.has_current_version = true
            return { meta: { changes: 1 } }
          }
          if (sql.includes('UPDATE membership_plans SET status = ?') && sql.includes('visibility = ?')) {
            const [status, visibility, updatedAt, planId, ownerId, expectedVersion, fromStatus, fromVisibility] = values as
              [MembershipPlanRow['status'], MembershipPlanRow['visibility'], string, string, string, number, MembershipPlanRow['status'], MembershipPlanRow['visibility']]
            const plan = planState.get(planId)
            if (!plan || plan.owner_type !== 'CREATOR' || plan.owner_id !== ownerId || plan.version !== expectedVersion ||
                plan.status !== fromStatus || plan.visibility !== fromVisibility ||
                !planVersionState.has(plan.plan_id + ':' + plan.current_version)) return { meta: { changes: 0 } }
            plan.status = status; plan.visibility = visibility; plan.updated_at = updatedAt; plan.version += 1
            return { meta: { changes: 1 } }
          }
          if (sql.includes("UPDATE membership_plans SET status = 'ACTIVE'")) {
            const plan = planState.get(String(values[1]))
            if (
              !plan ||
              plan.owner_type !== 'CREATOR' ||
              plan.owner_id !== String(values[2]) ||
              plan.status !== 'DRAFT' ||
              plan.visibility !== 'PRIVATE' ||
              plan.version !== Number(values[3]) ||
              !plan.has_current_version ||
              !planVersionState.has(plan.plan_id + ':' + plan.current_version)
            ) return { meta: { changes: 0 } }
            plan.status = 'ACTIVE'
            plan.visibility = 'PUBLIC'
            plan.updated_at = String(values[0])
            plan.version += 1
            return { meta: { changes: 1 } }
          }
          if (sql.includes('SET status =')) {
            const row = state.get(String(values[3]))
            if (!row || row.subscriber_id !== String(values[4]) || row.version !== Number(values[5])) return { meta: { changes: 0 } }
            row.status = values[0] as SubscriptionStatus; row.cancel_at = values[1] as string | null; row.updated_at = String(values[2]); row.version += 1
            return { meta: { changes: 1 } }
          }
          if (sql.includes('SET plan_id =')) {
            const row = state.get(String(values[4]))
            const plan = planState.get(String(values[7]))
            if (!row || row.subscriber_id !== String(values[5]) || row.version !== Number(values[6])) return { meta: { changes: 0 } }
            if (!plan || plan.owner_type !== 'CREATOR' || plan.status !== 'ACTIVE' || plan.visibility !== 'PUBLIC' || plan.owner_id !== String(values[8])) return { meta: { changes: 0 } }
            row.plan_id = plan.plan_id; row.plan_version = plan.current_version; row.creator_id = plan.owner_id; row.updated_at = String(values[3]); row.version += 1
            return { meta: { changes: 1 } }
          }
          throw new Error('unexpected query')
        },
      }
      return statement as unknown as ReturnType<D1Database["prepare"]>
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const results = []
      for (const item of statements) results.push(await (item as unknown as Statement).run())
      return results as unknown as D1Result<T>[]
    },
  } as unknown as D1Database
}

const activePlan = (planId = 'plan_basic', overrides: Partial<MembershipPlanRow> = {}): MembershipPlanRow => ({
  plan_id: planId, owner_type: 'CREATOR', owner_id: 'creator_1', current_version: 3, status: 'ACTIVE', visibility: 'PUBLIC', version: 1,
  has_current_version: true, created_at: '2026-10-02T12:00:00.000Z', updated_at: '2026-10-02T12:00:00.000Z',
  name: 'Creator Basic', tier: 'basic', billing_interval: 'MONTHLY', price_minor: 500, currency: 'USD', benefits_json: '["member-posts"]', trial_period_days: 0,
  ...overrides,
})

const baseRow = (overrides: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  subscription_id: 'sub_existing', subscriber_id: 'user_1', plan_id: 'plan_basic', plan_version: 1, creator_id: null, status: 'ACTIVE',
  started_at: '2026-10-02T12:00:00.000Z', current_period_start: '2026-10-02T12:00:00.000Z', current_period_end: '2026-11-01T12:00:00.000Z',
  trial_started_at: null, trial_ends_at: null, trial_converted_at: null,
  cancel_at: null, entitlement_snapshot_ref: null, created_at: '2026-10-02T12:00:00.000Z', updated_at: '2026-10-02T12:00:00.000Z', version: 1, ...overrides
})

describe('subscription runtime', () => {
  it('rejects malformed or out-of-range pagination parameters', () => {
    const cases = [
      ['0', 20, 50],
      ['-1', 20, 50],
      ['1abc', 20, 50],
      ['51', 20, 50],
      ['10001', 1, 10000],
    ] as const
    for (const [value, fallback, max] of cases) {
      expect(() => parseBoundedPositiveInt(value, fallback, max)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_FAILED', status: 400 }),
      )
    }
    expect(parseBoundedPositiveInt(null, 20, 50)).toBe(20)
    expect(parseBoundedPositiveInt('50', 20, 50)).toBe(50)
    expect(parseBoundedPositiveInt('10000', 1, 10000)).toBe(10000)
  })
  it('keeps subscription lifecycle POST disabled while admitting guarded creator-plan lifecycle operations', () => {
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const operationResolution = index.indexOf('const operation = toOperation')
    const guard = index.indexOf("if (request.method === 'POST' && operation?.operation !== 'createPlan')")
    expect(operationResolution).toBeGreaterThan(index.indexOf('requireLayer(request)'))
    expect(guard).toBeGreaterThan(operationResolution)
    expect(index).toContain("'SERVICE_UNAVAILABLE'")
    expect(index).toContain('verified payment-provider synchronization is available')
    expect(index).toContain('createMembershipPlanDraft(')
    expect(index).toContain('publishPathMatch')
    expect(index).toContain('publishMembershipPlan(')
    expect(index).toContain('transitionMembershipPlanLifecycle(')
    expect(index.indexOf('transitionMembershipPlanLifecycle(')).toBeLessThan(guard)
    expect(index).not.toContain('createSubscription(')
    expect(index).not.toContain('transitionSubscription(')
    expect(index).not.toContain('changeSubscriptionPlan(')
  })


  it('serves the creator membership decision only to W03 and returns no subscription details', async () => {
    const allowLimiter = { limit: async () => ({ success: true }) }
    let lastSql = ''
    let readCount = 0
    const membershipDb = {
      prepare(sql: string) {
        const statement = {
          bind() { return statement },
          async first<T>() {
            lastSql = sql
            readCount += 1
            return { subscription_id: 'sub_active' } as T
          },
          async all<T>() { return { results: [] as T[] } },
          async run() { return { meta: { changes: 0 } } },
        }
        return statement
      },
    } as unknown as D1Database
    const env = {
      D1_01: membershipDb,
      D1_04: {} as D1Database,
      SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      SUBSCRIPTION_READ_LIMITER: allowLimiter,
      SUBSCRIPTION_WRITE_LIMITER: allowLimiter,
    }
    const makeRequest = (caller = 'W03') => new Request('https://luckread-w07.internal/internal/entitlements/check-creator-membership', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-LuckRead-Caller': caller,
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'content-access-check',
        'X-LuckRead-Principal-User-Id': 'user_1',
        'X-LuckRead-Principal-Layer': 'L2',
      },
      body: JSON.stringify({ creatorId: 'creator_1' }),
    })

    const response = await w07.fetch(makeRequest(), env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { allowed: true, reason: 'ACTIVE_CREATOR_MEMBERSHIP' },
    })
    expect(lastSql).toContain("status IN ('ACTIVE','TRIALING')")
    expect(lastSql).toContain('current_period_start <= ?')
    expect(lastSql).toContain('current_period_end > ?')
    expect(lastSql).toContain('(cancel_at IS NULL OR cancel_at > ?)')

    const beforeDenied = readCount
    const denied = await w07.fetch(makeRequest('W01'), env)
    expect(denied.status).toBe(403)
    expect(readCount).toBe(beforeDenied)

    const credentialed = await w07.fetch(new Request('https://luckread-w07.internal/internal/entitlements/check-creator-membership', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-LuckRead-Caller': 'W03',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'content-access-cookie-test',
        'X-LuckRead-Principal-User-Id': 'user_1',
        'X-LuckRead-Principal-Layer': 'L2',
        Cookie: 'session=must-not-forward',
      },
      body: JSON.stringify({ creatorId: 'creator_1' }),
    }), env)
    expect(credentialed.status).toBe(403)
    expect(readCount).toBe(beforeDenied)
  })

  it('routes creator-filtered GET /plans through the scoped active-public plan query', async () => {
    const allowLimiter = { limit: async () => ({ success: true }) }
    const request = new Request('https://luckread-w07.internal/plans?limit=10&creatorId=creator_two', {
      method: 'GET',
      headers: {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'creator-plan-filter-test',
        'X-LuckRead-Principal-User-Id': 'user_1',
        'X-LuckRead-Principal-Layer': 'L2',
      },
    })
    const response = await w07.fetch(request, {
      D1_01: fakeDb([], [
        activePlan('plan_creator_one', { owner_id: 'creator_one' }),
        activePlan('plan_creator_two', { owner_id: 'creator_two' }),
        activePlan('plan_creator_two_private', {
          owner_id: 'creator_two',
          status: 'DRAFT',
          visibility: 'PRIVATE',
        }),
      ]),
      SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      SUBSCRIPTION_READ_LIMITER: allowLimiter,
      SUBSCRIPTION_WRITE_LIMITER: allowLimiter,
    })
    const body = await response.json() as { data?: { docs?: Array<{ planId: string }> } }
    expect(response.status).toBe(200)
    expect(body.data?.docs?.map((plan) => plan.planId)).toEqual(['plan_creator_two'])
  })

  it('routes authenticated GET /plans through the active-public plan query', async () => {
    const allowLimiter = { limit: async () => ({ success: true }) }
    const request = new Request('https://luckread-w07.internal/plans?limit=10', {
      method: 'GET',
      headers: {
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'plans-catalog-test',
        'X-LuckRead-Principal-User-Id': 'user_1',
        'X-LuckRead-Principal-Layer': 'L2',
      },
    })
    const response = await w07.fetch(request, {
      D1_01: fakeDb([], [activePlan('plan_catalog')]),
      SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      SUBSCRIPTION_READ_LIMITER: allowLimiter,
      SUBSCRIPTION_WRITE_LIMITER: allowLimiter,
    })
    const body = await response.json() as { data?: { docs?: Array<{ planId: string; planVersion: number; priceMinor: number }> } }
    expect(response.status).toBe(200)
    expect(body.data?.docs).toHaveLength(1)
    expect(body.data?.docs?.[0]).toMatchObject({ planId: 'plan_catalog', planVersion: 3, priceMinor: 500 })
  })

  it('creates creator plan drafts only with a trusted creator identity and idempotent key', async () => {
    const allowLimiter = { limit: async () => ({ success: true }) }
    const input = {
      name: 'Supporter', tier: 'supporter', billingInterval: 'MONTHLY',
      priceMinor: 500, currency: 'USD', benefits: ['member posts'],
    }
    const makeRequest = (layer = 'L3', creatorId = 'creator_1') => new Request('https://luckread-w07.internal/membership/plans', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'creator-plan-create',
        'X-LuckRead-Principal-User-Id': 'user_1',
        'X-LuckRead-Principal-Layer': layer,
        ...(creatorId ? { 'X-LuckRead-Verified-Creator-Id': creatorId } : {}),
        'Idempotency-Key': 'plan-draft-create-1',
      },
      body: JSON.stringify(input),
    })
    const db = fakeDb([])
    const env = {
      D1_01: db,
      SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      SUBSCRIPTION_READ_LIMITER: allowLimiter,
      SUBSCRIPTION_WRITE_LIMITER: allowLimiter,
    }
    const first = await w07.fetch(makeRequest(), env)
    const firstBody = await first.json() as { data?: { planId?: string; status?: string; visibility?: string; replayed?: boolean } }
    expect(first.status).toBe(201)
    expect(firstBody.data).toMatchObject({ status: 'DRAFT', visibility: 'PRIVATE', replayed: false })

    const replay = await w07.fetch(makeRequest(), env)
    const replayBody = await replay.json() as { data?: { planId?: string; replayed?: boolean } }
    expect(replay.status).toBe(200)
    expect(replayBody.data).toMatchObject({ planId: firstBody.data?.planId, replayed: true })

    const lowerLayer = await w07.fetch(makeRequest('L2'), env)
    expect(lowerLayer.status).toBe(403)

    // The API contract specifies minimum L3; higher layers must not be rejected by an exact L3/L4 allowlist.
    const higherLayer = await w07.fetch(makeRequest('L5'), env)
    expect(higherLayer.status).toBe(200)
  })

  it('publishes only the verified creator-owned plan draft with If-Match CAS and exact retry replay', async () => {
    const allowLimiter = { limit: async () => ({ success: true }) }
    const planId = 'plan_' + 'a'.repeat(64)
    const db = fakeDb([], [activePlan(planId, {
      current_version: 1,
      status: 'DRAFT',
      visibility: 'PRIVATE',
      version: 1,
    })])
    const env = {
      D1_01: db,
      SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      SUBSCRIPTION_READ_LIMITER: allowLimiter,
      SUBSCRIPTION_WRITE_LIMITER: allowLimiter,
    }
    const makeRequest = (options: { layer?: string; creatorId?: string; ifMatch?: string | null } = {}) => {
      const headers = new Headers({
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'plan-publish-route-test',
        'X-LuckRead-Principal-User-Id': 'user_1',
        'X-LuckRead-Principal-Layer': options.layer ?? 'L3',
        'X-LuckRead-Verified-Creator-Id': options.creatorId ?? 'creator_1',
      })
      if (options.ifMatch !== null) headers.set('If-Match', options.ifMatch ?? '"lr-plan-v1"')
      return new Request('https://luckread-w07.internal/membership/plans/' + planId + '/publish', {
        method: 'POST',
        headers,
      })
    }

    const first = await w07.fetch(makeRequest(), env)
    const firstBody = await first.json() as { data?: { planId?: string; status?: string; visibility?: string; version?: number; etag?: string; replayed?: boolean } }
    expect(first.status).toBe(200)
    expect(firstBody.data).toMatchObject({
      planId,
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      version: 2,
      etag: '"lr-plan-v2"',
      replayed: false,
    })

    const replay = await w07.fetch(makeRequest({ ifMatch: '"lr-plan-v1"' }), env)
    const replayBody = await replay.json() as { data?: { planId?: string; version?: number; replayed?: boolean } }
    expect(replay.status).toBe(200)
    expect(replayBody.data).toMatchObject({ planId, version: 2, replayed: true })

    const stale = await w07.fetch(makeRequest({ ifMatch: '"lr-plan-v9"' }), env)
    expect(stale.status).toBe(412)

    const otherOwner = await w07.fetch(makeRequest({ creatorId: 'creator_2' }), env)
    expect(otherOwner.status).toBe(404)

    const lowerLayer = await w07.fetch(makeRequest({ layer: 'L2' }), env)
    expect(lowerLayer.status).toBe(403)

    const missingEtag = await w07.fetch(makeRequest({ ifMatch: null }), env)
    expect(missingEtag.status).toBe(428)
  })

  it('denies plan creation if W01 did not provide the W08-verified creator identity', async () => {
    const allowLimiter = { limit: async () => ({ success: true }) }
    const db = {
      batch() { throw new Error('creator identity must be checked before D1 writes') },
      prepare() { throw new Error('creator identity must be checked before D1 writes') },
    } as unknown as D1Database
    const response = await w07.fetch(new Request('https://luckread-w07.internal/membership/plans', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'missing-creator-id',
        'X-LuckRead-Principal-User-Id': 'user_1',
        'X-LuckRead-Principal-Layer': 'L3',
        'Idempotency-Key': 'plan-draft-create-2',
      },
      body: JSON.stringify({ name: 'Supporter', tier: 'supporter', billingInterval: 'MONTHLY', priceMinor: 500, currency: 'USD', benefits: [] }),
    }), {
      D1_01: db,
      SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      SUBSCRIPTION_READ_LIMITER: allowLimiter,
      SUBSCRIPTION_WRITE_LIMITER: allowLimiter,
    })
    expect(response.status).toBe(403)
  })

  it('returns 503 for authenticated W07 POST without touching D1', async () => {
    let databaseTouched = false
    const db = {
      prepare() {
        databaseTouched = true
        throw new Error('D1 must not be touched by a fail-closed POST')
      },
    } as unknown as D1Database
    const request = new Request('https://luckread-w07.internal/memberships/subscriptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': 'test-correlation',
        'X-LuckRead-Principal-User-Id': 'user_1',
        'X-LuckRead-Principal-Layer': 'L2',
        'Idempotency-Key': 'test-idempotency',
      },
      body: JSON.stringify({ planId: 'plan_basic' }),
    })
    const allowLimiter = { limit: async () => ({ success: true }) }
    const response = await w07.fetch(request, {
      D1_01: db,
      SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: allowLimiter,
      SUBSCRIPTION_READ_LIMITER: allowLimiter,
      SUBSCRIPTION_WRITE_LIMITER: allowLimiter,
    })
    const body = await response.json() as { error?: { code?: string } }
    expect(response.status).toBe(503)
    expect(body.error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(databaseTouched).toBe(false)
  })
  it('calculates billing periods without month-end overflow or leap-day drift', () => {
    expect(addBillingPeriod('2026-01-31T12:34:56.789Z', 'MONTHLY')).toBe('2026-02-28T12:34:56.789Z')
    expect(addBillingPeriod('2024-02-29T00:00:00.000Z', 'YEARLY')).toBe('2025-02-28T00:00:00.000Z')
    expect(addBillingPeriod('2026-10-28T12:00:00.000Z', 'YEARLY')).toBe('2027-10-28T12:00:00.000Z')
    expect(() => addBillingPeriod('not-a-date', 'MONTHLY')).toThrow()
  })

  it('creates an idempotent pending subscription from the current authoritative plan version', async () => {
    const db = fakeDb([], [activePlan('plan_basic', { current_version: 3, owner_id: 'creator_1' })]); const first = await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' });
    const second = await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' });
    expect(first.subscriptionId).toBe(second.subscriptionId); expect(first.status).toBe('PENDING'); expect(first.planVersion).toBe(3); expect(first.creatorId).toBe('creator_1'); expect(first.version).toBe(1); expect(first.etag).toBe(etagForVersion(1))
    const material = new TextEncoder().encode('subscription-create\\0user_1\\0create-1')
    const digest = await crypto.subtle.digest('SHA-256', material)
    const legacyStableId = 'sub_' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    expect(first.subscriptionId).toBe(legacyStableId)
    expect(first.subscriptionId).toBe('sub_09509d9e66556f6b498f7aa8bf8727441d59b99eefe8f21cb2269f398082fdfa')
  })
  it('rejects inputs that could collide with legacy subscription ID delimiters', async () => {
    const db = fakeDb([], [activePlan('plan_basic', { owner_id: 'creator_1' })])

    await expect(createSubscription(db, 'user_a\\0b', {
      planId: 'plan_basic',
      idempotencyKey: 'key',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })

    await expect(createSubscription(db, 'user_a', {
      planId: 'plan_basic',
      idempotencyKey: 'b\\0key',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('keeps identities distinct when subscriber or idempotency inputs contain NUL', async () => {
    const db = fakeDb([], [activePlan('plan_basic', { owner_id: 'creator_1' })])
    const first = await createSubscription(db, 'user_a\u0000b', {
      planId: 'plan_basic',
      idempotencyKey: 'key',
    })
    const second = await createSubscription(db, 'user_a', {
      planId: 'plan_basic',
      idempotencyKey: 'b\u0000key',
    })
    expect(first.subscriptionId).not.toBe(second.subscriptionId)
  })

  it('fails closed for missing, inactive, private, or non-creator plans', async () => {
    const cases: MembershipPlanRow[][] = [
      [],
      [activePlan('plan_basic', { status: 'DRAFT' })],
      [activePlan('plan_basic', { visibility: 'PRIVATE' })],
      [activePlan('plan_basic', { owner_type: 'COMMUNITY' })],
      [activePlan('plan_basic', { has_current_version: false })],
    ]
    for (const plans of cases) {
      await expect(createSubscription(fakeDb([], plans), 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' }))
        .rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 409 })
    }
  })
  it('rejects idempotency-key reuse for a different plan', async () => {
    const db = fakeDb([], [activePlan()]); await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' })
    await expect(createSubscription(db, 'user_1', { planId: 'plan_pro', idempotencyKey: 'create-1' })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })
  it('scopes reads to the subscriber', async () => {
    const db = fakeDb([baseRow()]); await expect(getSubscription(db, 'user_2', 'sub_existing')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
  })
  it('enforces If-Match for pause and transitions ACTIVE to PAUSED', async () => {
    const db = fakeDb([baseRow()]); const before = await getSubscription(db, 'user_1', 'sub_existing'); const after = await transitionSubscription(db, 'user_1', 'sub_existing', 'pause', before.etag)
    expect(after.status).toBe('PAUSED'); expect(after.updatedAt).not.toBe(before.updatedAt); expect(after.version).toBe(before.version + 1); expect(after.etag).toBe(etagForVersion(2))
  })
  it('fails stale version If-Match without changing state when the requested transition has not converged', async () => {
    const db = fakeDb([baseRow({ version: 2 })])
    await expect(transitionSubscription(db, 'user_1', 'sub_existing', 'pause', etagForVersion(1))).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
    const after = await getSubscription(db, 'user_1', 'sub_existing')
    expect(after.status).toBe('ACTIVE')
    expect(after.version).toBe(2)
  })

  it('treats a repeated pause with a stale If-Match as an idempotent success', async () => {
    const db = fakeDb([baseRow({ status: 'PAUSED', updated_at: '2026-10-02T12:00:01.000Z', version: 2 })])
    const result = await transitionSubscription(db, 'user_1', 'sub_existing', 'pause', etagForVersion(1))
    expect(result.status).toBe('PAUSED')
    expect(result.updatedAt).toBe('2026-10-02T12:00:01.000Z')
  })

  it('treats a repeated cancel with a stale If-Match as an idempotent success', async () => {
    const db = fakeDb([baseRow({ status: 'CANCELED', updated_at: '2026-10-02T12:00:01.000Z', cancel_at: '2026-10-02T12:00:01.000Z', version: 2 })])
    const result = await transitionSubscription(db, 'user_1', 'sub_existing', 'cancel', etagForVersion(1))
    expect(result.status).toBe('CANCELED')
  })

  it('advances updatedAt when the clock equals the stored timestamp', async () => {
    const db = fakeDb([baseRow()])
    const stored = new Date('2026-10-02T12:00:00.000Z')
    vi.setSystemTime(stored)
    const before = await getSubscription(db, 'user_1', 'sub_existing')
    const after = await transitionSubscription(db, 'user_1', 'sub_existing', 'pause', before.etag)
    expect(Date.parse(after.updatedAt)).toBe(Date.parse(before.updatedAt) + 1)
  })
  it('changes plan only within the same creator and preserves the authoritative creator reference', async () => {
    const db = fakeDb([baseRow({ creator_id: 'creator_1' })], [activePlan('plan_pro', { current_version: 7, owner_id: 'creator_1' })]); const before = await getSubscription(db, 'user_1', 'sub_existing'); const after = await changeSubscriptionPlan(db, 'user_1', 'sub_existing', 'plan_pro', before.etag)
    expect(after.planId).toBe('plan_pro'); expect(after.planVersion).toBe(7); expect(after.creatorId).toBe('creator_1'); expect(after.status).toBe('ACTIVE'); expect(after.version).toBe(before.version + 1); expect(after.etag).toBe(etagForVersion(2))
  })

  it('refuses a plan change to a missing or unavailable plan', async () => {
    const db = fakeDb([baseRow()]); const before = await getSubscription(db, 'user_1', 'sub_existing')
    await expect(changeSubscriptionPlan(db, 'user_1', 'sub_existing', 'plan_unavailable', before.etag)).rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 409 })
    const after = await getSubscription(db, 'user_1', 'sub_existing')
    expect(after.planId).toBe('plan_basic')
    expect(after.version).toBe(before.version)
  })

  it('does not allow changing a subscription to another creator\'s plan', async () => {
    const db = fakeDb([baseRow({ creator_id: 'creator_1' })], [activePlan('plan_other_creator', { owner_id: 'creator_2' })])
    const before = await getSubscription(db, 'user_1', 'sub_existing')
    await expect(changeSubscriptionPlan(db, 'user_1', 'sub_existing', 'plan_other_creator', before.etag))
      .rejects.toMatchObject({ code: 'PLAN_NOT_ACTIVE', status: 409 })
    const after = await getSubscription(db, 'user_1', 'sub_existing')
    expect(after.planId).toBe('plan_basic')
    expect(after.creatorId).toBe('creator_1')
    expect(after.version).toBe(before.version)
  })

  it('treats a repeated plan change with a stale If-Match as an idempotent success when the plan already converged', async () => {
    const db = fakeDb([baseRow({ plan_id: 'plan_pro', updated_at: '2026-10-02T12:00:01.000Z', version: 2 })])
    const result = await changeSubscriptionPlan(db, 'user_1', 'sub_existing', 'plan_pro', etagForVersion(1))
    expect(result.planId).toBe('plan_pro')
    expect(result.updatedAt).toBe('2026-10-02T12:00:01.000Z')
  })
  it('rejects cancel from PENDING according to the state machine', async () => {
    const db = fakeDb([baseRow({ status: 'PENDING' })]); const before = await getSubscription(db, 'user_1', 'sub_existing'); await expect(transitionSubscription(db, 'user_1', 'sub_existing', 'cancel', before.etag)).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  })
  it('lists only the current subscriber records with bounded pagination', async () => {
    const db = fakeDb([
      baseRow({ subscription_id: 'sub_old', created_at: '2026-10-01T12:00:00.000Z', updated_at: '2026-10-01T12:00:00.000Z' }),
      baseRow({ subscription_id: 'sub_new', created_at: '2026-10-02T13:00:00.000Z', updated_at: '2026-10-02T13:00:00.000Z' }),
      baseRow({ subscription_id: 'sub_other', subscriber_id: 'user_2', created_at: '2026-10-03T12:00:00.000Z' }),
    ])
    const result = await listSubscriptions(db, 'user_1', 1, 1)
    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]?.subscriptionId).toBe('sub_new')
    expect(result.hasNextPage).toBe(true)
    expect(result.limit).toBe(1)
    expect(result.page).toBe(1)
  })

  it('lists only active public creator plans with stable cursor pagination', async () => {
    const db = fakeDb([], [
      activePlan('plan_alpha', { created_at: '2026-10-26T12:00:00.000Z', name: 'Alpha' }),
      activePlan('plan_beta', { created_at: '2026-10-26T12:00:00.000Z', name: 'Beta' }),
      activePlan('plan_private', { visibility: 'PRIVATE' }),
      activePlan('plan_paused', { status: 'PAUSED' }),
      activePlan('plan_community', { owner_type: 'COMMUNITY' }),
      activePlan('plan_missing_version', { has_current_version: false }),
    ])
    const first = await listActiveMembershipPlans(db, 1)
    expect(first.docs).toHaveLength(1)
    expect(first.docs[0]?.planId).toBe('plan_beta')
    expect(first.docs[0]?.planVersion).toBe(3)
    expect(first.docs[0]?.priceMinor).toBe(500)
    expect(first.docs[0]?.benefits).toEqual(['member-posts'])
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBeTruthy()

    const second = await listActiveMembershipPlans(db, 1, first.nextCursor)
    expect(second.docs.map((plan) => plan.planId)).toEqual(['plan_alpha'])
    expect(second.hasMore).toBe(false)
    expect(second.nextCursor).toBeNull()
    expect(JSON.stringify([first, second])).not.toContain('plan_private')
    expect(JSON.stringify([first, second])).not.toContain('plan_paused')
    expect(JSON.stringify([first, second])).not.toContain('plan_community')
    expect(JSON.stringify([first, second])).not.toContain('plan_missing_version')
  })

  it('filters public membership plan discovery to the requested creator only', async () => {
    const db = fakeDb([], [
      activePlan('plan_creator_one', { owner_id: 'creator_one' }),
      activePlan('plan_creator_two', { owner_id: 'creator_two' }),
      activePlan('plan_creator_two_private', {
        owner_id: 'creator_two',
        status: 'DRAFT',
        visibility: 'PRIVATE',
      }),
    ])

    const result = await listActiveMembershipPlans(db, 20, null, 'creator_two')
    expect(result.docs.map((plan) => plan.planId)).toEqual(['plan_creator_two'])
    expect(JSON.stringify(result)).not.toContain('plan_creator_one')
    expect(JSON.stringify(result)).not.toContain('plan_creator_two_private')
  })

  it('rejects malformed membership plan cursors', async () => {
    await expect(listActiveMembershipPlans(fakeDb([], [activePlan()]), 20, 'not-a-valid-cursor'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('creates private creator-owned plan drafts idempotently and rejects key reuse with changed data', async () => {
    const db = fakeDb([])
    const input = {
      name: 'Supporter',
      tier: 'supporter',
      billingInterval: 'MONTHLY',
      priceMinor: 500,
      currency: 'USD',
      benefits: ['member posts', 'supporter badge'],
    }
    const first = await createMembershipPlanDraft(db, 'user_1', 'creator_1', input, 'draft-create-1')
    const replay = await createMembershipPlanDraft(db, 'user_1', 'creator_1', input, 'draft-create-1')
    expect(first).toMatchObject({ creatorId: 'creator_1', planVersion: 1, status: 'DRAFT', visibility: 'PRIVATE', version: 1, replayed: false })
    expect(replay).toMatchObject({ planId: first.planId, status: 'DRAFT', visibility: 'PRIVATE', version: 1, replayed: true })
    await expect(createMembershipPlanDraft(db, 'user_1', 'creator_1', { ...input, priceMinor: 900 }, 'draft-create-1'))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('publishes only an owner-scoped private draft and converges safely on an idempotent retry', async () => {
    const db = fakeDb([], [
      activePlan('plan_publish', {
        current_version: 1,
        status: 'DRAFT',
        visibility: 'PRIVATE',
        version: 1,
      }),
    ])

    const first = await publishMembershipPlan(db, 'creator_1', 'plan_publish', '"lr-plan-v1"')
    expect(first).toMatchObject({
      planId: 'plan_publish',
      creatorId: 'creator_1',
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      planVersion: 1,
      version: 2,
      etag: '"lr-plan-v2"',
      replayed: false,
    })

    const replay = await publishMembershipPlan(db, 'creator_1', 'plan_publish', '"lr-plan-v1"')
    expect(replay).toMatchObject({
      planId: 'plan_publish',
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      version: 2,
      replayed: true,
    })
    const publicPlans = await listActiveMembershipPlans(db, 20)
    expect(publicPlans.docs.map((plan) => plan.planId)).toContain('plan_publish')
  })

  it('requires If-Match and denies cross-owner publish and stale ETags', async () => {
    const draft = fakeDb([], [
      activePlan('plan_publish_owner', {
        current_version: 1,
        status: 'DRAFT',
        visibility: 'PRIVATE',
        version: 1,
      }),
    ])
    await expect(publishMembershipPlan(draft, 'creator_1', 'plan_publish_owner', null))
      .rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 })
    await expect(publishMembershipPlan(draft, 'creator_other', 'plan_publish_owner', '"lr-plan-v1"'))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })

    const laterVersion = fakeDb([], [
      activePlan('plan_already_changed', {
        current_version: 1,
        status: 'ACTIVE',
        visibility: 'PUBLIC',
        version: 4,
      }),
    ])
    await expect(publishMembershipPlan(laterVersion, 'creator_1', 'plan_already_changed', '"lr-plan-v1"'))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
  })

  it('revises an owned plan by creating an immutable version and preserves earlier subscription snapshots', async () => {
    const plan = activePlan('plan_revision', { current_version: 1, version: 2 })
    const db = fakeDb([baseRow({ subscription_id: 'sub_old_version', plan_id: 'plan_revision', plan_version: 1 })], [plan])
    const updated = await reviseMembershipPlan(db, 'creator_1', 'plan_revision', '"lr-plan-v2"', {
      name: 'Creator Plus', tier: 'plus', billingInterval: 'MONTHLY', priceMinor: 900,
      currency: 'USD', benefits: ['member-posts', 'monthly-live'],
    })
    expect(updated).toMatchObject({
      planId: 'plan_revision', planVersion: 2, name: 'Creator Plus', tier: 'plus',
      priceMinor: 900, benefits: ['member-posts', 'monthly-live'], status: 'ACTIVE',
      visibility: 'PUBLIC', version: 3, etag: '"lr-plan-v3"', replayed: false,
    })
    const subscriptions = await listSubscriptions(db, 'user_1', 20, 1)
    expect(subscriptions.docs[0]).toMatchObject({ subscriptionId: 'sub_old_version', planVersion: 1 })
    const list = await listActiveMembershipPlans(db, 20)
    expect(list.docs.find((item) => item.planId === 'plan_revision')).toMatchObject({
      planVersion: 2, priceMinor: 900, name: 'Creator Plus',
    })
  })

  it('replays an exact plan revision and denies stale, foreign-owner, or retired-plan updates', async () => {
    const plan = activePlan('plan_revision_replay', { current_version: 1, version: 2 })
    const db = fakeDb([], [plan])
    const input = { name: 'Creator Plus', tier: 'plus', billingInterval: 'YEARLY', priceMinor: 7500,
      currency: 'USD', benefits: ['member-posts'] }
    const first = await reviseMembershipPlan(db, 'creator_1', 'plan_revision_replay', '"lr-plan-v2"', input)
    const replay = await reviseMembershipPlan(db, 'creator_1', 'plan_revision_replay', '"lr-plan-v2"', input)
    expect(first).toMatchObject({ version: 3, planVersion: 2, replayed: false })
    expect(replay).toMatchObject({ version: 3, planVersion: 2, replayed: true })
    await expect(reviseMembershipPlan(db, 'creator_1', 'plan_revision_replay', '"lr-plan-v2"', {
      ...input, priceMinor: 7800,
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
    await expect(reviseMembershipPlan(db, 'creator_other', 'plan_revision_replay', '"lr-plan-v3"', input))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    const retired = fakeDb([], [activePlan('plan_retired', { status: 'RETIRED', current_version: 1 })])
    await expect(reviseMembershipPlan(retired, 'creator_1', 'plan_retired', '"lr-plan-v1"', input))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  })

  it('pauses, resumes, and retires a paused plan without changing its immutable commercial version', async () => {
    const db = fakeDb([], [activePlan('plan_lifecycle', { current_version: 3, version: 4 })])
    const paused = await transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_lifecycle', '"lr-plan-v4"', 'pause')
    expect(paused).toMatchObject({ status: 'PAUSED', visibility: 'PRIVATE', planVersion: 3, version: 5, etag: '"lr-plan-v5"', replayed: false })
    const replay = await transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_lifecycle', '"lr-plan-v4"', 'pause')
    expect(replay).toMatchObject({ status: 'PAUSED', version: 5, planVersion: 3, replayed: true })
    expect((await listActiveMembershipPlans(db, 20)).docs.map(x => x.planId)).not.toContain('plan_lifecycle')
    const resumed = await transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_lifecycle', '"lr-plan-v5"', 'resume')
    expect(resumed).toMatchObject({ status: 'ACTIVE', visibility: 'PUBLIC', planVersion: 3, version: 6, etag: '"lr-plan-v6"', replayed: false })
    expect((await listActiveMembershipPlans(db, 20)).docs.map(x => x.planId)).toContain('plan_lifecycle')
    const pausedAgain = await transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_lifecycle', '"lr-plan-v6"', 'pause')
    expect(pausedAgain).toMatchObject({ status: 'PAUSED', visibility: 'PRIVATE', version: 7, planVersion: 3 })
    const retired = await transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_lifecycle', '"lr-plan-v7"', 'retire')
    expect(retired).toMatchObject({ status: 'RETIRED', visibility: 'PRIVATE', planVersion: 3, version: 8, etag: '"lr-plan-v8"', replayed: false })
    expect((await listActiveMembershipPlans(db, 20)).docs.map(x => x.planId)).not.toContain('plan_lifecycle')
    const retireReplay = await transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_lifecycle', '"lr-plan-v7"', 'retire')
    expect(retireReplay).toMatchObject({ status: 'RETIRED', visibility: 'PRIVATE', version: 8, planVersion: 3, replayed: true })
    await expect(transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_lifecycle', '"lr-plan-v8"', 'resume'))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  })

  it('requires a plan to be paused before retirement', async () => {
    const db = fakeDb([], [activePlan('plan_retire_active', { version: 4 })])
    await expect(transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_retire_active', '"lr-plan-v4"', 'retire'))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  })

  it('rejects foreign owners, stale ETags, invalid source states, and retired plans', async () => {
    const db = fakeDb([], [activePlan('plan_lifecycle_scope', { current_version: 1, status: 'DRAFT', visibility: 'PRIVATE', version: 2 })])
    await expect(transitionMembershipPlanLifecycle(db, 'creator_other', 'plan_lifecycle_scope', '"lr-plan-v2"', 'pause'))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    await expect(transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_lifecycle_scope', '"lr-plan-v1"', 'pause'))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
    await expect(transitionMembershipPlanLifecycle(db, 'creator_1', 'plan_lifecycle_scope', '"lr-plan-v2"', 'pause'))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
    const retired = fakeDb([], [activePlan('plan_lifecycle_retired', { status: 'RETIRED', version: 3 })])
    await expect(transitionMembershipPlanLifecycle(retired, 'creator_1', 'plan_lifecycle_retired', '"lr-plan-v3"', 'pause'))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  })

  it('rejects client-controlled owner, lifecycle state, malformed currency, and unsafe price values', () => {
    expect(() => normalizeMembershipPlanDraft({
      name: 'Basic', tier: 'basic', billingInterval: 'MONTHLY', priceMinor: 500, currency: 'USD', benefits: [],
      creatorId: 'creator_attacker',
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED', status: 400 }))
    expect(() => normalizeMembershipPlanDraft({
      name: 'Basic', tier: 'basic', billingInterval: 'MONTHLY', priceMinor: 500, currency: 'US$', benefits: [],
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED', status: 400 }))
    expect(() => normalizeMembershipPlanDraft({
      name: 'Basic', tier: 'Basic', billingInterval: 'monthly', priceMinor: 500, currency: 'usd', benefits: [],
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED', status: 400 }))
    expect(() => normalizeMembershipPlanDraft({
      name: 'Basic', tier: 'basic', billingInterval: 'MONTHLY', priceMinor: Number.MAX_SAFE_INTEGER, currency: 'USD', benefits: [],
    })).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED', status: 400 }))
  })

  it('lists only the verified creator-owned plans, including private drafts', async () => {
    const db = fakeDb([], [
      activePlan('plan_active'),
      activePlan('plan_private', { status: 'DRAFT', visibility: 'PRIVATE', owner_id: 'creator_1', created_at: '2026-10-03T12:00:00.000Z' }),
      activePlan('plan_other_creator', { owner_id: 'creator_2' }),
    ])
    const result = await listCreatorMembershipPlans(db, 'creator_1', 20)
    expect(result.docs.map((plan) => plan.planId)).toEqual(['plan_private', 'plan_active'])
    expect(result.docs.find((plan) => plan.planId === 'plan_private')).toMatchObject({ status: 'DRAFT', visibility: 'PRIVATE' })
    expect(JSON.stringify(result)).not.toContain('plan_other_creator')
  })

  it('fails closed when persisted creator plan commercial fields are malformed', async () => {
    const invalidBenefits = fakeDb([], [
      activePlan('plan_corrupt_benefits', { benefits_json: '[1]' }),
    ])
    await expect(listCreatorMembershipPlans(invalidBenefits, 'creator_1'))
      .rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 })
    await expect(listActiveMembershipPlans(invalidBenefits, 20))
      .rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 })

    const invalidPrice = fakeDb([], [
      activePlan('plan_corrupt_price', { price_minor: 12.5 }),
    ])
    await expect(listCreatorMembershipPlans(invalidPrice, 'creator_1'))
      .rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 })
  })

  it('uses version CAS rather than updated_at as the concurrency authority', async () => {
    const runtime = readFileSync(new URL('./subscription-runtime.ts', import.meta.url), 'utf8')
    expect(runtime).toContain('version = version + 1')
    expect(runtime).toContain('AND version = ?')
    expect(runtime).not.toContain('AND updated_at = ?')
  })

  it('restricts manual deployment to reviewed main and requires read-only schema preflight', () => {
    const workflow = readFileSync(new URL('../../../.github/workflows/w07-subscription-runtime-deploy.yml', import.meta.url), 'utf8')
    expect(workflow).toContain('git merge-base --is-ancestor "$SOURCE_SHA" origin/main')
    expect(workflow).toContain('SOURCE_SHA: ${{ inputs.source_sha }}')
    expect(workflow).not.toContain('ref: ${{ inputs.source_sha }}')
    expect(workflow).not.toContain('[[ "${{ inputs.source_sha }}"')
    expect(workflow).toContain('"sourceSha": "$SOURCE_SHA"')
    expect(workflow).not.toContain('"sourceSha": "${{ inputs.source_sha }}"')
    expect(workflow).toContain('Read-only D1-01 migration and schema preflight')
    expect(workflow).toContain("0003_membership_plans.sql")
    expect(workflow).toContain('PRAGMA table_info("membership_subscriptions")')
    expect(workflow).toContain('PRAGMA foreign_key_list("membership_subscriptions")')
    expect(workflow).toContain('PRAGMA table_info("membership_plans")')
    expect(workflow).toContain('PRAGMA table_info("membership_plan_versions")')
    expect(workflow).toContain("tbl_name IN ('membership_plans','membership_plan_versions')")
    expect(workflow).toContain('SELECT COUNT(*) AS invalid_versions')
    expect(workflow).toContain('invalid_current_plan_versions')
    expect(workflow).toContain('node scripts/verify-remote-preflight.mjs preflight')
    expect(workflow).toContain('node scripts/verify-remote-preflight.mjs postflight')
    const preflight = readFileSync(new URL('../scripts/verify-remote-preflight.mjs', import.meta.url), 'utf8')
    expect(preflight).toContain("migrationAction = 'apply'")
    expect(preflight).toContain("migrationAction = 'skip'")
    expect(workflow).toContain("if: steps.d1_preflight.outputs.migration_action == 'apply'")
    expect(workflow.indexOf('Read-only D1-01 migration and schema preflight'))
      .toBeLessThan(workflow.indexOf('Apply D1-01 Subscription migration'))
    expect(workflow.indexOf('Apply D1-01 Subscription migration'))
      .toBeLessThan(workflow.indexOf('Read-only D1-01 schema and version postflight'))
    expect(workflow.indexOf('Read-only D1-01 schema and version postflight'))
      .toBeLessThan(workflow.indexOf('Deploy W07'))
  })

  it('rejects invalid version ETag values', async () => {
    expect(() => etagForVersion(0)).toThrowError(expect.objectContaining({ code: 'INTEGRITY_VIOLATION', status: 500 }))
    const db = fakeDb([baseRow()])
    await expect(transitionSubscription(db, 'user_1', 'sub_existing', 'pause', '"lr-v9007199254740992"')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
  })

  it('does not expose entitlementSnapshotRef', async () => {
    const db = fakeDb([baseRow({ entitlement_snapshot_ref: 'internal-ref' })]); const result = await getSubscription(db, 'user_1', 'sub_existing'); expect(result).not.toHaveProperty('entitlementSnapshotRef')
  })
})

afterEach(() => vi.useRealTimers())

const preflightDatabaseList = [{ name: 'luckread', uuid: '2f80471e-3756-49f9-8db1-7707a433ad64' }]
const preflightIndexes = [{
  results: [
    { seq: 0, name: 'ix_membership_subscriptions_subscriber_status_period' },
    { seq: 1, name: 'ix_membership_subscriptions_plan_version' },
    { seq: 2, name: 'ix_membership_subscriptions_creator_status' },
    { seq: 3, name: 'ix_membership_subscriptions_updated_at' },
  ],
}]
const legacySchemaNames = [
  ['subscription_id','TEXT',1,1], ['subscriber_id','TEXT',1,0], ['plan_id','TEXT',1,0],
  ['plan_version','INTEGER',1,0], ['creator_id','TEXT',0,0], ['status','TEXT',1,0],
  ['started_at','TEXT',1,0], ['current_period_start','TEXT',1,0], ['current_period_end','TEXT',1,0],
  ['cancel_at','TEXT',0,0], ['entitlement_snapshot_ref','TEXT',0,0],
  ['created_at','TEXT',1,0], ['updated_at','TEXT',1,0],
]
const preflightSchema = (withVersion = false, versionDefault = '1') => [{
  results: [...legacySchemaNames, ...(withVersion ? [['version','INTEGER',1,0]] : [])]
    .map(([name,type,notnull,pk],cid) => ({
      cid, name, type, notnull, pk,
      dflt_value: name === 'version' ? versionDefault : null,
    })),
}]
const planColumnRows = [
  ['plan_id','TEXT',1,1], ['owner_type','TEXT',1,0], ['owner_id','TEXT',1,0],
  ['current_version','INTEGER',1,0], ['status','TEXT',1,0], ['visibility','TEXT',1,0],
  ['version','INTEGER',1,0], ['created_at','TEXT',1,0], ['updated_at','TEXT',1,0],
]
const planVersionColumnRows = [
  ['plan_id','TEXT',1,1], ['plan_version','INTEGER',1,2], ['name','TEXT',1,0],
  ['tier','TEXT',1,0], ['billing_interval','TEXT',1,0], ['price_minor','INTEGER',1,0],
  ['currency','TEXT',1,0], ['benefits_json','TEXT',1,0], ['created_at','TEXT',1,0],
]
const schemaRows = (rows) => [{ results: rows.map(([name,type,notnull,pk],cid) => ({ cid,name,type,notnull,pk,dflt_value:null })) }]
const planIndexNames = [
  'ix_membership_plans_owner_status_updated',
  'ix_membership_plans_status_visibility_updated',
]
const planVersionIndexNames = ['ix_membership_plan_versions_created']
const planTriggerNames = [
  'membership_plan_versions_immutable_update',
  'membership_plan_versions_immutable_delete',
  'membership_plans_owner_immutable_update',
  'membership_plans_current_version_forward_only',
]
const nameRows = (names) => [{ results: names.map((name,seq) => ({ name,seq })) }]
const preflightInput = (withVersion = false, versionDefault = '1', withPlans = false) => ({
  databaseList: preflightDatabaseList,
  migrationState: [{ results: [
    { name: '0001_membership_subscriptions.sql' },
    ...(withVersion ? [{ name: '0002_subscription_version_cas.sql' }] : []),
    ...(withPlans ? [{ name: '0003_membership_plans.sql' }] : []),
  ] }],
  subscriptionSchema: preflightSchema(withVersion,versionDefault),
  subscriptionIndexes: preflightIndexes,
  subscriptionForeignKeys: [],
  planSchema: withPlans ? schemaRows(planColumnRows) : [{ results: [] }],
  planVersionSchema: withPlans ? schemaRows(planVersionColumnRows) : [{ results: [] }],
  planIndexes: withPlans ? nameRows(planIndexNames) : [{ results: [] }],
  planVersionIndexes: withPlans ? nameRows(planVersionIndexNames) : [{ results: [] }],
  planTriggers: withPlans ? nameRows(planTriggerNames) : [{ results: [] }],
})

describe('read-only D1 subscription migration postflight', () => {
  it('passes only when all three migrations, exact table shapes, indexes, triggers and integrity checks are verified', () => {
    const result = verifyD1SubscriptionPostflight({
      ...preflightInput(true, '1', true),
      versionIntegrity: [{ results: [{ invalid_versions: 0 }] }],
      planIntegrity: [{ results: [{ invalid_current_plan_versions: 0 }] }],
    })
    expect(result.migrationAction).toBe('skip')
    expect(result.invalidVersions).toBe(0)
    expect(result.invalidCurrentPlanVersions).toBe(0)
    expect(result.postflight).toBe('PASS')
    expect(result.appliedMigrations).toEqual([
      '0001_membership_subscriptions.sql',
      '0002_subscription_version_cas.sql',
      '0003_membership_plans.sql',
    ])
  })

  it('fails closed when any existing subscription has an invalid version', () => {
    expect(() => verifyD1SubscriptionPostflight({
      ...preflightInput(true, '1', true),
      versionIntegrity: [{ results: [{ invalid_versions: 1 }] }],
      planIntegrity: [{ results: [{ invalid_current_plan_versions: 0 }] }],
    })).toThrow('existing subscription versions include invalid or non-positive values')
  })

  it('fails closed when any plan points to a missing immutable current version', () => {
    expect(() => verifyD1SubscriptionPostflight({
      ...preflightInput(true, '1', true),
      versionIntegrity: [{ results: [{ invalid_versions: 0 }] }],
      planIntegrity: [{ results: [{ invalid_current_plan_versions: 1 }] }],
    })).toThrow('membership plans include a missing or invalid current immutable version')
  })

  it('fails closed when the pre-migration state remains after the apply step', () => {
    expect(() => verifyD1SubscriptionPostflight({
      ...preflightInput(true, '1', false),
      versionIntegrity: [{ results: [{ invalid_versions: 0 }] }],
      planIntegrity: [{ results: [{ invalid_current_plan_versions: 0 }] }],
    })).toThrow('post-migration verification requires migrations 0001, 0002, and 0003')
  })

  it('fails closed when either integrity query does not return exactly one count', () => {
    expect(() => verifyD1SubscriptionPostflight({
      ...preflightInput(true, '1', true),
      versionIntegrity: [{ results: [] }],
      planIntegrity: [{ results: [{ invalid_current_plan_versions: 0 }] }],
    })).toThrow('version integrity query did not return exactly one count')
    expect(() => verifyD1SubscriptionPostflight({
      ...preflightInput(true, '1', true),
      versionIntegrity: [{ results: [{ invalid_versions: 0 }] }],
      planIntegrity: [{ results: [] }],
    })).toThrow('membership plan integrity query did not return exactly one count')
  })
})

describe('read-only D1 subscription migration preflight', () => {
  it('requests migration for the exact legacy schema with only migration 0001 applied', () => {
    const result = verifyD1SubscriptionPreflight(preflightInput())
    expect(result.migrationAction).toBe('apply')
    expect(result.appliedMigrations).toEqual(['0001_membership_subscriptions.sql'])
    expect(result.columns.map((column) => column[0])).not.toContain('version')
  })

  it('requests migration 0003 when subscription migration 0002 is already present but plan tables are absent', () => {
    const result = verifyD1SubscriptionPreflight(preflightInput(true))
    expect(result.migrationAction).toBe('apply')
    expect(result.appliedMigrations).toEqual(['0001_membership_subscriptions.sql','0002_subscription_version_cas.sql'])
    expect(result.planColumns).toEqual([])
  })

  it('skips all migrations only when migration 0003 and exact plan schema are present', () => {
    const result = verifyD1SubscriptionPreflight(preflightInput(true, '1', true))
    expect(result.migrationAction).toBe('skip')
    expect(result.appliedMigrations).toEqual([
      '0001_membership_subscriptions.sql',
      '0002_subscription_version_cas.sql',
      '0003_membership_plans.sql',
    ])
    expect(result.columns.at(-1)).toEqual(['version','INTEGER',1,0])
    expect(result.planColumns).toEqual(planColumnRows)
    expect(result.planVersionColumns).toEqual(planVersionColumnRows)
    expect(result.planTriggers).toEqual(planTriggerNames)
  })

  it('fails closed when the target D1 UUID does not match', () => {
    expect(() => verifyD1SubscriptionPreflight({
      ...preflightInput(),
      databaseList: [{ name: 'luckread', uuid: 'wrong-database-id' }],
    })).toThrow('exact D1-01 database name/UUID was not found')
  })

  it('fails closed on unexpected migration/schema combinations', () => {
    expect(() => verifyD1SubscriptionPreflight({
      ...preflightInput(true),
      migrationState: [{ results: [{ name: '0001_membership_subscriptions.sql' }] }],
    })).toThrow('migration history and physical Subscription/MembershipPlan schemas do not match')
  })

  it('fails closed when the version default or expected subscription index is wrong', () => {
    expect(() => verifyD1SubscriptionPreflight(preflightInput(true, '0'))).toThrow(
      'version column does not satisfy INTEGER NOT NULL DEFAULT 1',
    )
    expect(() => verifyD1SubscriptionPreflight({
      ...preflightInput(),
      subscriptionIndexes: [{ results: [{ seq: 0, name: 'only_some_index' }] }],
    })).toThrow('missing expected index')
  })

  it('fails closed when migration 0003 is recorded but any plan table, index, or immutable trigger is missing', () => {
    const state = preflightInput(true, '1', true)
    expect(() => verifyD1SubscriptionPreflight({
      ...state,
      planTriggers: [{ results: planTriggerNames.slice(0,3).map((name,seq) => ({ name,seq })) }],
    })).toThrow('migration history and physical Subscription/MembershipPlan schemas do not match')
    expect(() => verifyD1SubscriptionPreflight({
      ...state,
      planVersionSchema: [{ results: [] }],
    })).toThrow('migration history and physical Subscription/MembershipPlan schemas do not match')
    expect(() => verifyD1SubscriptionPreflight({
      ...state,
      planIndexes: [{ results: [{ seq: 0, name: 'unexpected_index' }] }],
    })).toThrow('migration history and physical Subscription/MembershipPlan schemas do not match')
  })
})

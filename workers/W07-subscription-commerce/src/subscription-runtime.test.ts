import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { changeSubscriptionPlan, createSubscription, etagForVersion, getSubscription, listActiveMembershipPlans, listSubscriptions, parseBoundedPositiveInt, transitionSubscription, type SubscriptionRow, type SubscriptionStatus } from './subscription-runtime.js'
import w07 from './index.js'
import { verifyD1SubscriptionPostflight, verifyD1SubscriptionPreflight } from '../scripts/verify-remote-preflight.mjs'

type Statement = { bind: (...values: unknown[]) => Statement; first: <T>() => Promise<T | null>; all: <T>() => Promise<{ results: T[] }>; run: () => Promise<{ meta: { changes: number } }> }
type MembershipPlanRow = { plan_id: string; owner_type: 'CREATOR' | 'COMMUNITY' | 'PLATFORM'; owner_id: string; current_version: number; status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED'; visibility: 'PRIVATE' | 'PUBLIC'; has_current_version: boolean; created_at: string; updated_at: string; name: string; tier: string; billing_interval: string; price_minor: number; currency: string; benefits_json: string }

function fakeDb(rows: SubscriptionRow[], plans: MembershipPlanRow[] = []): D1Database {
  const state = new Map(rows.map((row) => [row.subscription_id, { ...row }]))
  const planState = new Map(plans.map((plan) => [plan.plan_id, { ...plan }]))
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
          const row = state.get(String(values[0]))
          return row ? { ...row } as T : null
        },
        async all<T>() {
          if (sql.includes('FROM membership_plans AS p')) {
            const hasCursor = sql.includes('p.created_at < ?')
            const limit = Number(values[values.length - 1])
            const cursorCreatedAt = hasCursor ? String(values[0]) : null
            const cursorPlanId = hasCursor ? String(values[2]) : null
            const results = Array.from(planState.values())
              .filter((plan) => plan.owner_type === 'CREATOR' && plan.status === 'ACTIVE' && plan.visibility === 'PUBLIC' && plan.has_current_version)
              .filter((plan) => !hasCursor || plan.created_at < cursorCreatedAt! || (plan.created_at === cursorCreatedAt && plan.plan_id < cursorPlanId!))
              .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.plan_id.localeCompare(left.plan_id))
              .slice(0, limit)
              .map((plan) => ({ ...plan, plan_version: plan.current_version }))
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
          if (sql.includes('INSERT INTO membership_subscriptions')) {
            const plan = planState.get(String(values[7]))
            if (!plan || plan.owner_type !== 'CREATOR' || plan.status !== 'ACTIVE' || plan.visibility !== 'PUBLIC') return { meta: { changes: 0 } }
            const row: SubscriptionRow = {
              subscription_id: String(values[0]), subscriber_id: String(values[1]), plan_id: plan.plan_id,
              plan_version: plan.current_version, creator_id: plan.owner_id, status: 'PENDING',
              started_at: String(values[2]), current_period_start: String(values[3]), current_period_end: String(values[4]),
              cancel_at: null, entitlement_snapshot_ref: null, created_at: String(values[5]), updated_at: String(values[6]), version: 1,
            }
            if (state.has(row.subscription_id)) throw new Error('UNIQUE constraint failed')
            state.set(row.subscription_id, row)
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
  } as unknown as D1Database
}

const activePlan = (planId = 'plan_basic', overrides: Partial<MembershipPlanRow> = {}): MembershipPlanRow => ({
  plan_id: planId, owner_type: 'CREATOR', owner_id: 'creator_1', current_version: 3, status: 'ACTIVE', visibility: 'PUBLIC',
  has_current_version: true, created_at: '2026-10-02T12:00:00.000Z', updated_at: '2026-10-02T12:00:00.000Z',
  name: 'Creator Basic', tier: 'basic', billing_interval: 'MONTHLY', price_minor: 500, currency: 'USD', benefits_json: '["member-posts"]',
  ...overrides,
})

const baseRow = (overrides: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  subscription_id: 'sub_existing', subscriber_id: 'user_1', plan_id: 'plan_basic', plan_version: 1, creator_id: null, status: 'ACTIVE',
  started_at: '2026-10-02T12:00:00.000Z', current_period_start: '2026-10-02T12:00:00.000Z', current_period_end: '2026-11-01T12:00:00.000Z',
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
  it('fails closed on W07 POST before routing or subscription writes', () => {
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const guard = index.indexOf("if (request.method === 'POST')")
    const routeResolution = index.indexOf('const operation = toOperation')
    expect(guard).toBeGreaterThan(index.indexOf('requireLayer(request)'))
    expect(guard).toBeLessThan(routeResolution)
    expect(index).toContain("'SERVICE_UNAVAILABLE'")
    expect(index).toContain('verified payment-provider synchronization is available')
    expect(index).not.toContain('createSubscription(')
    expect(index).not.toContain('transitionSubscription(')
    expect(index).not.toContain('changeSubscriptionPlan(')
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
  it('creates an idempotent pending subscription from the current authoritative plan version', async () => {
    const db = fakeDb([], [activePlan('plan_basic', { current_version: 3, owner_id: 'creator_1' })]); const first = await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' });
    const second = await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' });
    expect(first.subscriptionId).toBe(second.subscriptionId); expect(first.status).toBe('PENDING'); expect(first.planVersion).toBe(3); expect(first.creatorId).toBe('creator_1'); expect(first.version).toBe(1); expect(first.etag).toBe(etagForVersion(1))
  })
  it('fails closed for missing, inactive, private, or non-creator plans', async () => {
    const cases: MembershipPlanRow[][] = [
      [],
      [activePlan('plan_basic', { status: 'DRAFT' })],
      [activePlan('plan_basic', { visibility: 'PRIVATE' })],
      [activePlan('plan_basic', { owner_type: 'COMMUNITY' })],
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
  it('changes plan only to an active authoritative version and updates the creator reference', async () => {
    const db = fakeDb([baseRow({ creator_id: 'creator_1' })], [activePlan('plan_pro', { current_version: 7, owner_id: 'creator_1' })]); const before = await getSubscription(db, 'user_1', 'sub_existing'); const after = await changeSubscriptionPlan(db, 'user_1', 'sub_existing', 'plan_pro', before.etag)
    expect(after.planId).toBe('plan_pro'); expect(after.planVersion).toBe(7); expect(after.creatorId).toBe('creator_pro'); expect(after.status).toBe('ACTIVE'); expect(after.version).toBe(before.version + 1); expect(after.etag).toBe(etagForVersion(2))
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

  it('rejects malformed membership plan cursors', async () => {
    await expect(listActiveMembershipPlans(fakeDb([], [activePlan()]), 20, 'not-a-valid-cursor'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
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
    expect(workflow).toContain('SELECT name FROM d1_migrations')
    expect(workflow).toContain('PRAGMA table_info("membership_subscriptions")')
    expect(workflow).toContain('PRAGMA foreign_key_list("membership_subscriptions")')
    expect(workflow).toContain('node scripts/verify-remote-preflight.mjs preflight')
    expect(workflow).toContain('node scripts/verify-remote-preflight.mjs postflight')
    expect(workflow).toContain('SELECT COUNT(*) AS invalid_versions')
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
const preflightInput = (withVersion = false, versionDefault = '1') => ({
  databaseList: preflightDatabaseList,
  migrationState: [{ results: withVersion
    ? [{ name: '0001_membership_subscriptions' }, { name: '0002_subscription_version_cas' }]
    : [{ name: '0001_membership_subscriptions' }] }],
  subscriptionSchema: preflightSchema(withVersion,versionDefault),
  subscriptionIndexes: preflightIndexes,
})

describe('read-only D1 subscription migration postflight', () => {
  it('passes only when migration 0002, the exact current schema, and version integrity are verified', () => {
    const result = verifyD1SubscriptionPostflight({
      ...preflightInput(true),
      versionIntegrity: [{ results: [{ invalid_versions: 0 }] }],
    })
    expect(result.migrationAction).toBe('skip')
    expect(result.invalidVersions).toBe(0)
    expect(result.postflight).toBe('PASS')
    expect(result.appliedMigrations).toEqual(['0001_membership_subscriptions', '0002_subscription_version_cas'])
  })

  it('fails closed when any existing subscription has an invalid version', () => {
    expect(() => verifyD1SubscriptionPostflight({
      ...preflightInput(true),
      versionIntegrity: [{ results: [{ invalid_versions: 1 }] }],
    })).toThrow('existing subscription versions include invalid or non-positive values')
  })

  it('fails closed when migration 0002 is not applied after the migration step', () => {
    expect(() => verifyD1SubscriptionPostflight({
      ...preflightInput(),
      versionIntegrity: [{ results: [{ invalid_versions: 0 }] }],
    })).toThrow('post-migration verification requires 0001 and 0002 with the exact current schema')
  })

  it('fails closed when the version integrity query has no single result', () => {
    expect(() => verifyD1SubscriptionPostflight({
      ...preflightInput(true),
      versionIntegrity: [{ results: [] }],
    })).toThrow('version integrity query did not return exactly one count')
  })
})

describe('read-only D1 subscription migration preflight', () => {
  it('requests migration only for the exact legacy schema with migration 0001 applied', () => {
    const result = verifyD1SubscriptionPreflight(preflightInput())
    expect(result.migrationAction).toBe('apply')
    expect(result.appliedMigrations).toEqual(['0001_membership_subscriptions'])
    expect(result.columns.map((column) => column[0])).not.toContain('version')
  })

  it('skips migration when migration 0002 and the exact version schema are already present', () => {
    const result = verifyD1SubscriptionPreflight(preflightInput(true))
    expect(result.migrationAction).toBe('skip')
    expect(result.appliedMigrations).toEqual(['0001_membership_subscriptions','0002_subscription_version_cas'])
    expect(result.columns.at(-1)).toEqual(['version','INTEGER',1,0])
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
      migrationState: [{ results: [{ name: '0001_membership_subscriptions' }] }],
    })).toThrow('migration history and physical Subscription schema do not match')
  })

  it('fails closed when the version default or expected indexes are missing', () => {
    expect(() => verifyD1SubscriptionPreflight(preflightInput(true, '0'))).toThrow(
      'version column does not satisfy INTEGER NOT NULL DEFAULT 1',
    )
    expect(() => verifyD1SubscriptionPreflight({
      ...preflightInput(),
      subscriptionIndexes: [{ results: [{ seq: 0, name: 'only_some_index' }] }],
    })).toThrow('missing expected index')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { getW07RenewalCycleStore, type RenewalCycleRow, type RenewalCursorRow } from './renewal-cycle-postgres.js'
import { runRenewalScheduledBatch, type RenewalScheduledDependencies } from './renewal-scheduler.js'
import {
  createRenewalPaymentAttempt,
  processSubscriptionRenewalCycle,
  renewalCycleIdFor,
  scanDueSubscriptionRenewals,
  type RenewalRuntimeEnv,
  type RenewalProcessResult,
  type RenewalScanResult,
} from './renewal-runtime.js'
import type { PaymentAttemptCreation } from './payment-persistence.js'

const CYCLE_START = '2026-10-28T00:00:00.000Z'
const CYCLE_END = '2026-11-28T00:00:00.000Z'
const SCAN_NOW = '2026-10-28T12:00:00.000Z'
const CYCLE_ID = 'rcy_' + 'a'.repeat(26)

const testEnv: RenewalRuntimeEnv = {
  W07_DATABASE_DRIVER: 'neon',
  W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
  HYPERDRIVE_D1_04: { connectionString: 'postgresql://test.invalid/luckread' },
  HYPERSWITCH_ENVIRONMENT: 'sandbox',
  HYPERSWITCH_API_KEY: 'test-api-key',
  HYPERSWITCH_MERCHANT_ID: 'merchant_test',
}

function makeCycle(overrides: Partial<RenewalCycleRow> = {}): RenewalCycleRow {
  return {
    cycle_id: CYCLE_ID,
    provider: 'hyperswitch',
    merchant_id: 'merchant_test',
    subscription_id: 'sub_creator_monthly',
    subscriber_id: 'user_1',
    plan_id: 'plan_' + 'b'.repeat(64),
    plan_version: 1,
    cycle_start: CYCLE_START,
    cycle_end: CYCLE_END,
    billing_interval: 'MONTHLY',
    currency: 'USD',
    offer_snapshot_json: JSON.stringify({
      subscriptionId: 'sub_creator_monthly',
      subscriberId: 'user_1',
      creatorId: 'creator_1',
      planId: 'plan_' + 'b'.repeat(64),
      planVersion: 1,
      name: 'Creator Plus',
      tier: 'plus',
      billingInterval: 'MONTHLY',
      priceMinor: 1000,
      currency: 'USD',
      benefits: ['member-posts'],
    }),
    amount_minor: null,
    pricing_snapshot_json: null,
    payment_method_id: null,
    mandate_record_id: null,
    order_id: null,
    payment_id: null,
    state: 'AWAITING_PRICING',
    subscription_sync_state: 'PENDING',
    subscription_sync_updated_at: null,
    subscription_sync_error_code: null,
    attempt_number: 0,
    provider_response_status: null,
    outcome_code: null,
    lease_token: null,
    lease_expires_at: null,
    version: 1,
    created_at: CYCLE_START,
    updated_at: CYCLE_START,
    ...overrides,
  }
}

function makeCursor(overrides: Partial<RenewalCursorRow> = {}): RenewalCursorRow {
  return {
    state_id: 'subscription-renewals',
    cursor_period_end: null,
    cursor_subscription_id: null,
    version: 1,
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

class MemoryRenewalCyclePool implements W07WebhookPostgresPool {
  cursor: RenewalCursorRow | null = makeCursor()
  readonly cycles = new Map<string, RenewalCycleRow>()

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    if (sql.includes('FROM subscription_renewal_scheduler_state')) {
      const rows = this.cursor ? [structuredClone(this.cursor)] : []
      return { rows: rows as unknown as Row[], rowCount: rows.length }
    }

    if (sql.startsWith('UPDATE subscription_renewal_scheduler_state')) {
      if (!this.cursor) return { rows: [], rowCount: 0 }
      const [periodEnd, subscriptionId, updatedAt, expectedVersion] =
        values as [string | null, string | null, string, number]
      if (this.cursor.version !== expectedVersion) return { rows: [], rowCount: 0 }
      this.cursor = {
        ...this.cursor,
        cursor_period_end: periodEnd,
        cursor_subscription_id: subscriptionId,
        updated_at: updatedAt,
        version: this.cursor.version + 1,
      }
      return {
        rows: [{ state_id: 'subscription-renewals' } as unknown as Row],
        rowCount: 1,
      }
    }

    if (sql.startsWith('INSERT INTO subscription_renewal_cycles')) {
      const [
        cycleId, merchantId, subscriptionId, subscriberId, planId, planVersion,
        cycleStart, cycleEnd, billingInterval, currency, offerSnapshot, now,
      ] = values as [string, string, string, string, string, number, string, string, string, string, string, string, string]
      const key = subscriptionId + '|' + cycleStart
      if (this.cycles.has(key)) return { rows: [], rowCount: 0 }
      const row = makeCycle({
        cycle_id: cycleId,
        merchant_id: merchantId,
        subscription_id: subscriptionId,
        subscriber_id: subscriberId,
        plan_id: planId,
        plan_version: planVersion,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        billing_interval: billingInterval as 'MONTHLY' | 'YEARLY',
        currency,
        offer_snapshot_json: offerSnapshot,
        state: 'AWAITING_PRICING',
        created_at: now,
        updated_at: now,
      })
      this.cycles.set(key, row)
      return {
        rows: [{ cycle_id: cycleId } as unknown as Row],
        rowCount: 1,
      }
    }

    if (sql.includes('FROM subscription_renewal_cycles') && sql.includes('subscription_id = $1')) {
      const [subscriptionId, cycleStart] = values as [string, string]
      const row = this.cycles.get(subscriptionId + '|' + cycleStart)
      const rows = row ? [structuredClone(row)] : []
      return { rows: rows as unknown as Row[], rowCount: rows.length }
    }

    if (sql.includes('FROM subscription_renewal_cycles') && sql.includes('cycle_id = $1')) {
      const cycleId = String(values[0])
      const row = [...this.cycles.values()].find((candidate) => candidate.cycle_id === cycleId) ?? null
      const rows = row ? [structuredClone(row)] : []
      return { rows: rows as unknown as Row[], rowCount: rows.length }
    }

    throw new Error('Unexpected renewal-cycle PostgreSQL query: ' + sql)
  }

  async connect() {
    throw new Error('This renewal-cycle test fixture does not open transactions')
  }
}

type ScanSubscription = {
  subscription_id: string
  subscriber_id: string
  plan_id: string
  plan_version: number
  creator_id: string | null
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE'
  current_period_start: string
  current_period_end: string
  trial_started_at: string | null
  trial_ends_at: string | null
  cancel_at: string | null
  billing_interval: 'MONTHLY' | 'YEARLY'
  price_minor: number
  currency: string
  name: string
  tier: string
  benefits_json: string
}

function makeScanSubscription(overrides: Partial<ScanSubscription> = {}): ScanSubscription {
  return {
    subscription_id: 'sub_due_monthly',
    subscriber_id: 'user_due',
    plan_id: 'plan_due',
    plan_version: 1,
    creator_id: 'creator_due',
    status: 'ACTIVE',
    current_period_start: '2026-09-28T11:00:00.000Z',
    current_period_end: '2026-10-28T11:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    cancel_at: null,
    billing_interval: 'MONTHLY',
    price_minor: 1200,
    currency: 'USD',
    name: 'Creator Plus',
    tier: 'plus',
    benefits_json: JSON.stringify(['member-posts']),
    ...overrides,
  }
}

function makeMembershipPool(options: {
  subscriptions?: ScanSubscription[]
  failScan?: boolean
} = {}) {
  let scanCalls = 0
  const subscriptions = options.subscriptions ?? []
  const pool: W07WebhookPostgresPool = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values: unknown[] = [],
    ) {
      if (sql.includes('FROM membership_subscription_scheduled_plan_changes')) {
        return { rows: [] as Row[], rowCount: 0 }
      }
      if (!sql.includes('FROM membership_subscriptions s')) {
        throw new Error('Unexpected membership PostgreSQL query: ' + sql)
      }
      scanCalls += 1
      if (options.failScan) throw new Error('simulated membership PostgreSQL scan failure')
      const [now, cursorPeriod, cursorSubscription, limit] =
        values as [string, string | null, string | null, number]
      const rows = subscriptions
        .filter((row) => row.current_period_end <= now)
        .filter((row) => row.cancel_at === null || row.cancel_at > row.current_period_end)
        .filter((row) => cursorPeriod === null ||
          row.current_period_end > cursorPeriod ||
          (row.current_period_end === cursorPeriod && row.subscription_id > String(cursorSubscription)))
        .sort((a, b) => a.current_period_end.localeCompare(b.current_period_end) ||
          a.subscription_id.localeCompare(b.subscription_id))
        .slice(0, limit)
      return { rows: structuredClone(rows) as unknown as Row[], rowCount: rows.length }
    },
    async connect() {
      throw new Error('Membership reads do not open transactions')
    },
  }
  return { pool, get scanCalls() { return scanCalls } }
}

function scannerSetup(options: {
  subscriptions?: ScanSubscription[]
  missingCursor?: boolean
  failSubscriptionScan?: boolean
} = {}) {
  const cycleStore = new MemoryRenewalCyclePool()
  if (options.missingCursor) cycleStore.cursor = null
  const membershipFixture = makeMembershipPool({
    subscriptions: options.subscriptions,
    failScan: options.failSubscriptionScan,
  })
  const env: RenewalRuntimeEnv = {
    W07_DATABASE_DRIVER: 'neon',
    W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
    HYPERSWITCH_ENVIRONMENT: 'sandbox',
    HYPERSWITCH_API_KEY: 'test-api-key',
    HYPERSWITCH_MERCHANT_ID: 'merchant_test',
  }
  const dependencies = {
    now: () => new Date(SCAN_NOW),
    getRenewalCycleStore: () => cycleStore,
    getMembershipPostgresPool: () => membershipFixture.pool,
    resolvePricing: async () => { throw new Error('scan must not invoke pricing') },
  }
  return { env, cycleStore, membershipFixture, dependencies }
}

describe('renewal payment-attempt persistence selection', () => {
  const created: PaymentAttemptCreation = {
    payment: {
      paymentId: 'pay_' + 'a'.repeat(26),
      orderId: 'ord_renewal_1',
      amountMinor: 1500,
      currency: 'USD',
      status: 'INITIATING',
      version: 1,
      providerUpdatedAt: null,
      createdAt: SCAN_NOW,
      updatedAt: SCAN_NOW,
    },
    replayed: false,
    pricingMode: 'live',
  }

  it('creates renewal Payment attempts through the native Neon finance pool', async () => {
    const financePool = {
      async query() { return { rows: [], rowCount: 0 } },
      async connect() { throw new Error('single attempt creation does not open a transaction') },
    } as unknown as W07WebhookPostgresPool
    const env: RenewalRuntimeEnv = {
      ...testEnv,
      HYPERSWITCH_ENVIRONMENT: 'sandbox',
    }
    const now = () => new Date(SCAN_NOW)
    const createPostgres = vi.fn().mockResolvedValue(created)
    const getFinancePostgresPool = vi.fn(() => financePool)

    const result = await createRenewalPaymentAttempt(
      env,
      'user_1',
      'ord_renewal_1',
      'renew_cycle_1',
      'merchant_test',
      { now, getFinancePostgresPool, createPaymentAttemptPostgres: createPostgres },
    )

    expect(result).toBe(created)
    expect(getFinancePostgresPool).toHaveBeenCalledWith(env)
    expect(createPostgres).toHaveBeenCalledWith(
      financePool,
      'user_1',
      'ord_renewal_1',
      'renew_cycle_1',
      'merchant_test',
      { now, paymentEnvironment: 'sandbox' },
    )
  })

  it('fails closed when the Neon finance pool is unavailable', async () => {
    await expect(createRenewalPaymentAttempt(
      testEnv,
      'user_1',
      'ord_renewal_1',
      'renew_cycle_1',
      'merchant_test',
      { getFinancePostgresPool: () => undefined },
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('rejects an explicit D1 selector for renewal Payment attempts and cycle state', () => {
    const legacyEnv = { W07_DATABASE_DRIVER: 'd1' }
    expect(() => getW07RenewalCycleStore(legacyEnv)).toThrow('W07_RENEWAL_CYCLE_STORE_UNAVAILABLE')
  })
})

describe('renewal cycle runtime', () => {
  it('requires the native Neon order-create Store for a prepared renewal without an order', async () => {
    const cycle = makeCycle({ state: 'PREPARED', amount_minor: 1000, pricing_snapshot_json: '{}',
      payment_method_id: 'pm_' + 'c'.repeat(26), mandate_record_id: 'mandate_1' })
    const cycleStore = new MemoryRenewalCyclePool()
    cycleStore.cycles.set(cycle.subscription_id + '|' + cycle.cycle_start, cycle)
    const membershipPool = makeMembershipPool().pool
    const getOrderCreateStore = vi.fn(() => undefined)
    const createOrder = vi.fn()

    await expect(processSubscriptionRenewalCycle(testEnv, cycle.cycle_id, {
      getRenewalCycleStore: () => cycleStore,
      getOrderCreateStore,
      getMembershipPostgresPool: () => membershipPool,
      createOrder,
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    expect(getOrderCreateStore).toHaveBeenCalledOnce()
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('waits for an admitted pricing decision and never calls the provider when pricing is missing', async () => {
    const cycle = makeCycle()
    const cycleStore = new MemoryRenewalCyclePool()
    cycleStore.cycles.set(cycle.subscription_id + '|' + cycle.cycle_start, cycle)
    let providerCalled = false
    const result = await processSubscriptionRenewalCycle(testEnv, cycle.cycle_id, {
      getRenewalCycleStore: () => cycleStore,
      getOrderCreateStore: () => undefined,
      getMembershipPostgresPool: () => makeMembershipPool().pool,
      createProviderCharge: async () => {
        providerCalled = true
        throw new Error('provider must not be called without admitted pricing')
      },
    })
    expect(result).toMatchObject({ state: 'AWAITING_PRICING', action: 'AWAITING_PRICING' })
    expect(providerCalled).toBe(false)
  })

  it('uses a stable cycle id for a subscription and one exact billing period', async () => {
    const first = await renewalCycleIdFor('sub_creator_monthly', CYCLE_START, CYCLE_END)
    const replay = await renewalCycleIdFor('sub_creator_monthly', CYCLE_START, CYCLE_END)
    const next = await renewalCycleIdFor('sub_creator_monthly', CYCLE_END, '2026-12-28T00:00:00.000Z')

    expect(first).toMatch(/^rcy_[a-f0-9]{26}$/)
    expect(first).toBe('rcy_bbae99b2fa87f365e01ecf0dae')
    expect(replay).toBe(first)
    expect(next).not.toBe(first)
    await expect(renewalCycleIdFor('', CYCLE_START, CYCLE_END)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(renewalCycleIdFor('sub_creator_monthly', CYCLE_END, CYCLE_START)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

describe('due subscription renewal scan', () => {
  it('selects only due, uncancelled subscriptions and persists one stable cycle with a CAS cursor', async () => {
    const due = makeScanSubscription()
    const future = makeScanSubscription({
      subscription_id: 'sub_future',
      current_period_end: '2026-10-29T11:00:00.000Z',
      current_period_start: '2026-09-29T11:00:00.000Z',
    })
    const canceledAtPeriodEnd = makeScanSubscription({
      subscription_id: 'sub_cancelled',
      cancel_at: '2026-10-28T11:00:00.000Z',
    })
    const f = scannerSetup({ subscriptions: [future, canceledAtPeriodEnd, due] })

    const result = await scanDueSubscriptionRenewals(f.env, { limit: 2 }, f.dependencies)
    const expectedCycle = await renewalCycleIdFor(
      due.subscription_id, due.current_period_end, '2026-11-28T11:00:00.000Z',
    )

    expect(result).toEqual({
      scanned: 1,
      cycleIds: [expectedCycle],
      cursorAdvanced: true,
      cursorReset: false,
    })
    expect(f.cycleStore.cycles.size).toBe(1)
    expect(f.cycleStore.cursor).toMatchObject({
      cursor_period_end: due.current_period_end,
      cursor_subscription_id: due.subscription_id,
      version: 2,
    })
  })

  it('resets an exhausted cursor and reuses the same cycle instead of duplicating a billing cycle', async () => {
    const due = makeScanSubscription()
    const f = scannerSetup({ subscriptions: [due] })

    const first = await scanDueSubscriptionRenewals(f.env, {}, f.dependencies)
    const exhausted = await scanDueSubscriptionRenewals(f.env, {}, f.dependencies)
    const replay = await scanDueSubscriptionRenewals(f.env, {}, f.dependencies)

    expect(first.cycleIds).toHaveLength(1)
    expect(exhausted).toMatchObject({ scanned: 0, cycleIds: [], cursorAdvanced: false, cursorReset: true })
    expect(replay.cycleIds).toEqual(first.cycleIds)
    expect(f.cycleStore.cycles.size).toBe(1)
  })

  it('fails closed when the scheduler cursor is not initialized', async () => {
    const f = scannerSetup({ subscriptions: [makeScanSubscription()], missingCursor: true })
    await expect(scanDueSubscriptionRenewals(f.env, {}, f.dependencies))
      .rejects.toMatchObject({ code: 'SCHEDULER_STATE_NOT_INITIALIZED', status: 503 })
    expect(f.membershipFixture.scanCalls).toBe(0)
  })

  it('fails closed on a Neon membership scan failure without advancing the cursor', async () => {
    const f = scannerSetup({ subscriptions: [makeScanSubscription()], failSubscriptionScan: true })
    await expect(scanDueSubscriptionRenewals(f.env, {}, f.dependencies))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(f.cycleStore.cursor).toMatchObject({
      cursor_period_end: null,
      cursor_subscription_id: null,
      version: 1,
    })
  })
})

describe('W07 scheduled renewal batch', () => {
  const syncResult = { scanned: 0, applied: 0, reconciliationRequired: 0, pendingRetry: 0 }

  function scheduledSetup(missing: string[] = []) {
    const membershipPool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => { throw new Error('unused') },
    } as unknown as W07WebhookPostgresPool
    const financePool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => { throw new Error('unused') },
    } as unknown as W07WebhookPostgresPool
    const cycleStore = new MemoryRenewalCyclePool()
    const env: RenewalRuntimeEnv = { ...testEnv }
    const readFinanceTableNames = vi.fn(async (_pool: W07WebhookPostgresPool, expected: readonly string[]) =>
      new Set(expected.filter((name) => !missing.includes('D1-04.' + name))))
    const readMembershipTableNames = vi.fn(async (_pool: W07WebhookPostgresPool, expected: readonly string[]) =>
      new Set(expected.filter((name) => !missing.includes('D1-01.' + name))))
    const syncPending = vi.fn(async () => syncResult)
    const scanDue = vi.fn(async (): Promise<RenewalScanResult> => ({
      scanned: 2,
      cycleIds: ['rcy_' + 'a'.repeat(26), 'rcy_' + 'b'.repeat(26)],
      cursorAdvanced: true,
      cursorReset: false,
    }))
    const processCycle = vi.fn(async (_env: RenewalRuntimeEnv, cycleId: string): Promise<RenewalProcessResult> => ({
      cycleId,
      state: 'PREPARED',
      action: 'PREPARED',
    }))
    const dependencies: RenewalScheduledDependencies = {
      readFinanceTableNames,
      readMembershipTableNames,
      getMembershipPostgresPool: () => membershipPool,
      getFinancePostgresPool: () => financePool,
      getRenewalCycleStore: () => cycleStore,
      syncPending,
      scanDue,
      processCycle,
    }
    return { env, dependencies, readFinanceTableNames, readMembershipTableNames, syncPending, scanDue, processCycle }
  }

  it('does not access renewal rows until Neon finance and membership schemas are ready', async () => {
    const f = scheduledSetup(['D1-04.subscription_renewal_cycles'])
    const result = await runRenewalScheduledBatch(f.env, f.dependencies)
    expect(result).toMatchObject({
      status: 'SCHEMA_NOT_READY',
      reason: 'REQUIRED_TABLES_MISSING',
      missingTables: ['D1-04.subscription_renewal_cycles'],
    })
    expect(f.syncPending).not.toHaveBeenCalled()
    expect(f.scanDue).not.toHaveBeenCalled()
    expect(f.processCycle).not.toHaveBeenCalled()
  })

  it('reconciles outcomes before and after a bounded due scan', async () => {
    const f = scheduledSetup()
    const result = await runRenewalScheduledBatch(f.env, f.dependencies)
    expect(result).toMatchObject({ status: 'COMPLETED', processed: 2, processFailures: 0 })
    expect(f.syncPending).toHaveBeenCalledTimes(2)
    expect(f.scanDue).toHaveBeenCalledWith(
      f.env,
      { limit: 5 },
      { getRenewalCycleStore: expect.any(Function), getMembershipPostgresPool: expect.any(Function) },
    )
    expect(f.processCycle).toHaveBeenCalledTimes(2)
  })

  it('forwards the admitted pricing and tax resolver to both cycle discovery and execution', async () => {
    const f = scheduledSetup()
    const resolvePricing: NonNullable<RenewalScheduledDependencies['resolvePricing']> = async () => {
      throw new Error('the scheduler must forward the resolver, not invent a pricing decision')
    }

    const result = await runRenewalScheduledBatch(f.env, { ...f.dependencies, resolvePricing })
    expect(result).toMatchObject({ status: 'COMPLETED', processed: 2 })
    expect(f.scanDue).toHaveBeenCalledWith(
      f.env,
      { limit: 5 },
      { resolvePricing, getRenewalCycleStore: expect.any(Function), getMembershipPostgresPool: expect.any(Function) },
    )
    expect(f.processCycle).toHaveBeenNthCalledWith(
      1,
      f.env,
      'rcy_' + 'a'.repeat(26),
      { resolvePricing, getRenewalCycleStore: expect.any(Function), getMembershipPostgresPool: expect.any(Function) },
    )
    expect(f.processCycle).toHaveBeenNthCalledWith(
      2,
      f.env,
      'rcy_' + 'b'.repeat(26),
      { resolvePricing, getRenewalCycleStore: expect.any(Function), getMembershipPostgresPool: expect.any(Function) },
    )
  })

  it('stops before scanning when prior finance-to-membership outcome recovery fails', async () => {
    const f = scheduledSetup()
    f.syncPending.mockRejectedValueOnce(new Error('membership database unavailable'))
    const result = await runRenewalScheduledBatch(f.env, f.dependencies)
    expect(result).toEqual({ status: 'PARTIAL', phase: 'OUTCOME_SYNC_BEFORE' })
    expect(f.scanDue).not.toHaveBeenCalled()
    expect(f.processCycle).not.toHaveBeenCalled()
  })

  it('continues other cycles after one bounded cycle fails and reports a partial tick', async () => {
    const f = scheduledSetup()
    f.processCycle.mockRejectedValueOnce(new Error('provider timeout'))
    const result = await runRenewalScheduledBatch(f.env, f.dependencies)
    expect(result).toMatchObject({ status: 'PARTIAL', processed: 1, processFailures: 1 })
    expect(f.processCycle).toHaveBeenCalledTimes(2)
    expect(f.syncPending).toHaveBeenCalledTimes(2)
  })
})

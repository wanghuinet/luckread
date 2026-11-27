import { beforeEach, describe, expect, it } from 'vitest'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { transitionSubscriptionLifecycle } from './subscription-lifecycle-runtime.js'

type Row = {
  subscription_id: string
  subscriber_id: string
  status: string
  current_period_start: string
  current_period_end: string
  cancel_at: string | null
  pause_started_at: string | null
  pause_period_end_snapshot: string | null
  pause_remaining_seconds: number | null
  version: number
}
type Receipt = {
  request_fingerprint: string
  expected_subscription_version: number
  result_status: string
  response_json: string
}

const NOW = '2026-11-27T12:00:00.000Z'
const PERIOD_END = '2026-12-27T12:00:00.000Z'

class MemoryLifecyclePool implements W07WebhookPostgresPool {
  row: Row = {
    subscription_id: 'sub_lifecycle_1',
    subscriber_id: 'user_1',
    status: 'ACTIVE',
    current_period_start: '2026-11-27T12:00:00.000Z',
    current_period_end: PERIOD_END,
    cancel_at: null,
    pause_started_at: null,
    pause_period_end_snapshot: null,
    pause_remaining_seconds: null,
    version: 7,
  }
  receipts = new Map<string, Receipt>()
  audits: Array<Record<string, unknown>> = []
  scheduledChange: {
    status: 'SCHEDULED' | 'CANCELLED'
    expected_subscription_version: number
    expected_plan_id: string
    expected_plan_version: number
    effective_at: string
    version: number
  } | null = null

  async query<RowType extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: RowType[]; rowCount: number | null }> {
    if (sql.includes('FROM subscription_renewal_cycles')) {
      return { rows: (this.unresolved ? [{ cycle_id: 'cycle_1' }] : []) as unknown as RowType[], rowCount: this.unresolved ? 1 : 0 }
    }
    return this.execute(sql, values) as Promise<{ rows: RowType[]; rowCount: number | null }>
  }

  unresolved = false

  async connect(): Promise<W07WebhookPostgresClient> {
    const pool = this
    let snapshot: { row: Row; receipts: Map<string, Receipt>; audits: Array<Record<string, unknown>>; scheduledChange: MemoryLifecyclePool['scheduledChange'] } | null = null
    return {
      query: async <RowType extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        values: unknown[] = [],
      ) => {
        if (sql === 'BEGIN') {
          snapshot = { row: structuredClone(pool.row), receipts: structuredClone(pool.receipts), audits: structuredClone(pool.audits), scheduledChange: structuredClone(pool.scheduledChange) }
          return { rows: [] as RowType[], rowCount: 0 }
        }
        if (sql === 'COMMIT') {
          snapshot = null
          return { rows: [] as RowType[], rowCount: 0 }
        }
        if (sql === 'ROLLBACK') {
          if (snapshot) {
            pool.row = snapshot.row
            pool.receipts = snapshot.receipts
            pool.audits = snapshot.audits
            pool.scheduledChange = snapshot.scheduledChange
          }
          snapshot = null
          return { rows: [] as RowType[], rowCount: 0 }
        }
        return pool.execute(sql, values) as Promise<{ rows: RowType[]; rowCount: number | null }>
      },
      release: () => undefined,
    }
  }

  private async execute(
    sql: string,
    values: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> {
    if (sql.includes('FROM membership_subscription_lifecycle_operation_receipts')) {
      const key = String(values[0]) + ':' + String(values[1])
      const receipt = this.receipts.get(key)
      return { rows: receipt ? [structuredClone(receipt)] : [], rowCount: receipt ? 1 : 0 }
    }
    if (sql.includes('FROM membership_subscriptions WHERE subscription_id = $1')) {
      const found = this.row.subscription_id === values[0] && this.row.subscriber_id === values[1]
      return { rows: found ? [structuredClone(this.row)] : [], rowCount: found ? 1 : 0 }
    }
    if (sql.startsWith("UPDATE membership_subscription_scheduled_plan_changes SET status = 'CANCELLED'")) {
      const [, subscriptionId, subscriberId] = values
      if (this.scheduledChange && this.row.subscription_id === subscriptionId &&
          this.row.subscriber_id === subscriberId && this.scheduledChange.status === 'SCHEDULED') {
        this.scheduledChange = { ...this.scheduledChange, status: 'CANCELLED', version: this.scheduledChange.version + 1 }
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }
    if (sql.startsWith('UPDATE membership_subscription_scheduled_plan_changes AS c')) {
      const [expectedVersion, effectiveAt, , subscriptionId, subscriberId, priorEffectiveAt] = values
      const change = this.scheduledChange
      if (change && change.status === 'SCHEDULED' && this.row.subscription_id === subscriptionId &&
          this.row.subscriber_id === subscriberId && this.row.version === expectedVersion &&
          change.expected_plan_id === 'plan_current' && change.expected_plan_version === 1 &&
          change.effective_at === priorEffectiveAt) {
        this.scheduledChange = {
          ...change, expected_subscription_version: Number(expectedVersion),
          effective_at: String(effectiveAt), version: change.version + 1,
        }
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }
    if (sql.startsWith('INSERT INTO membership_subscription_lifecycle_operation_receipts')) {
      const [operationId, subscriptionId, subscriberId, operation, idempotencyHash, fingerprint, expectedVersion, resultVersion] = values
      const key = String(subscriberId) + ':' + String(idempotencyHash)
      this.receipts.set(key, {
        request_fingerprint: String(fingerprint),
        expected_subscription_version: Number(expectedVersion),
        result_status: 'PENDING',
        response_json: '{"pending":true}',
      })
      return { rows: [{ operation_id: operationId, subscription_id: subscriptionId, operation, result_subscription_version: resultVersion }], rowCount: 1 }
    }
    if (sql.startsWith('INSERT INTO membership_subscription_lifecycle_audit')) {
      this.audits.push({ sql, values })
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE membership_subscriptions SET status = $1, pause_started_at = $2')) {
      const [status, now, subscriptionId, subscriberId, expectedVersion] = values
      if (this.row.subscription_id !== subscriptionId || this.row.subscriber_id !== subscriberId ||
          this.row.status !== 'ACTIVE' || this.row.cancel_at !== null || this.row.version !== expectedVersion) {
        return { rows: [], rowCount: 0 }
      }
      this.row = {
        ...this.row, status: String(status), pause_started_at: String(now),
        pause_period_end_snapshot: this.row.current_period_end,
        pause_remaining_seconds: Math.max(0, Math.floor((Date.parse(this.row.current_period_end) - Date.parse(String(now))) / 1000)),
        version: this.row.version + 1,
      }
      return { rows: [structuredClone(this.row)], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE membership_subscriptions SET status = $1, updated_at') &&
        sql.includes("status = 'PAUSING'")) {
      const [status, , subscriptionId, subscriberId, expectedVersion] = values
      if (this.row.subscription_id !== subscriptionId || this.row.subscriber_id !== subscriberId ||
          this.row.status !== 'PAUSING' || this.row.version !== expectedVersion) return { rows: [], rowCount: 0 }
      this.row = { ...this.row, status: String(status), version: this.row.version + 1 }
      return { rows: [structuredClone(this.row)], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE membership_subscriptions SET status = $1, pause_started_at = NULL')) {
      const [, now, subscriptionId, subscriberId, expectedStatus, expectedVersion] = values
      if (this.row.subscription_id !== subscriptionId || this.row.subscriber_id !== subscriberId ||
          this.row.status !== expectedStatus || this.row.version !== expectedVersion) return { rows: [], rowCount: 0 }
      this.row = {
        ...this.row, status: 'ACTIVE', pause_started_at: null, pause_period_end_snapshot: null,
        pause_remaining_seconds: null, version: this.row.version + 1,
      }
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE membership_subscriptions SET status = $1, current_period_start')) {
      const [status, start, end, subscriptionId, subscriberId, expectedVersion] = values
      if (this.row.subscription_id !== subscriptionId || this.row.subscriber_id !== subscriberId ||
          this.row.status !== 'PAUSED' || this.row.cancel_at !== null || this.row.version !== expectedVersion) {
        return { rows: [], rowCount: 0 }
      }
      this.row = {
        ...this.row, status: String(status), current_period_start: String(start),
        current_period_end: String(end), pause_started_at: null,
        pause_period_end_snapshot: null, pause_remaining_seconds: null,
        version: this.row.version + 1,
      }
      return { rows: [structuredClone(this.row)], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE membership_subscriptions SET status = $1, cancel_at = current_period_end')) {
      const [status, , subscriptionId, subscriberId, expectedVersion] = values
      if (this.row.subscription_id !== subscriptionId || this.row.subscriber_id !== subscriberId ||
          this.row.status !== 'PAUSED' || this.row.version !== expectedVersion) return { rows: [], rowCount: 0 }
      this.row = {
        ...this.row, status: String(status), cancel_at: this.row.current_period_end,
        pause_started_at: null, pause_period_end_snapshot: null, pause_remaining_seconds: null,
        version: this.row.version + 1,
      }
      return { rows: [structuredClone(this.row)], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE membership_subscriptions SET cancel_at = current_period_end')) {
      const [, subscriptionId, subscriberId, expectedStatus, expectedVersion] = values
      if (this.row.subscription_id !== subscriptionId || this.row.subscriber_id !== subscriberId ||
          this.row.status !== expectedStatus || this.row.version !== expectedVersion) return { rows: [], rowCount: 0 }
      const increment = this.row.cancel_at === null ? 1 : 0
      this.row = { ...this.row, cancel_at: this.row.current_period_end, version: this.row.version + increment }
      return { rows: [structuredClone(this.row)], rowCount: 1 }
    }
    if (sql.includes('UPDATE membership_subscription_lifecycle_operation_receipts') && sql.includes('result_subscription_version')) {
      const [version, status, response] = values
      const entry = [...this.receipts.entries()].find(([, receipt]) => receipt.result_status === 'PENDING')
      if (!entry) return { rows: [], rowCount: 0 }
      this.receipts.set(entry[0], { ...entry[1], result_status: String(status), response_json: String(response) })
      return { rows: [{ result_subscription_version: version }], rowCount: 1 }
    }
    throw new Error('Unhandled test SQL: ' + sql)
  }
}

class MemoryFinancePool implements W07WebhookPostgresPool {
  constructor(private readonly unresolved: boolean) {}
  async query<RowType extends Record<string, unknown> = Record<string, unknown>>(): Promise<{ rows: RowType[]; rowCount: number | null }> {
    return { rows: (this.unresolved ? [{ cycle_id: 'cycle_1' }] : []) as unknown as RowType[], rowCount: this.unresolved ? 1 : 0 }
  }
  async connect(): Promise<W07WebhookPostgresClient> {
    throw new Error('Finance pool transaction is not expected')
  }
}

const call = (
  membership: MemoryLifecyclePool,
  action: 'cancel' | 'pause' | 'resume',
  key: string,
  version: number,
  finance = new MemoryFinancePool(false),
  now = new Date(NOW),
) => transitionSubscriptionLifecycle(membership, finance, {
  action,
  subscriptionId: 'sub_lifecycle_1',
  subscriberId: 'user_1',
  idempotencyKey: key,
  ifMatch: '"lr-v' + version + '"',
  now,
})

describe('W07 subscription lifecycle runtime', () => {
  let membership: MemoryLifecyclePool
  beforeEach(() => { membership = new MemoryLifecyclePool() })

  it('pauses behind a PAUSING chargeability fence and freezes the remaining paid time', async () => {
    const result = await call(membership, 'pause', 'pause-key-1', 7)
    expect(result.status).toBe(200)
    expect(result.data.status).toBe('PAUSED')
    expect(membership.row.pause_remaining_seconds).toBe(2_592_000)
    expect(membership.row.current_period_end).toBe(PERIOD_END)
    expect(membership.audits.map((event) => event.values?.[3])).toEqual(['PAUSE', 'PAUSE'])
  })

  it('does not complete a pause while a provider renewal is in flight and allows safe retry', async () => {
    membership.unresolved = true
    const blocked = await call(membership, 'pause', 'pause-key-2', 7, new MemoryFinancePool(true))
    expect(blocked.status).toBe(409)
    expect(blocked.data.pending).toBe(true)
    expect(membership.row.status).toBe('ACTIVE')
    expect(membership.row.pause_started_at).toBeNull()
    membership.unresolved = false
    const retried = await call(membership, 'pause', 'pause-key-2', 7)
    expect(retried.status).toBe(200)
    expect(retried.data.status).toBe('PAUSED')
  })

  it('resumes by extending the period by the snapshotted remaining seconds', async () => {
    const paused = await call(membership, 'pause', 'pause-key-3', 7)
    const resumed = await call(membership, 'resume', 'resume-key-3', paused.data.version)
    expect(resumed.data.status).toBe('ACTIVE')
    expect(resumed.data.currentPeriodStart).toBe(NOW)
    expect(resumed.data.currentPeriodEnd).toBe(PERIOD_END)
    expect(membership.row.pause_remaining_seconds).toBeNull()
  })

  it('moves a scheduled downgrade to the extended period boundary when a paused subscription resumes', async () => {
    membership.scheduledChange = {
      status: 'SCHEDULED',
      expected_subscription_version: 7,
      expected_plan_id: 'plan_current',
      expected_plan_version: 1,
      effective_at: PERIOD_END,
      version: 1,
    }
    const paused = await call(membership, 'pause', 'pause-with-change', 7)
    const resumed = await call(
      membership, 'resume', 'resume-with-change', paused.data.version,
      new MemoryFinancePool(false), new Date('2026-12-07T12:00:00.000Z'),
    )
    expect(resumed.data.currentPeriodEnd).toBe('2027-01-06T12:00:00.000Z')
    expect(membership.scheduledChange).toMatchObject({
      status: 'SCHEDULED',
      expected_subscription_version: resumed.data.version,
      effective_at: '2027-01-06T12:00:00.000Z',
      version: 2,
    })
  })

  it('retires a scheduled plan change when the subscriber cancels', async () => {
    membership.scheduledChange = {
      status: 'SCHEDULED',
      expected_subscription_version: 7,
      expected_plan_id: 'plan_current',
      expected_plan_version: 1,
      effective_at: PERIOD_END,
      version: 1,
    }
    await call(membership, 'cancel', 'cancel-with-change', 7)
    expect(membership.scheduledChange).toMatchObject({ status: 'CANCELLED', version: 2 })
  })

  it('cancels at period end without removing current-period entitlement', async () => {
    const result = await call(membership, 'cancel', 'cancel-key-1', 7)
    expect(result.status).toBe(200)
    expect(result.data.status).toBe('ACTIVE')
    expect(result.data.cancelAt).toBe(PERIOD_END)
    expect(membership.row.version).toBe(8)
  })

  it('keeps a cancellation receipt pending while an already-submitted renewal reconciles', async () => {
    const pending = await call(membership, 'cancel', 'cancel-inflight', 7, new MemoryFinancePool(true))
    expect(pending.status).toBe(202)
    expect(pending.data.pending).toBe(true)
    expect(membership.row.cancel_at).toBe(PERIOD_END)
    expect([...membership.receipts.values()][0]?.result_status).toBe('PENDING')

    const reconciled = await call(membership, 'cancel', 'cancel-inflight', 7, new MemoryFinancePool(false))
    expect(reconciled.status).toBe(200)
    expect(reconciled.data.pending).toBeUndefined()
    expect([...membership.receipts.values()][0]?.result_status).not.toBe('PENDING')
  })

  it('makes cancellation of a paused subscription terminal and prevents resume', async () => {
    const paused = await call(membership, 'pause', 'pause-key-4', 7)
    const canceled = await call(membership, 'cancel', 'cancel-key-4', paused.data.version)
    expect(canceled.data.status).toBe('CANCELED')
    await expect(call(membership, 'resume', 'resume-key-4', canceled.data.version))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('replays a completed operation without mutating the subscription again', async () => {
    const first = await call(membership, 'cancel', 'cancel-key-replay', 7)
    const replay = await call(membership, 'cancel', 'cancel-key-replay', 7)
    expect(replay.data.replayed).toBe(true)
    expect(replay.data.version).toBe(first.data.version)
    expect(membership.row.version).toBe(8)
  })

  it('rejects reuse of one idempotency key for a different operation', async () => {
    await call(membership, 'cancel', 'shared-key', 7)
    await expect(call(membership, 'pause', 'shared-key', 7))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT', status: 409 })
  })
})

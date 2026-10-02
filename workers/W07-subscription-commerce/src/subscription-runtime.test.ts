import { describe, expect, it } from 'vitest'
import { changeSubscriptionPlan, createSubscription, etagForUpdatedAt, getSubscription, transitionSubscription, type SubscriptionRow, type SubscriptionStatus } from './subscription-runtime.js'

type Statement = { bind: (...values: unknown[]) => Statement; first: <T>() => Promise<T | null>; run: () => Promise<{ meta: { changes: number } }> }

function fakeDb(rows: SubscriptionRow[]): D1Database {
  const state = new Map(rows.map((row) => [row.subscription_id, { ...row }]))
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
        async run() {
          if (sql.includes('INSERT INTO')) {
            const row: SubscriptionRow = {
              subscription_id: String(values[0]), subscriber_id: String(values[1]), plan_id: String(values[2]),
              plan_version: Number(values[3]), creator_id: values[4] as string | null, status: values[5] as SubscriptionStatus,
              started_at: String(values[6]), current_period_start: String(values[7]), current_period_end: String(values[8]),
              cancel_at: values[9] as string | null, entitlement_snapshot_ref: values[10] as string | null,
              created_at: String(values[11]), updated_at: String(values[12]),
            }
            if (state.has(row.subscription_id)) throw new Error('UNIQUE constraint failed')
            state.set(row.subscription_id, row)
            return { meta: { changes: 1 } }
          }
          if (sql.includes('SET status =')) {
            const row = state.get(String(values[3]))
            if (!row || row.subscriber_id !== String(values[4]) || row.updated_at !== String(values[5])) return { meta: { changes: 0 } }
            row.status = values[0] as SubscriptionStatus; row.cancel_at = values[1] as string | null; row.updated_at = String(values[2])
            return { meta: { changes: 1 } }
          }
          if (sql.includes('SET plan_id =')) {
            const row = state.get(String(values[3]))
            if (!row || row.subscriber_id !== String(values[4]) || row.updated_at !== String(values[5])) return { meta: { changes: 0 } }
            row.plan_id = String(values[0]); row.plan_version = Number(values[1]); row.updated_at = String(values[2])
            return { meta: { changes: 1 } }
          }
          throw new Error('unexpected query')
        },
      }
      return statement as unknown as ReturnType<D1Database["prepare"]>
    },
  } as unknown as D1Database
}

const baseRow = (overrides: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  subscription_id: 'sub_existing', subscriber_id: 'user_1', plan_id: 'plan_basic', plan_version: 1, creator_id: null, status: 'ACTIVE',
  started_at: '2026-10-02T12:00:00.000Z', current_period_start: '2026-10-02T12:00:00.000Z', current_period_end: '2026-11-01T12:00:00.000Z',
  cancel_at: null, entitlement_snapshot_ref: null, created_at: '2026-10-02T12:00:00.000Z', updated_at: '2026-10-02T12:00:00.000Z', ...overrides
})

describe('subscription runtime', () => {
  it('creates an idempotent pending subscription', async () => {
    const db = fakeDb([]); const first = await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' });
    const second = await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' });
    expect(first.subscriptionId).toBe(second.subscriptionId); expect(first.status).toBe('PENDING'); expect(first.planVersion).toBe(1); expect(first.etag).toBe(etagForUpdatedAt(first.updatedAt))
  })
  it('rejects idempotency-key reuse for a different plan', async () => {
    const db = fakeDb([]); await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' })
    await expect(createSubscription(db, 'user_1', { planId: 'plan_pro', idempotencyKey: 'create-1' })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })
  it('scopes reads to the subscriber', async () => {
    const db = fakeDb([baseRow()]); await expect(getSubscription(db, 'user_2', 'sub_existing')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
  })
  it('enforces If-Match for pause and transitions ACTIVE to PAUSED', async () => {
    const db = fakeDb([baseRow()]); const before = await getSubscription(db, 'user_1', 'sub_existing'); const after = await transitionSubscription(db, 'user_1', 'sub_existing', 'pause', before.etag)
    expect(after.status).toBe('PAUSED'); expect(after.updatedAt).not.toBe(before.updatedAt)
  })
  it('fails stale If-Match without changing state', async () => {
    const db = fakeDb([baseRow()]); await expect(transitionSubscription(db, 'user_1', 'sub_existing', 'pause', '"lr-stale"')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
  })
  it('changes plan only for mutable lifecycle states', async () => {
    const db = fakeDb([baseRow()]); const before = await getSubscription(db, 'user_1', 'sub_existing'); const after = await changeSubscriptionPlan(db, 'user_1', 'sub_existing', 'plan_pro', before.etag)
    expect(after.planId).toBe('plan_pro'); expect(after.status).toBe('ACTIVE')
  })
  it('rejects cancel from PENDING according to the state machine', async () => {
    const db = fakeDb([baseRow({ status: 'PENDING' })]); const before = await getSubscription(db, 'user_1', 'sub_existing'); await expect(transitionSubscription(db, 'user_1', 'sub_existing', 'cancel', before.etag)).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  })
  it('does not expose entitlementSnapshotRef', async () => {
    const db = fakeDb([baseRow({ entitlement_snapshot_ref: 'internal-ref' })]); const result = await getSubscription(db, 'user_1', 'sub_existing'); expect(result).not.toHaveProperty('entitlementSnapshotRef')
  })
})

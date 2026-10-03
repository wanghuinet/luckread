import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { changeSubscriptionPlan, createSubscription, decodeSubscriptionCursor, encodeSubscriptionCursor, etagForSubscription, getSubscription, listSubscriptions, parseBoundedPositiveInt, transitionSubscription, type SubscriptionRow, type SubscriptionStatus } from './subscription-runtime.js'

type Statement = { bind: (...values: unknown[]) => Statement; first: <T>() => Promise<T | null>; all: <T>() => Promise<{ results: T[] }>; run: () => Promise<{ meta: { changes: number } }> }

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
        async all<T>() {
          if (sql.includes('WHERE subscriber_id = ?')) {
            const subscriberId = String(values[0])
            const hasCursor = sql.includes('created_at < ? OR (created_at = ? AND subscription_id < ?)')
            const limit = Number(values[hasCursor ? 4 : 1])
            let results = Array.from(state.values())
              .filter((row) => row.subscriber_id === subscriberId)
              .sort((left, right) =>
                right.created_at.localeCompare(left.created_at) ||
                right.subscription_id.localeCompare(left.subscription_id),
              )
            if (hasCursor) {
              const cursorCreatedAt = String(values[1])
              const cursorId = String(values[3])
              results = results.filter((row) =>
                row.created_at < cursorCreatedAt ||
                (row.created_at === cursorCreatedAt && row.subscription_id < cursorId),
              )
            }
            return { results: results.slice(0, limit).map((row) => ({ ...row })) as T[] }
          }
          return { results: [] as T[] }
        },
        async run() {
          if (sql.includes('INSERT INTO')) {
            const row: SubscriptionRow = {
              subscription_id: String(values[0]),
              subscriber_id: String(values[1]),
              version: Number(values[2]),
              plan_id: String(values[3]),
              plan_version: Number(values[4]),
              creator_id: values[5] as string | null,
              status: values[6] as SubscriptionStatus,
              started_at: String(values[7]),
              current_period_start: String(values[8]),
              current_period_end: String(values[9]),
              cancel_at: values[10] as string | null,
              entitlement_snapshot_ref: values[11] as string | null,
              created_at: String(values[12]),
              updated_at: String(values[13]),
            }
            if (state.has(row.subscription_id)) throw new Error('UNIQUE constraint failed')
            state.set(row.subscription_id, row)
            return { meta: { changes: 1 } }
          }
          if (sql.includes('SET status =')) {
            const row = state.get(String(values[4]))
            if (!row || row.subscriber_id !== String(values[5]) || row.version !== Number(values[6])) return { meta: { changes: 0 } }
            row.status = values[0] as SubscriptionStatus
            row.cancel_at = values[1] as string | null
            row.version = Number(values[2])
            row.updated_at = String(values[3])
            return { meta: { changes: 1 } }
          }
          if (sql.includes('SET plan_id =')) {
            const row = state.get(String(values[4]))
            if (!row || row.subscriber_id !== String(values[5]) || row.version !== Number(values[6])) return { meta: { changes: 0 } }
            row.plan_id = String(values[0])
            row.plan_version = Number(values[1])
            row.version = Number(values[2])
            row.updated_at = String(values[3])
            return { meta: { changes: 1 } }
          }
          throw new Error('unexpected query')
        },
      }
      return statement as unknown as ReturnType<D1Database['prepare']>
    },
  } as unknown as D1Database
}

const baseRow = (overrides: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  subscription_id: 'sub_existing',
  subscriber_id: 'user_1',
  version: 1,
  plan_id: 'plan_basic',
  plan_version: 1,
  creator_id: null,
  status: 'ACTIVE',
  started_at: '2026-10-02T12:00:00.000Z',
  current_period_start: '2026-10-02T12:00:00.000Z',
  current_period_end: '2026-11-01T12:00:00.000Z',
  cancel_at: null,
  entitlement_snapshot_ref: null,
  created_at: '2026-10-02T12:00:00.000Z',
  updated_at: '2026-10-02T12:00:00.000Z',
  ...overrides,
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

  it('rejects page pagination and requires opaque cursors for list continuation', () => {
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(index).toContain("if (url.searchParams.has('page')) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)")
    expect(index).toContain("const requestedCursor = url.searchParams.get('cursor')")
  })

  it('enforces idempotency at the W07 transport boundary for every mutation operation', () => {
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(index).toContain("if (isMutationOperation(operation.operation)) validateIdempotencyKey(request.headers.get('Idempotency-Key'))")
    expect(index).toContain("const mutationOperations: readonly MutationOperation[] = ['cancel', 'pause', 'resume', 'change-plan']")
  })

  it('creates an idempotent pending subscription with version 1', async () => {
    const db = fakeDb([])
    const first = await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' })
    const second = await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' })
    expect(first.subscriptionId).toBe(second.subscriptionId)
    expect(first.status).toBe('PENDING')
    expect(first.version).toBe(1)
    expect(first.planVersion).toBe(1)
    expect(first.etag).toMatch(/^"v1-r1-[A-Za-z0-9_-]+"$/)
  })

  it('rejects idempotency-key reuse for a different plan', async () => {
    const db = fakeDb([])
    await createSubscription(db, 'user_1', { planId: 'plan_basic', idempotencyKey: 'create-1' })
    await expect(createSubscription(db, 'user_1', { planId: 'plan_pro', idempotencyKey: 'create-1' })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('scopes reads to the subscriber', async () => {
    const db = fakeDb([baseRow()])
    await expect(getSubscription(db, 'user_2', 'sub_existing')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
  })

  it('uses version/CAS for pause and increments exactly once', async () => {
    const db = fakeDb([baseRow()])
    const before = await getSubscription(db, 'user_1', 'sub_existing')
    const after = await transitionSubscription(db, 'user_1', 'sub_existing', 'pause', before.etag)
    expect(after.status).toBe('PAUSED')
    expect(after.version).toBe(2)
    expect(after.etag).toMatch(/^"v2-r1-[A-Za-z0-9_-]+"$/)
    expect(after.updatedAt).not.toBe(before.updatedAt)
  })

  it('fails stale If-Match without changing version or state', async () => {
    const db = fakeDb([baseRow()])
    const before = await getSubscription(db, 'user_1', 'sub_existing')
    await expect(transitionSubscription(db, 'user_1', 'sub_existing', 'pause', before.etag)).resolves.toMatchObject({ version: 2 })
    await expect(transitionSubscription(db, 'user_1', 'sub_existing', 'resume', before.etag)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
  })

  it('advances version even when the clock equals the stored timestamp', async () => {
    const db = fakeDb([baseRow()])
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'))
    const before = await getSubscription(db, 'user_1', 'sub_existing')
    const after = await transitionSubscription(db, 'user_1', 'sub_existing', 'pause', before.etag)
    expect(after.version).toBe(before.version + 1)
    expect(Date.parse(after.updatedAt)).toBe(Date.parse(before.updatedAt) + 1)
  })

  it('changes plan only for mutable lifecycle states and advances version', async () => {
    const db = fakeDb([baseRow()])
    const before = await getSubscription(db, 'user_1', 'sub_existing')
    const after = await changeSubscriptionPlan(db, 'user_1', 'sub_existing', 'plan_pro', before.etag)
    expect(after.planId).toBe('plan_pro')
    expect(after.status).toBe('ACTIVE')
    expect(after.version).toBe(2)
  })

  it('rejects cancel from PENDING according to the state machine', async () => {
    const db = fakeDb([baseRow({ status: 'PENDING' })])
    const before = await getSubscription(db, 'user_1', 'sub_existing')
    await expect(transitionSubscription(db, 'user_1', 'sub_existing', 'cancel', before.etag)).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  })

  it('lists only current subscriber records with stable cursor pagination', async () => {
    const db = fakeDb([
      baseRow({ subscription_id: 'sub_old', created_at: '2026-10-01T12:00:00.000Z', updated_at: '2026-10-01T12:00:00.000Z' }),
      baseRow({ subscription_id: 'sub_new', created_at: '2026-10-02T13:00:00.000Z', updated_at: '2026-10-02T13:00:00.000Z' }),
      baseRow({ subscription_id: 'sub_other', subscriber_id: 'user_2', created_at: '2026-10-03T12:00:00.000Z' }),
    ])
    const first = await listSubscriptions(db, 'user_1', null, 1)
    expect(first.items).toHaveLength(1)
    expect(first.items[0]?.subscriptionId).toBe('sub_new')
    expect(first.hasMore).toBe(true)
    expect(first.limit).toBe(1)
    expect(first.nextCursor).toBeTruthy()

    const second = await listSubscriptions(db, 'user_1', first.nextCursor, 1)
    expect(second.items).toHaveLength(1)
    expect(second.items[0]?.subscriptionId).toBe('sub_old')
    expect(second.hasMore).toBe(false)
    expect(second.nextCursor).toBeNull()

    const decoded = decodeSubscriptionCursor(first.nextCursor!)
    expect(decoded.endpoint).toBe('membership.subscriptions')
    expect(decoded.createdAt).toBe(first.items[0]!.createdAt)
    expect(decoded.id).toBe(first.items[0]!.subscriptionId)
    expect(decodeSubscriptionCursor(encodeSubscriptionCursor(decoded))).toEqual(decoded)
  })

  it('rejects malformed, cross-scope and expired cursors', async () => {
    expect(() => decodeSubscriptionCursor('not-a-valid-cursor')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED', status: 400 }),
    )
    const db = fakeDb([baseRow()])
    const scope = 'wrong-scope'
    const future = Date.now() + 60_000
    const foreign = encodeSubscriptionCursor({
      scope,
      createdAt: baseRow().created_at,
      id: baseRow().subscription_id,
      exp: future,
    })
    await expect(listSubscriptions(db, 'user_1', foreign, 1)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })

    const expired = encodeSubscriptionCursor({
      scope: representationScopeForTest('user_1'),
      createdAt: baseRow().created_at,
      id: baseRow().subscription_id,
      exp: Date.now() - 1,
    })
    await expect(listSubscriptions(db, 'user_1', expired, 1)).rejects.toMatchObject({ code: 'CURSOR_EXPIRED', status: 400 })
  })

  it('does not expose entitlementSnapshotRef', async () => {
    const db = fakeDb([baseRow({ entitlement_snapshot_ref: 'internal-ref' })])
    const result = await getSubscription(db, 'user_1', 'sub_existing')
    expect(result).not.toHaveProperty('entitlementSnapshotRef')
  })

  it('binds the canonical frontend cursor response shape', () => {
    const page = readFileSync(resolve(process.cwd(), '../W01-payload/src/app/(frontend)/me/subscriptions/page.tsx'), 'utf8')
    expect(page).toContain("new URLSearchParams({ limit: '20' })")
    expect(page).toContain('setNextCursor(data.data.nextCursor ?? null)')
    expect(page).toContain('load(nextCursor, true)')
    expect(page).toContain('data?.data?.items')
  })
})

const representationScopeForTest = (subscriberId: string): string => {
  let hash = 2166136261
  const value = 'membership.subscriptions\0' + subscriberId + '\0created_at DESC,subscription_id DESC'
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

afterEach(() => vi.useRealTimers())

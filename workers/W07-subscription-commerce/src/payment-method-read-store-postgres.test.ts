import { describe, expect, it, vi } from 'vitest'

import {
  createPostgresPaymentMethodReadStore,
  type PaymentMethodPostgresQueryExecutor,
  type PaymentMethodPostgresTransactionClient,
} from './payment-method-read-store-postgres.js'

const savedPaymentMethodId = 'spm_12345678901234567890123456'
const revocationRequestId = 'pmr_12345678901234567890123456'
const paymentMethodId = 'hyperswitch_pm_001'
const customerId = 'customer_01'
const merchantId = 'merchant_01'
const idempotencyKey = 'remove_pm_001'
const now = '2026-11-15T12:00:00.000Z'

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    revocation_request_id: revocationRequestId,
    saved_payment_method_id: savedPaymentMethodId,
    payment_method_id: paymentMethodId,
    customer_id: customerId,
    merchant_id: merchantId,
    idempotency_key: idempotencyKey,
    status: 'REQUESTED',
    provider_method_deleted_at: null,
    version: 1,
    updated_at: now,
    ...overrides,
  }
}

function poolWithResponses(
  responses: Array<{ rows?: Record<string, unknown>[] }>,
) {
  const queue = [...responses]
  const calls: Array<{ sql: string; values?: unknown[] }> = []
  const release = vi.fn()
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values })
      const next = queue.shift()
      return { rows: next?.rows ?? [] }
    }),
    release,
  } as unknown as PaymentMethodPostgresTransactionClient
  const pool = {
    query: vi.fn(),
    connect: vi.fn(async () => client),
  } as unknown as PaymentMethodPostgresQueryExecutor
  return { pool, client, calls, release }
}

describe('W07 PostgreSQL payment-method persistence', () => {
  it('persists the first revocation request as the MIT block without dispatching provider I/O', async () => {
    const { pool, calls, release } = poolWithResponses([
      { rows: [] }, // BEGIN
      { rows: [] }, // no existing revocation
      { rows: [requestRow()] }, // INSERT ... RETURNING
      { rows: [] }, // COMMIT
    ])
    const store = createPostgresPaymentMethodReadStore(pool)
    const result = await store.createPaymentMethodRevocationRequest(
      customerId, merchantId, savedPaymentMethodId, idempotencyKey, now,
      () => revocationRequestId,
    )

    expect(result).toMatchObject({
      request: {
        revocationRequestId,
        savedPaymentMethodId,
        paymentMethodId,
        customerId,
        merchantId,
        idempotencyKey,
        status: 'REQUESTED',
        version: 1,
      },
      replayed: false,
      dispatchProvider: false,
    })
    expect(calls.some((call) => call.sql.includes('INSERT INTO payment_method_revocation_requests'))).toBe(true)
    expect(calls.some((call) => call.sql.includes('FROM saved_payment_methods s'))).toBe(true)
    expect(release).toHaveBeenCalledOnce()
  })

  it('replays an existing request only with the exact idempotency key', async () => {
    const existing = requestRow()
    const { pool, calls } = poolWithResponses([
      { rows: [] }, // BEGIN
      { rows: [existing] }, // SELECT ... FOR UPDATE
      { rows: [] }, // COMMIT
    ])
    const store = createPostgresPaymentMethodReadStore(pool)
    const result = await store.createPaymentMethodRevocationRequest(
      customerId, merchantId, savedPaymentMethodId, idempotencyKey, now,
      () => revocationRequestId,
    )

    expect(result.replayed).toBe(true)
    expect(result.dispatchProvider).toBe(true)
    expect(calls.some((call) => call.sql.includes('INSERT INTO payment_method_revocation_requests'))).toBe(false)
  })

  it('rejects idempotency-key reuse for a different revocation request', async () => {
    const { pool } = poolWithResponses([
      { rows: [] },
      { rows: [requestRow({ idempotency_key: 'different_key' })] },
    ])
    const store = createPostgresPaymentMethodReadStore(pool)
    await expect(store.createPaymentMethodRevocationRequest(
      customerId, merchantId, savedPaymentMethodId, idempotencyKey, now,
      () => revocationRequestId,
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('uses a version-guarded update and derives completion from all linked mandate states', async () => {
    const completed = requestRow({
      status: 'COMPLETED',
      provider_method_deleted_at: now,
      version: 2,
    })
    const { pool, calls, release } = poolWithResponses([
      { rows: [] }, // BEGIN
      { rows: [requestRow()] }, // SELECT ... FOR UPDATE
      { rows: [completed] }, // UPDATE ... RETURNING
      { rows: [] }, // COMMIT
    ])
    const store = createPostgresPaymentMethodReadStore(pool)
    const result = await store.markPaymentMethodProviderDeleted({
      revocationRequestId,
      savedPaymentMethodId,
      paymentMethodId,
      customerId,
      merchantId,
      idempotencyKey,
      status: 'REQUESTED',
      providerMethodDeletedAt: null,
      version: 1,
      updatedAt: now,
    }, '2026-11-15T12:00:01.000Z')

    expect(result.status).toBe('COMPLETED')
    expect(result.version).toBe(2)
    const update = calls.find((call) => call.sql.startsWith('UPDATE payment_method_revocation_requests'))
    expect(update?.sql).toContain('r.version = $5')
    expect(update?.sql).toContain('JOIN saved_payment_methods s')
    expect(update?.sql).toContain('s.saved_payment_method_id = r.saved_payment_method_id')
    expect(update?.sql).toContain("m.status NOT IN ('REVOKED','FAILED','EXPIRED')")
    expect(release).toHaveBeenCalledOnce()
  })

})

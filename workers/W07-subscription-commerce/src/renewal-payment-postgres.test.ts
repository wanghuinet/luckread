import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { readRenewalPaymentAttemptPostgres } from './renewal-payment-postgres.js'

const paymentId = 'pay_' + 'a'.repeat(26)
const customerId = 'user_renewal_01'
const createdAt = '2026-11-18T12:00:00.000Z'
const updatedAt = '2026-11-18T12:00:01.000Z'

function poolWith(
  rows: Array<Record<string, unknown>> = [],
  failure?: Error,
) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    if (failure) throw failure
    return { rows, rowCount: rows.length }
  })
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    calls,
  }
}

describe('native PostgreSQL renewal payment attempt reads', () => {
  it('reads the cycle-bound payment snapshot with canonical timestamps and numeric amounts', async () => {
    const row = {
      payment_id: paymentId,
      order_id: 'ord_renewal_01',
      customer_id: customerId,
      provider: 'hyperswitch',
      merchant_id: 'merchant_01',
      amount_minor: 990,
      currency: 'USD',
      status: 'INITIATING',
      version: 2,
      idempotency_key: 'renew_cycle_01',
      request_hash: 'a'.repeat(64),
      provider_updated_at: null,
      failure_code: null,
      created_at: createdAt,
      updated_at: updatedAt,
    }
    const f = poolWith([row])

    await expect(readRenewalPaymentAttemptPostgres(f.pool, paymentId, customerId)).resolves.toEqual(row)

    expect(f.calls[0]?.sql).toContain('payment_id = $1 AND customer_id = $2 LIMIT 1')
    expect(f.calls[0]?.sql).toContain('amount_minor::double precision AS amount_minor')
    expect(f.calls[0]?.sql).toContain("to_char(created_at AT TIME ZONE 'UTC'")
    expect(f.calls[0]?.sql).toContain("CASE WHEN provider_updated_at IS NULL THEN NULL ELSE to_char")
    expect(f.calls[0]?.values).toEqual([paymentId, customerId])
  })

  it('returns null when no payment row belongs to the requested customer', async () => {
    const f = poolWith()
    await expect(readRenewalPaymentAttemptPostgres(f.pool, paymentId, customerId)).resolves.toBeNull()
    expect(f.calls[0]?.values).toEqual([paymentId, customerId])
  })

  it('maps PostgreSQL failures to a sanitized renewal payment read error', async () => {
    const f = poolWith([], new Error('private PostgreSQL endpoint and credentials'))

    await expect(readRenewalPaymentAttemptPostgres(f.pool, paymentId, customerId))
      .rejects.toThrow('W07_RENEWAL_PAYMENT_POSTGRES_UNAVAILABLE')
  })
})

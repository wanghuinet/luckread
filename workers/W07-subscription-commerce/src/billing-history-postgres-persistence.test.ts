import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { BillingPersistenceError, encodeBillingHistoryCursor } from './billing-contracts.js'
import {
  listBillingDocumentsForCustomerPostgres,
  listPaymentHistoryForCustomerPostgres,
  listRefundHistoryForCustomerPostgres,
} from './billing-history-postgres-persistence.js'

const CUSTOMER = 'customer_history_pg'
const NOW = '2026-11-18T11:00:00.123456Z'

function makePool(rows: Record<string, unknown>[], fail = false) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    if (fail) throw new Error('raw database detail must not escape')
    return { rows, rowCount: rows.length }
  })
  return { pool: { query } as unknown as W07WebhookPostgresPool, calls, query }
}

const documentRow = (id: string) => ({
  document_id: id,
  document_type: 'INVOICE',
  document_number: 'INV-' + id,
  customer_id: CUSTOMER,
  order_id: 'order_' + id,
  payment_id: null,
  amount_minor: '12500',
  currency: 'USD',
  snapshot_json: JSON.stringify({ orderId: 'order_' + id, immutable: true }),
  issued_at: NOW,
  created_at: NOW,
})

describe('W07 native PostgreSQL billing history reads', () => {
  it('lists customer-owned invoices with safe bigint mapping and keyset continuation', async () => {
    const f = makePool([documentRow('doc_new'), documentRow('doc_old')])
    const page = await listBillingDocumentsForCustomerPostgres(f.pool, CUSTOMER, 1)

    expect(page).toMatchObject({
      items: [{
        documentId: 'doc_new',
        documentType: 'INVOICE',
        orderId: 'order_doc_new',
        amountMinor: 12500,
        snapshot: { orderId: 'order_doc_new', immutable: true },
      }],
      hasMore: true,
    })
    expect(page.nextCursor).toBe(encodeBillingHistoryCursor({ timestamp: NOW, id: 'doc_new' }))
    expect(f.calls[0]?.sql).toContain('WHERE customer_id = $1')
    expect(f.calls[0]?.sql).toContain('ORDER BY issued_at DESC, document_id DESC LIMIT $2')
    expect(f.calls[0]?.values).toEqual([CUSTOMER, 2])
  })

  it('applies the opaque cursor to the exact PostgreSQL timestamp/id tuple', async () => {
    const cursor = encodeBillingHistoryCursor({ timestamp: NOW, id: 'doc_new' })
    const f = makePool([documentRow('doc_old')])
    const page = await listBillingDocumentsForCustomerPostgres(f.pool, CUSTOMER, 5, cursor)

    expect(page.items[0]?.documentId).toBe('doc_old')
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
    expect(f.calls[0]?.sql).toContain('(issued_at < $2::timestamptz OR (issued_at = $2::timestamptz AND document_id < $3))')
    expect(f.calls[0]?.values).toEqual([CUSTOMER, NOW, 'doc_new', 6])
  })

  it('maps payment history and aggregates successful refunds without losing safe numeric values', async () => {
    const f = makePool([{
      payment_id: 'pay_' + 'p'.repeat(26),
      order_id: 'order_payment_01',
      amount_minor: '2500',
      currency: 'USD',
      status: 'succeeded',
      version: '3',
      provider_updated_at: NOW,
      created_at: NOW,
      updated_at: NOW,
      refunded_minor: '500',
    }])
    const page = await listPaymentHistoryForCustomerPostgres(f.pool, CUSTOMER, 10)

    expect(page.items).toEqual([{
      paymentId: 'pay_' + 'p'.repeat(26),
      orderId: 'order_payment_01',
      amountMinor: 2500,
      currency: 'USD',
      status: 'succeeded',
      version: 3,
      providerUpdatedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      refundedMinor: 500,
    }])
    expect(f.calls[0]?.sql).toContain('FROM payments p WHERE p.customer_id = $1')
    expect(f.calls[0]?.sql).toContain("r.status = 'SUCCEEDED'")
    expect(f.calls[0]?.sql).toContain('ORDER BY p.created_at DESC, p.payment_id DESC LIMIT $2')
  })

  it('maps refund history using customer scope and stable keyset order', async () => {
    const f = makePool([{
      refund_id: 'ref_' + 'r'.repeat(26),
      payment_id: 'pay_' + 'p'.repeat(26),
      order_id: 'order_refund_01',
      amount_minor: '750',
      currency: 'USD',
      status: 'SUCCEEDED',
      reason: 'customer_request',
      version: '2',
      provider_updated_at: null,
      created_at: NOW,
      updated_at: NOW,
    }])
    const page = await listRefundHistoryForCustomerPostgres(f.pool, CUSTOMER, 10)

    expect(page.items).toEqual([{
      refundId: 'ref_' + 'r'.repeat(26),
      paymentId: 'pay_' + 'p'.repeat(26),
      orderId: 'order_refund_01',
      amountMinor: 750,
      currency: 'USD',
      status: 'SUCCEEDED',
      reason: 'customer_request',
      version: 2,
      providerUpdatedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    }])
    expect(f.calls[0]?.sql).toContain('FROM refunds WHERE customer_id = $1')
    expect(f.calls[0]?.sql).toContain('ORDER BY created_at DESC, refund_id DESC LIMIT $2')
  })

  it('rejects unsafe bigint values as integrity failures', async () => {
    const f = makePool([{
      ...documentRow('doc_unsafe'),
      amount_minor: '9007199254740992',
    }])
    await expect(listBillingDocumentsForCustomerPostgres(f.pool, CUSTOMER, 10))
      .rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 })
  })

  it('validates the same page and cursor contract before touching PostgreSQL', async () => {
    const f = makePool([])
    await expect(listBillingDocumentsForCustomerPostgres(f.pool, '', 10))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listPaymentHistoryForCustomerPostgres(f.pool, CUSTOMER, 51))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(listRefundHistoryForCustomerPostgres(f.pool, CUSTOMER, 10, 'not-a-cursor'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(f.query).not.toHaveBeenCalled()
  })

  it('sanitizes PostgreSQL query failures as service unavailable', async () => {
    const f = makePool([], true)
    await expect(listRefundHistoryForCustomerPostgres(f.pool, CUSTOMER, 10))
      .rejects.toBeInstanceOf(BillingPersistenceError)
    await expect(listPaymentHistoryForCustomerPostgres(f.pool, CUSTOMER, 10))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

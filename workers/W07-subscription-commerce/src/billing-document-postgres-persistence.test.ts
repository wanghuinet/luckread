import { describe, expect, it, vi } from 'vitest'
import type {
  W07WebhookPostgresClient,
  W07WebhookPostgresPool,
} from './payment-webhook-database-postgres.js'
import { BillingPersistenceError } from './billing-contracts.js'
import {
  issueInvoiceForOrderPostgres,
  issueReceiptForPaidPaymentPostgres,
} from './billing-document-postgres-persistence.js'

const PAYMENT_ID = 'pay_' + 'p'.repeat(26)
const MERCHANT = 'merchant_native_billing'
const CUSTOMER = 'customer_native_billing'
const ORDER_ID = 'order_native_billing'
const NOW = '2026-11-18T12:00:00.000Z'
const ORDERED_AT = '2026-11-18T10:00:00.000Z'
const PAID_AT = '2026-11-18T11:59:00.000Z'

type DocumentRow = {
  document_id: string
  document_type: 'INVOICE' | 'RECEIPT'
  document_number: string
  customer_id: string
  order_id: string
  payment_id: string | null
  amount_minor: string
  currency: string
  snapshot_json: string
  issued_at: string
  created_at: string
}

function fixture(options: {
  status?: string
  merchantId?: string
  amountMinor?: string
  orderTotalMinor?: string
  existingDocuments?: DocumentRow[]
  failInsertType?: 'INVOICE' | 'RECEIPT'
} = {}) {
  const state = {
    documents: [...(options.existingDocuments ?? [])],
  }
  let beforeTransaction: DocumentRow[] | null = null
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    if (sql === 'BEGIN') {
      beforeTransaction = state.documents.map((item) => ({ ...item }))
      return { rows: [], rowCount: 0 }
    }
    if (sql === 'COMMIT') {
      beforeTransaction = null
      return { rows: [], rowCount: 0 }
    }
    if (sql === 'ROLLBACK') {
      if (beforeTransaction) state.documents = beforeTransaction
      beforeTransaction = null
      return { rows: [], rowCount: 0 }
    }
    if (sql.startsWith('SELECT payment_id, order_id, customer_id')) {
      const [paymentId, provider, merchantId] = values
      if (paymentId !== PAYMENT_ID || provider !== 'hyperswitch' ||
          merchantId !== (options.merchantId ?? MERCHANT)) {
        return { rows: [], rowCount: 0 }
      }
      return {
        rows: [{
          payment_id: PAYMENT_ID,
          order_id: ORDER_ID,
          customer_id: CUSTOMER,
          provider: 'hyperswitch',
          merchant_id: options.merchantId ?? MERCHANT,
          amount_minor: options.amountMinor ?? '2500',
          currency: 'USD',
          status: options.status ?? 'succeeded',
          provider_updated_at: PAID_AT,
          updated_at: PAID_AT,
        }],
        rowCount: 1,
      }
    }
    if (sql.startsWith('SELECT document_id, document_type')) {
      const [, type, orderId] = values
      const found = state.documents.find((item) =>
        item.customer_id === CUSTOMER && item.document_type === type && item.order_id === orderId)
      return { rows: found ? [{ ...found }] : [], rowCount: found ? 1 : 0 }
    }
    if (sql.startsWith('SELECT order_id, customer_id, status')) {
      const [orderId, customerId] = values
      if (orderId !== ORDER_ID || customerId !== CUSTOMER) return { rows: [], rowCount: 0 }
      return {
        rows: [{
          order_id: ORDER_ID,
          customer_id: CUSTOMER,
          status: 'CONFIRMED',
          currency: 'USD',
          subtotal_minor: '2500',
          discount_minor: '0',
          tax_minor: '0',
          total_minor: options.orderTotalMinor ?? '2500',
          created_at: ORDERED_AT,
        }],
        rowCount: 1,
      }
    }
    if (sql.startsWith('SELECT item_type, item_ref, item_version')) {
      return {
        rows: [{
          item_type: 'MEMBERSHIP_PLAN',
          item_ref: 'plan_basic',
          item_version: '3',
          quantity: '1',
          unit_amount_minor: '2500',
          line_subtotal_minor: '2500',
          line_discount_minor: '0',
          line_tax_minor: '0',
          line_total_minor: '2500',
        }],
        rowCount: 1,
      }
    }
    if (sql.startsWith('INSERT INTO billing_documents')) {
      const type = sql.includes("VALUES ($1,'INVOICE'") ? 'INVOICE' : 'RECEIPT'
      if (options.failInsertType === type) throw new Error('simulated ' + type + ' insert failure')
      const valuesOffset = type === 'INVOICE' ? 0 : 0
      const [
        documentId,
        documentNumber,
        customerId,
        orderId,
        paymentIdOrAmount,
        amountOrCurrency,
        currencyOrSnapshot,
        snapshotOrIssuedAt,
        maybeIssuedAt,
      ] = values.slice(valuesOffset)
      const isInvoice = type === 'INVOICE'
      const row: DocumentRow = {
        document_id: documentId as string,
        document_type: type,
        document_number: documentNumber as string,
        customer_id: customerId as string,
        order_id: orderId as string,
        payment_id: isInvoice ? null : paymentIdOrAmount as string,
        amount_minor: String(isInvoice ? paymentIdOrAmount : amountOrCurrency),
        currency: String(isInvoice ? amountOrCurrency : currencyOrSnapshot),
        snapshot_json: String(isInvoice ? currencyOrSnapshot : snapshotOrIssuedAt),
        issued_at: String(isInvoice ? snapshotOrIssuedAt : maybeIssuedAt),
        created_at: String(isInvoice ? snapshotOrIssuedAt : maybeIssuedAt),
      }
      const existing = state.documents.find((item) => item.document_type === type && item.order_id === ORDER_ID)
      if (!existing) state.documents.push(row)
      return { rows: [], rowCount: existing ? 0 : 1 }
    }
    throw new Error('Unexpected PostgreSQL query: ' + sql)
  })
  const client = { query, release: vi.fn() } as unknown as W07WebhookPostgresClient
  const pool = {
    query: vi.fn(),
    connect: vi.fn(async () => client),
  } as unknown as W07WebhookPostgresPool
  return { pool, state, calls, query, client }
}

const dependencies = {
  now: () => new Date(NOW),
  createDocumentId: (() => {
    let sequence = 0
    return () => 'bdoc_native_' + (++sequence)
  })(),
  createDocumentNumber: (type: 'INVOICE' | 'RECEIPT') => type === 'INVOICE' ? 'INV-NATIVE-001' : 'RCT-NATIVE-001',
}

describe('W07 native PostgreSQL paid billing documents', () => {
  it('issues immutable invoice and receipt snapshots in one transaction', async () => {
    const f = fixture()
    const receipt = await issueReceiptForPaidPaymentPostgres(f.pool, PAYMENT_ID, MERCHANT, dependencies)
    expect(receipt).toMatchObject({
      documentType: 'RECEIPT',
      documentNumber: 'RCT-NATIVE-001',
      paymentId: PAYMENT_ID,
      amountMinor: 2500,
      currency: 'USD',
    })
    expect(f.state.documents.map((item) => item.document_type)).toEqual(['INVOICE', 'RECEIPT'])
    const invoice = JSON.parse(f.state.documents[0]!.snapshot_json)
    const receiptSnapshot = JSON.parse(f.state.documents[1]!.snapshot_json)
    expect(invoice).toMatchObject({
      orderId: ORDER_ID,
      orderStatusAtIssue: 'CONFIRMED',
      totalMinor: 2500,
      items: [{ itemRef: 'plan_basic', itemVersion: '3', quantity: 1 }],
    })
    expect(receiptSnapshot).toMatchObject({
      ...invoice,
      paymentId: PAYMENT_ID,
      paymentStatusAtIssue: 'succeeded',
      paidAmountMinor: 2500,
      paidCurrency: 'USD',
      paidAt: PAID_AT,
    })
    expect(f.calls[0]?.sql).toBe('BEGIN')
    expect(f.calls.at(-1)?.sql).toBe('COMMIT')
    expect(f.client.release).toHaveBeenCalledOnce()
  })

  it('returns an existing receipt unchanged on exact payment replay', async () => {
    const existing: DocumentRow = {
      document_id: 'bdoc-existing-receipt',
      document_type: 'RECEIPT',
      document_number: 'RCT-EXISTING',
      customer_id: CUSTOMER,
      order_id: ORDER_ID,
      payment_id: PAYMENT_ID,
      amount_minor: '2500',
      currency: 'USD',
      snapshot_json: JSON.stringify({ orderId: ORDER_ID, paymentId: PAYMENT_ID }),
      issued_at: NOW,
      created_at: NOW,
    }
    const f = fixture({ existingDocuments: [existing] })
    const result = await issueReceiptForPaidPaymentPostgres(f.pool, PAYMENT_ID, MERCHANT, dependencies)
    expect(result.documentId).toBe(existing.document_id)
    expect(f.state.documents).toHaveLength(1)
    expect(f.calls.some((call) => call.sql.startsWith('INSERT INTO billing_documents'))).toBe(false)
    expect(f.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('fails closed when a stored receipt belongs to another payment for the same order', async () => {
    const existing: DocumentRow = {
      document_id: 'bdoc-existing-receipt',
      document_type: 'RECEIPT',
      document_number: 'RCT-EXISTING',
      customer_id: CUSTOMER,
      order_id: ORDER_ID,
      payment_id: 'pay_' + 'x'.repeat(26),
      amount_minor: '2500',
      currency: 'USD',
      snapshot_json: JSON.stringify({ orderId: ORDER_ID }),
      issued_at: NOW,
      created_at: NOW,
    }
    const f = fixture({ existingDocuments: [existing] })
    await expect(issueReceiptForPaidPaymentPostgres(f.pool, PAYMENT_ID, MERCHANT, dependencies))
      .rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 })
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK')
  })

  it('refuses pending payments and does not issue documents', async () => {
    const f = fixture({ status: 'processing' })
    await expect(issueReceiptForPaidPaymentPostgres(f.pool, PAYMENT_ID, MERCHANT, dependencies))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(f.state.documents).toHaveLength(0)
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK')
  })

  it('refuses a payment whose amount does not match the authoritative order total', async () => {
    const f = fixture({ amountMinor: '2499' })
    await expect(issueReceiptForPaidPaymentPostgres(f.pool, PAYMENT_ID, MERCHANT, dependencies))
      .rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 })
    expect(f.state.documents).toHaveLength(0)
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK')
  })

  it('rolls back an inserted invoice when receipt persistence fails', async () => {
    const f = fixture({ failInsertType: 'RECEIPT' })
    await expect(issueReceiptForPaidPaymentPostgres(f.pool, PAYMENT_ID, MERCHANT, dependencies))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(f.state.documents).toHaveLength(0)
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK')
    expect(f.client.release).toHaveBeenCalledOnce()
  })
})


describe('W07 native PostgreSQL order invoice', () => {
  it('issues an immutable invoice from the owner-scoped Order and OrderLine snapshot', async () => {
    const f = fixture()
    const invoice = await issueInvoiceForOrderPostgres(f.pool, CUSTOMER, ORDER_ID, dependencies)

    expect(invoice).toMatchObject({
      documentType: 'INVOICE',
      documentNumber: 'INV-NATIVE-001',
      orderId: ORDER_ID,
      paymentId: null,
      amountMinor: 2500,
      currency: 'USD',
    })
    expect(f.state.documents).toHaveLength(1)
    expect(f.state.documents[0]?.document_type).toBe('INVOICE')
    expect(JSON.parse(f.state.documents[0]!.snapshot_json)).toMatchObject({
      orderId: ORDER_ID,
      orderStatusAtIssue: 'CONFIRMED',
      totalMinor: 2500,
      items: [{ itemRef: 'plan_basic', itemVersion: '3', quantity: 1 }],
    })
    expect(f.calls[0]?.sql).toBe('BEGIN')
    expect(f.calls.at(-1)?.sql).toBe('COMMIT')
    expect(f.client.release).toHaveBeenCalledOnce()
  })

  it('replays the retained invoice unchanged and does not insert another document', async () => {
    const existing: DocumentRow = {
      document_id: 'bdoc-existing-invoice',
      document_type: 'INVOICE',
      document_number: 'INV-EXISTING',
      customer_id: CUSTOMER,
      order_id: ORDER_ID,
      payment_id: null,
      amount_minor: '2500',
      currency: 'USD',
      snapshot_json: JSON.stringify({ orderId: ORDER_ID, immutable: true }),
      issued_at: NOW,
      created_at: NOW,
    }
    const f = fixture({ existingDocuments: [existing] })
    const invoice = await issueInvoiceForOrderPostgres(f.pool, CUSTOMER, ORDER_ID, dependencies)

    expect(invoice.documentId).toBe(existing.document_id)
    expect(invoice.snapshot).toEqual({ orderId: ORDER_ID, immutable: true })
    expect(f.calls.some((call) => call.sql.startsWith('INSERT INTO billing_documents'))).toBe(false)
    expect(f.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('rejects an invoice request for an order not owned by the customer', async () => {
    const f = fixture()
    await expect(issueInvoiceForOrderPostgres(f.pool, 'another_customer', ORDER_ID, dependencies))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    expect(f.state.documents).toHaveLength(0)
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK')
  })
})

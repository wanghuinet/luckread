import { describe, expect, it } from 'vitest'
import {
  createRefundRequest,
  getRefundRequest,
  receiveHyperswitchWebhook,
  recordRefundProviderResponse,
  type RefundStatus,
} from './payment-persistence.js'
import type { HyperswitchRefund } from './hyperswitch-client.js'

const CUSTOMER = 'user_refund_1'
const MERCHANT = 'merchant_test'
const PAYMENT_ID = 'pay_' + 'a'.repeat(26)
const REFUND_ID = 'ref_' + 'a'.repeat(26)
const SECRET = 'refund-webhook-test-secret'
const NOW = '2026-10-30T14:58:00.000Z'
const LATER = '2026-10-30T14:59:00.000Z'
const LATEST = '2026-10-30T15:00:00.000Z'

type PaymentRow = {
  payment_id: string
  order_id: string
  customer_id: string
  provider: string
  merchant_id: string
  amount_minor: number
  currency: string
  status: string
  version: number
  idempotency_key: string
  request_hash: string
  provider_updated_at: string | null
  failure_code: string | null
  created_at: string
  updated_at: string
  amount_captured_minor: number
}
type RefundRow = {
  refundId: string
  paymentId: string
  amountMinor: number
  currency: string
  reason: string | null
  status: RefundStatus
  version: number
  providerUpdatedAt: string | null
  createdAt: string
  updatedAt: string
  refund_id: string
  payment_id: string
  customer_id: string
  provider: string
  merchant_id: string
  amount_minor: number
  idempotency_key: string
  request_hash: string
  provider_updated_at: string | null
  created_at: string
  updated_at: string
}
type EventRow = {
  event_row_id: string
  provider: string
  merchant_id: string
  event_id: string
  event_type: string
  payment_id: string | null
  payload_sha256: string
  state: 'RECEIVED' | 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED'
  received_at: string
  processed_at: string | null
  outcome_code: string | null
  refund_id: string | null
}

const d1Result = (changes: number): D1Result =>
  ({ success: true, meta: { changes } }) as D1Result

class RefundStatement {
  values: unknown[] = []
  constructor(readonly db: RefundTestD1, readonly sql: string) {}
  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values
    return this as unknown as D1PreparedStatement
  }
  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.values)
  }
  async run<T>(): Promise<D1Result<T>> {
    return this.db.run<T>(this.sql, this.values)
  }
}

class RefundTestD1 {
  payment: PaymentRow = {
    payment_id: PAYMENT_ID,
    order_id: 'ord_refund_1',
    customer_id: CUSTOMER,
    provider: 'hyperswitch',
    merchant_id: MERCHANT,
    amount_minor: 1200,
    amount_captured_minor: 1200,
    currency: 'USD',
    status: 'succeeded',
    version: 2,
    idempotency_key: 'payment-key',
    request_hash: 'b'.repeat(64),
    provider_updated_at: NOW,
    failure_code: null,
    created_at: NOW,
    updated_at: NOW,
  }
  refunds: RefundRow[] = []
  events: EventRow[] = []

  prepare(sql: string): D1PreparedStatement {
    return new RefundStatement(this, sql) as unknown as D1PreparedStatement
  }

  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    if (sql.includes('FROM payments') && sql.includes('payment_id = ? AND customer_id = ?')) {
      const [paymentId, customerId] = values
      return this.payment.payment_id === paymentId && this.payment.customer_id === customerId
        ? structuredClone(this.payment) as unknown as T
        : null
    }
    if (sql.includes('FROM payment_provider_events')) {
      const [provider, merchantId, eventId] = values
      const row = this.events.find(e => e.provider === provider && e.merchant_id === merchantId && e.event_id === eventId)
      return row ? structuredClone(row) as unknown as T : null
    }
    if (sql.includes('FROM refunds') && sql.includes('SUM(amount_minor)')) {
      const [paymentId] = values
      const reserved = this.refunds
        .filter(r => r.payment_id === paymentId && ['INITIATING', 'pending', 'review', 'succeeded'].includes(r.status))
        .reduce((sum, row) => sum + row.amount_minor, 0)
      return { reserved_minor: reserved } as unknown as T
    }
    if (sql.includes('FROM refunds') && sql.includes('idempotency_key = ?')) {
      const [customerId, key] = values
      const row = this.refunds.find(r => r.customer_id === customerId && r.idempotency_key === key)
      return row ? structuredClone(row) as unknown as T : null
    }
    if (sql.includes('FROM refunds') && sql.includes('customer_id = ? AND refund_id = ?')) {
      const [customerId, refundId] = values
      const row = this.refunds.find(r => r.customer_id === customerId && r.refund_id === refundId)
      return row ? structuredClone(row) as unknown as T : null
    }
    if (sql.includes('FROM refunds') && sql.includes('WHERE refund_id = ?')) {
      const [refundId] = values
      const row = this.refunds.find(r => r.refund_id === refundId)
      return row ? structuredClone(row) as unknown as T : null
    }
    throw new Error('Unexpected refund test query: ' + sql)
  }

  async run<T>(sql: string, values: unknown[]): Promise<D1Result<T>> {
    if (sql.startsWith('UPDATE payments SET amount_captured_minor = ?')) {
      const [captured, updatedAt, paymentId, customerId, merchantId, amount, currency, status, version, previousCaptured] =
        values as [number, string, string, string, string, number, string, string, number, number]
      const row = this.payment.payment_id === paymentId && this.payment.customer_id === customerId &&
        this.payment.merchant_id === merchantId && this.payment.amount_minor === amount &&
        this.payment.currency === currency && this.payment.status === status &&
        this.payment.version === version && this.payment.amount_captured_minor === previousCaptured
      if (!row || captured < previousCaptured || captured > amount) return d1Result(0) as D1Result<T>
      this.payment.amount_captured_minor = captured
      this.payment.version += 1
      this.payment.updated_at = updatedAt
      return d1Result(1) as D1Result<T>
    }

    if (sql.startsWith('INSERT INTO refunds')) {
      const [refundId, paymentId, customerId, merchantId, amount, currency, reason, key, requestHash, createdAt, updatedAt] =
        values as [string, string, string, string, number, string, string | null, string, string, string, string]
      const payment = this.payment
      if (
        payment.payment_id !== paymentId || payment.customer_id !== customerId ||
        payment.provider !== 'hyperswitch' || payment.merchant_id !== merchantId ||
        payment.status !== 'succeeded' || payment.currency !== currency ||
        amount + this.refunds
          .filter(r => r.payment_id === paymentId && ['INITIATING', 'pending', 'review', 'succeeded'].includes(r.status))
          .reduce((sum, r) => sum + r.amount_minor, 0) > payment.amount_minor
      ) throw new Error('refund insert guard')
      if (this.refunds.some(r => r.customer_id === customerId && r.idempotency_key === key)) {
        throw new Error('refund idempotency unique')
      }
      const row: RefundRow = {
        refundId,
        paymentId,
        amountMinor: amount,
        currency,
        reason,
        status: 'INITIATING',
        version: 1,
        providerUpdatedAt: null,
        createdAt,
        updatedAt,
        refund_id: refundId,
        payment_id: paymentId,
        customer_id: customerId,
        provider: 'hyperswitch',
        merchant_id: merchantId,
        amount_minor: amount,
        idempotency_key: key,
        request_hash: requestHash,
        provider_updated_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      }
      this.refunds.push(row)
      return d1Result(1) as D1Result<T>
    }

    if (sql.startsWith('UPDATE refunds SET status = ?') && sql.includes("status = 'INITIATING'")) {
      const [status, providerUpdatedAt, updatedAt, refundId, customerId, paymentId, amount, currency, version] =
        values as [RefundStatus, string | null, string, string, string, string, number, string, number]
      const row = this.refunds.find(r => r.refund_id === refundId && r.customer_id === customerId &&
        r.payment_id === paymentId && r.amount_minor === amount && r.currency === currency &&
        r.version === version && r.status === 'INITIATING')
      if (!row) return d1Result(0) as D1Result<T>
      row.status = status
      row.providerUpdatedAt = providerUpdatedAt
      row.provider_updated_at = providerUpdatedAt
      row.version += 1
      row.updatedAt = updatedAt
      row.updated_at = updatedAt
      return d1Result(1) as D1Result<T>
    }

    if (sql.startsWith('INSERT INTO payment_provider_events')) {
      const hasRefundId = sql.includes('outcome_code, refund_id')
      const [rowId, provider, merchantId, eventId, eventType, paymentId, payloadHash, receivedAt] =
        values.slice(0, 8) as [string, string, string, string, string, string | null, string, string]
      if (this.events.some(e => e.provider === provider && e.merchant_id === merchantId && e.event_id === eventId)) {
        return d1Result(0) as D1Result<T>
      }
      this.events.push({
        event_row_id: rowId,
        provider,
        merchant_id: merchantId,
        event_id: eventId,
        event_type: eventType,
        payment_id: paymentId,
        payload_sha256: payloadHash,
        state: 'RECEIVED',
        received_at: receivedAt,
        processed_at: null,
        outcome_code: null,
        refund_id: hasRefundId ? values[8] as string : null,
      })
      return d1Result(1) as D1Result<T>
    }

    if (sql.startsWith('UPDATE refunds SET status = ?') && sql.includes('EXISTS (SELECT 1 FROM payment_provider_events')) {
      const [status, providerUpdatedAt, updatedAt, refundId, paymentId, customerId, merchantId, provider,
        amount, currency, version, oldStatus, previousProviderAt, eventProvider, eventMerchant, eventId,
        payloadHash, eventRefundId] = values as [
          RefundStatus, string, string, string, string, string, string, string, number, string,
          number, RefundStatus, string | null, string, string, string, string, string
        ]
      const row = this.refunds.find(r => r.refund_id === refundId && r.payment_id === paymentId &&
        r.customer_id === customerId && r.merchant_id === merchantId && r.provider === provider &&
        r.amount_minor === amount && r.currency === currency && r.version === version && r.status === oldStatus &&
        (r.provider_updated_at === null || (previousProviderAt !== null && r.provider_updated_at < previousProviderAt)))
      const event = this.events.find(e => e.provider === eventProvider && e.merchant_id === eventMerchant &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.refund_id === eventRefundId &&
        e.state === 'RECEIVED')
      if (!row || !event) return d1Result(0) as D1Result<T>
      row.status = status
      row.providerUpdatedAt = providerUpdatedAt
      row.provider_updated_at = providerUpdatedAt
      row.version += 1
      row.updatedAt = updatedAt
      row.updated_at = updatedAt
      return d1Result(1) as D1Result<T>
    }

    if (sql.startsWith('UPDATE payment_provider_events SET state = CASE WHEN EXISTS')) {
      const [refundId, paymentId, merchantId, amount, currency, status, providerUpdatedAt, processedAt] =
        values.slice(0, 8) as [string, string, string, number, string, RefundStatus, string, string]
      const [provider, eventMerchant, eventId, payloadHash, eventRefundId] =
        values.slice(-5) as [string, string, string, string, string]
      const refund = this.refunds.find(r => r.refund_id === refundId && r.payment_id === paymentId &&
        r.merchant_id === merchantId && r.amount_minor === amount && r.currency === currency &&
        r.status === status && r.provider_updated_at === providerUpdatedAt)
      const event = this.events.find(e => e.provider === provider && e.merchant_id === eventMerchant &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.refund_id === eventRefundId &&
        e.state === 'RECEIVED')
      if (!event) return d1Result(0) as D1Result<T>
      event.state = refund ? 'APPLIED' : 'RECONCILIATION_REQUIRED'
      event.processed_at = processedAt
      event.outcome_code = refund ? 'REFUND_STATUS_APPLIED' : 'REFUND_STATUS_CAS_LOST_OR_OUT_OF_ORDER'
      return d1Result(1) as D1Result<T>
    }

    if (sql.startsWith('UPDATE payment_provider_events SET state = ?')) {
      const [state, processedAt, outcomeCode, provider, merchantId, eventId, payloadHash] =
        values as [EventRow['state'], string, string, string, string, string, string]
      const row = this.events.find(e => e.provider === provider && e.merchant_id === merchantId &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.state === 'RECEIVED')
      if (!row) return d1Result(0) as D1Result<T>
      row.state = state
      row.processed_at = processedAt
      row.outcome_code = outcomeCode
      return d1Result(1) as D1Result<T>
    }

    throw new Error('Unexpected refund test mutation: ' + sql)
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const snapshot = structuredClone({ refunds: this.refunds, events: this.events })
    try {
      const output: D1Result[] = []
      for (const statement of statements as unknown as RefundStatement[]) {
        output.push(await statement.run())
      }
      return output
    } catch (error) {
      this.refunds = snapshot.refunds
      this.events = snapshot.events
      throw error
    }
  }
}

function fixedDependencies(now = LATEST) {
  return {
    now: () => new Date(now),
    createRefundId: () => REFUND_ID,
    createEventRowId: () => 'evtrow_refund_1',
    createConflictId: () => 'evtconf_refund_1',
  }
}

async function signedRefundWebhook(input: {
  eventId: string
  eventType: 'refund_succeeded' | 'refund_failed' | 'refund_review'
  status: 'succeeded' | 'failed' | 'review'
  updatedAt: string
  refundId?: string
  paymentId?: string
  amount?: number
  currency?: string
}) {
  const body = JSON.stringify({
    merchant_id: MERCHANT,
    event_id: input.eventId,
    event_type: input.eventType,
    timestamp: input.updatedAt,
    content: {
      type: 'refund_details',
      object: {
        merchant_id: MERCHANT,
        refund_id: input.refundId ?? REFUND_ID,
        payment_id: input.paymentId ?? PAYMENT_ID,
        amount: input.amount ?? 400,
        currency: input.currency ?? 'USD',
        status: input.status,
        updated_at: input.updatedAt,
      },
    },
  })
  const raw = new TextEncoder().encode(body)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw))
  const signature = Array.from(mac, b => b.toString(16).padStart(2, '0')).join('')
  return {
    rawBody: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    signatureHeader: signature,
  }
}

function seedRefund(db: RefundTestD1, overrides: Partial<RefundRow> = {}) {
  const row: RefundRow = {
    refundId: REFUND_ID,
    paymentId: PAYMENT_ID,
    amountMinor: 400,
    currency: 'USD',
    reason: 'requested_by_customer',
    status: 'pending',
    version: 2,
    providerUpdatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    refund_id: REFUND_ID,
    payment_id: PAYMENT_ID,
    customer_id: CUSTOMER,
    provider: 'hyperswitch',
    merchant_id: MERCHANT,
    amount_minor: 400,
    idempotency_key: 'refund_idem_1',
    request_hash: 'd'.repeat(64),
    provider_updated_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
  db.refunds.push(row)
}

describe('W07 D1-04 refund persistence and signed provider lifecycle', () => {
  it('records only a validated, monotonic captured-amount observation for the same succeeded payment', async () => {
    const db = new RefundTestD1()
    db.payment.amount_captured_minor = 0
    const observed: HyperswitchPayment = {
      paymentId: PAYMENT_ID,
      merchantId: MERCHANT,
      amount: 1200,
      amountCaptured: 800,
      currency: 'USD',
      status: 'succeeded',
      clientSecret: null,
      customerId: CUSTOMER,
    }
    const first = await recordPaymentCapturedAmountObservation(
      db as unknown as D1Database, CUSTOMER, observed, fixedDependencies(),
    )
    expect(first).toMatchObject({ paymentId: PAYMENT_ID, amountCapturedMinor: 800, version: 3, changed: true })
    const replay = await recordPaymentCapturedAmountObservation(
      db as unknown as D1Database, CUSTOMER, observed, fixedDependencies(),
    )
    expect(replay).toMatchObject({ amountCapturedMinor: 800, version: 3, changed: false })
    await expect(recordPaymentCapturedAmountObservation(
      db as unknown as D1Database, CUSTOMER, { ...observed, amountCaptured: 700 }, fixedDependencies(),
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    await expect(recordPaymentCapturedAmountObservation(
      db as unknown as D1Database, 'another_customer', observed, fixedDependencies(),
    )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    await expect(recordPaymentCapturedAmountObservation(
      db as unknown as D1Database, CUSTOMER, { ...observed, amountCaptured: 1201 }, fixedDependencies(),
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('reserves an owner-scoped refund once and returns the same stable request on an idempotent replay', async () => {
    const db = new RefundTestD1()
    const first = await createRefundRequest(db as unknown as D1Database, CUSTOMER, PAYMENT_ID, 400,
      'refund_key_1', 'requested_by_customer', fixedDependencies())
    const replay = await createRefundRequest(db as unknown as D1Database, CUSTOMER, PAYMENT_ID, 400,
      'refund_key_1', 'requested_by_customer', fixedDependencies())
    expect(first).toMatchObject({ replayed: false, refund: { refundId: REFUND_ID, status: 'INITIATING', version: 1 } })
    expect(replay).toMatchObject({ replayed: true, refund: { refundId: REFUND_ID, status: 'INITIATING' } })
    expect(db.refunds).toHaveLength(1)
    await expect(getRefundRequest(db as unknown as D1Database, CUSTOMER, REFUND_ID))
      .resolves.toMatchObject({ refundId: REFUND_ID, amountMinor: 400, currency: 'USD', status: 'INITIATING' })
    await expect(getRefundRequest(db as unknown as D1Database, 'another_customer', REFUND_ID))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
  })

  it('conflicts on changed idempotent refund semantics and prevents over-reservation', async () => {
    const db = new RefundTestD1()
    await createRefundRequest(db as unknown as D1Database, CUSTOMER, PAYMENT_ID, 900,
      'refund_key_1', 'requested_by_customer', fixedDependencies())
    await expect(createRefundRequest(db as unknown as D1Database, CUSTOMER, PAYMENT_ID, 800,
      'refund_key_1', 'requested_by_customer', fixedDependencies()))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT', status: 409 })
    await expect(createRefundRequest(db as unknown as D1Database, CUSTOMER, PAYMENT_ID, 301,
      'refund_key_2', 'requested_by_customer', fixedDependencies()))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('releases an amount reservation only after a provider-confirmed failed result', async () => {
    const db = new RefundTestD1()
    await createRefundRequest(db as unknown as D1Database, CUSTOMER, PAYMENT_ID, 1000,
      'refund_key_1', null, fixedDependencies())
    const providerResult: HyperswitchRefund = {
      refundId: REFUND_ID, paymentId: PAYMENT_ID, amount: 1000, currency: 'USD',
      status: 'failed', reason: null, createdAt: NOW, updatedAt: LATER,
    }
    const failed = await recordRefundProviderResponse(db as unknown as D1Database, CUSTOMER,
      providerResult, fixedDependencies(LATEST))
    expect(failed).toMatchObject({ refundId: REFUND_ID, status: 'failed', version: 2 })
    const next = await createRefundRequest(db as unknown as D1Database, CUSTOMER, PAYMENT_ID, 1200,
      'refund_key_2', 'requested_by_customer', fixedDependencies())
    expect(next.refund.status).toBe('INITIATING')
    expect(db.refunds).toHaveLength(2)
  })

  it('applies only an exact, newer signed refund webhook and deduplicates a replay', async () => {
    const db = new RefundTestD1()
    seedRefund(db)
    const signed = await signedRefundWebhook({
      eventId: 'evt_refund_success',
      eventType: 'refund_succeeded',
      status: 'succeeded',
      updatedAt: LATER,
    })
    const input = { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT }
    const applied = await receiveHyperswitchWebhook(
      db as unknown as D1Database, input, fixedDependencies(LATEST),
    )
    expect(applied).toMatchObject({ outcome: 'APPLIED', eventId: 'evt_refund_success', state: 'APPLIED' })
    expect(db.refunds[0]).toMatchObject({ status: 'succeeded', version: 3, provider_updated_at: LATER })
    expect(db.events[0]).toMatchObject({ refund_id: REFUND_ID, state: 'APPLIED', outcome_code: 'REFUND_STATUS_APPLIED' })

    const duplicate = await receiveHyperswitchWebhook(
      db as unknown as D1Database, input, fixedDependencies('2026-10-30T15:01:00.000Z'),
    )
    expect(duplicate).toMatchObject({ outcome: 'DUPLICATE', receiptId: applied.receiptId })
    expect(db.refunds[0]?.version).toBe(3)
    expect(db.events).toHaveLength(1)
  })

  it('does not apply a signed refund event with mismatched amount or a stale provider timestamp', async () => {
    const db = new RefundTestD1()
    seedRefund(db)
    const mismatched = await signedRefundWebhook({
      eventId: 'evt_refund_wrong_amount',
      eventType: 'refund_succeeded',
      status: 'succeeded',
      updatedAt: LATER,
      amount: 401,
    })
    const rejected = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...mismatched, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDependencies(LATEST),
    )
    expect(rejected).toMatchObject({ outcome: 'REJECTED', state: 'REJECTED' })
    expect(db.refunds[0]?.status).toBe('pending')

    const stale = await signedRefundWebhook({
      eventId: 'evt_refund_stale',
      eventType: 'refund_review',
      status: 'review',
      updatedAt: NOW,
    })
    const reconciliation = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...stale, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDependencies(LATEST),
    )
    expect(reconciliation).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED' })
    expect(db.refunds[0]?.status).toBe('pending')
  })
})

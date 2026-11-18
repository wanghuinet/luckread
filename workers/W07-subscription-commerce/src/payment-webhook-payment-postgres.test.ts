import { describe, expect, it, vi } from 'vitest'
import {
  PaymentPersistenceError,
  type WebhookReceiptResult,
} from './payment-persistence.js'
import type {
  W07WebhookPostgresClient,
  W07WebhookPostgresPool,
} from './payment-webhook-database-postgres.js'
import { receiveHyperswitchPaymentWebhookPostgres } from './payment-webhook-payment-postgres.js'

const SECRET = 'hyperswitch-native-payment-test-secret'
const MERCHANT = 'merchant_native_test'
const PAYMENT_ID = 'pay_' + 'p'.repeat(26)
const EVENT_ID = 'evt_native_payment_001'
const NOW = '2026-11-18T17:00:00.000Z'
const PROVIDER_UPDATED = '2026-11-18T16:59:00.000Z'
const CREATED_AT = '2026-11-18T16:00:00.000Z'
const RAW_TEXT = JSON.stringify({
  event_id: EVENT_ID,
  event_type: 'payment_succeeded',
  merchant_id: MERCHANT,
  timestamp: NOW,
  content: {
    type: 'payment_details',
    object: {
      payment_id: PAYMENT_ID,
      merchant_id: MERCHANT,
      customer_id: 'customer_native_test',
      amount: 2500,
      currency: 'USD',
      status: 'succeeded',
      updated: PROVIDER_UPDATED,
    },
  },
})

async function signedInput(rawText = RAW_TEXT) {
  const bytes = new TextEncoder().encode(rawText)
  const rawBody = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, rawBody)
  const signatureHeader = Array.from(new Uint8Array(signature))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  return {
    rawBody,
    signatureHeader,
    webhookSecret: SECRET,
    expectedMerchantId: MERCHANT,
  }
}

function receipt(
  payloadSha256: string,
  state: 'RECEIVED' | 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED' = 'RECEIVED',
): WebhookReceiptResult {
  return {
    outcome: state === 'APPLIED' ? 'APPLIED' : state === 'REJECTED' ? 'REJECTED' : 'RECONCILIATION_REQUIRED',
    eventId: EVENT_ID,
    receiptId: 'evtrow_native_test',
    state,
    payloadSha256,
  }
}

function fixture(options: Readonly<{
  existingReceipt?: ReturnType<typeof receipt>
  conflictExists?: boolean
}> = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const client: W07WebhookPostgresClient = {
    query: vi.fn(async <Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) => {
      calls.push({ sql, values })
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (sql.startsWith('INSERT INTO payment_provider_events')) {
        if (options.existingReceipt) return { rows: [], rowCount: 0 }
        return {
          rows: [{
            event_row_id: 'evtrow_native_test',
            event_id: EVENT_ID,
            payload_sha256: 'a'.repeat(64),
            state: 'RECEIVED',
            outcome_code: null,
          } as Row],
          rowCount: 1,
        }
      }
      if (sql.startsWith('SELECT event_row_id, event_id, payload_sha256, state')) {
        return {
          rows: options.existingReceipt ? [{
            event_row_id: options.existingReceipt.receiptId,
            event_id: options.existingReceipt.eventId,
            payload_sha256: options.existingReceipt.payloadSha256,
            state: options.existingReceipt.state,
            outcome_code: null,
          } as Row] : [],
          rowCount: options.existingReceipt ? 1 : 0,
        }
      }
      if (sql.startsWith('SELECT conflict_id, existing_payload_sha256')) {
        return {
          rows: options.conflictExists ? [{
            conflict_id: 'evtconf_native_test',
            existing_payload_sha256: 'b'.repeat(64),
            state: 'OPEN',
            occurrence_count: '1',
            version: '1',
          } as Row] : [],
          rowCount: options.conflictExists ? 1 : 0,
        }
      }
      if (sql.startsWith('INSERT INTO payment_provider_event_conflicts')) {
        return { rows: [{ conflict_id: 'evtconf_native_test' } as Row], rowCount: 1 }
      }
      if (sql.startsWith('UPDATE payment_provider_event_conflicts')) {
        return { rows: [{ conflict_id: 'evtconf_native_test' } as Row], rowCount: 1 }
      }
      if (sql.startsWith('SELECT payment_id, order_id')) {
        return {
          rows: [{
            payment_id: PAYMENT_ID,
            order_id: 'ord_native_test',
            customer_id: 'customer_native_test',
            provider: 'hyperswitch',
            merchant_id: MERCHANT,
            amount_minor: '2500',
            currency: 'USD',
            status: 'INITIATING',
            version: '1',
            provider_updated_at: null,
            created_at: CREATED_AT,
            updated_at: CREATED_AT,
          } as Row],
          rowCount: 1,
        }
      }
      if (sql.startsWith('SELECT order_id, customer_id')) {
        return {
          rows: [{
            order_id: 'ord_native_test',
            customer_id: 'customer_native_test',
            status: 'PENDING_PAYMENT',
            version: '1',
            currency: 'USD',
            total_minor: '2500',
            updated_at: CREATED_AT,
          } as Row],
          rowCount: 1,
        }
      }
      if (sql.startsWith('SELECT cycle_id, state')) return { rows: [], rowCount: 0 }
      if (sql.startsWith('UPDATE payments')) {
        return { rows: [{ payment_id: PAYMENT_ID } as Row], rowCount: 1 }
      }
      if (sql.startsWith('UPDATE orders')) {
        return { rows: [{ order_id: 'ord_native_test' } as Row], rowCount: 1 }
      }
      if (sql.startsWith('UPDATE payment_provider_events SET state')) {
        return {
          rows: [{
            event_row_id: 'evtrow_native_test',
            event_id: EVENT_ID,
            payload_sha256: 'a'.repeat(64),
            state: 'APPLIED',
            outcome_code: 'PAYMENT_STATUS_APPLIED_AND_ORDER_CONFIRMED',
          } as Row],
          rowCount: 1,
        }
      }
      throw new Error('Unexpected SQL in native payment webhook test: ' + sql)
    }) as W07WebhookPostgresClient['query'],
    release: vi.fn(),
  }
  const pool: W07WebhookPostgresPool = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(async () => client),
  }
  return { pool, client, calls }
}

describe('W07 native PostgreSQL payment_details webhook store', () => {
  it('does not claim mandate/refund events or open a connection for non-payment content', async () => {
    const { pool } = fixture()
    const input = await signedInput(JSON.stringify({
      event_id: EVENT_ID,
      event_type: 'refund_succeeded',
      merchant_id: MERCHANT,
      content: { type: 'refund_details', object: {} },
    }))
    await expect(receiveHyperswitchPaymentWebhookPostgres(pool, input)).resolves.toBeNull()
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects an invalid provider signature before opening a PostgreSQL transaction', async () => {
    const { pool } = fixture()
    const input = await signedInput()
    await expect(receiveHyperswitchPaymentWebhookPostgres(pool, {
      ...input,
      signatureHeader: '0'.repeat(128),
    })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('commits the payment status, order confirmation and provider receipt in one native transaction', async () => {
    const { pool, calls, client } = fixture()
    const input = await signedInput()
    const result = await receiveHyperswitchPaymentWebhookPostgres(pool, input, {
      now: () => new Date(NOW),
      createEventRowId: () => 'evtrow_native_test',
    })

    expect(result).toMatchObject({
      outcome: 'APPLIED',
      eventId: EVENT_ID,
      receiptId: 'evtrow_native_test',
      state: 'APPLIED',
    })
    expect(calls[0]?.sql).toBe('BEGIN')
    expect(calls.some((call) => call.sql.startsWith('UPDATE payments SET status'))).toBe(true)
    expect(calls.some((call) => call.sql.startsWith('UPDATE orders SET status'))).toBe(true)
    expect(calls.some((call) => call.sql.startsWith('UPDATE payment_provider_events SET state'))).toBe(true)
    expect(calls.at(-1)?.sql).toBe('COMMIT')
    expect(calls.every((call) => !call.sql.includes('?'))).toBe(true)
    expect(client.release).toHaveBeenCalledOnce()
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('returns a duplicate for a byte-identical terminal receipt without reapplying payment or order state', async () => {
    const { pool, calls } = fixture({
      existingReceipt: receipt('a'.repeat(64), 'APPLIED'),
    })
    const input = await signedInput()
    const result = await receiveHyperswitchPaymentWebhookPostgres(pool, input)

    expect(result).toMatchObject({ outcome: 'DUPLICATE', state: 'APPLIED' })
    expect(calls.some((call) => call.sql.startsWith('SELECT payment_id, order_id'))).toBe(false)
    expect(calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('records a changed payload hash as a conflict and preserves the first receipt', async () => {
    const { pool, calls } = fixture({
      existingReceipt: receipt('b'.repeat(64), 'APPLIED'),
    })
    const input = await signedInput()
    const result = await receiveHyperswitchPaymentWebhookPostgres(pool, input, {
      now: () => new Date(NOW),
      createConflictId: () => 'evtconf_native_test',
    })

    expect(result).toMatchObject({
      outcome: 'PAYLOAD_CONFLICT',
      receiptId: 'evtrow_native_test',
      conflictId: 'evtconf_native_test',
    })
    expect(calls.some((call) => call.sql.startsWith('INSERT INTO payment_provider_event_conflicts'))).toBe(true)
    expect(calls.some((call) => call.sql.startsWith('UPDATE payments'))).toBe(false)
    expect(calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('rolls back and fails closed when an in-transaction PostgreSQL command fails', async () => {
    const { pool, calls, client } = fixture()
    const input = await signedInput()
    const query = client.query as unknown as ReturnType<typeof vi.fn>
    query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values })
      if (sql === 'BEGIN') return { rows: [], rowCount: 0 }
      if (sql.startsWith('INSERT INTO payment_provider_events')) {
        return {
          rows: [{
            event_row_id: 'evtrow_native_test',
            event_id: EVENT_ID,
            payload_sha256: 'a'.repeat(64),
            state: 'RECEIVED',
            outcome_code: null,
          }],
          rowCount: 1,
        }
      }
      if (sql.startsWith('SELECT payment_id, order_id')) throw new Error('database unavailable')
      if (sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
      throw new Error('Unexpected SQL')
    })

    await expect(receiveHyperswitchPaymentWebhookPostgres(pool, input, {
      now: () => new Date(NOW),
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(calls.at(-1)?.sql).toBe('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })
})

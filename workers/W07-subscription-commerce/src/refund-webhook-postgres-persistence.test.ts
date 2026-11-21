import { describe, expect, it, vi } from 'vitest'
import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  persistHyperswitchRefundEnvelopePostgres,
  receiveHyperswitchRefundWebhookPostgres,
} from './refund-webhook-postgres-persistence.js'
import {
  parseHyperswitchWebhookEnvelope,
} from './hyperswitch-webhook-signature.js'

const MERCHANT = 'merchant_01'
const PAYMENT_ID = 'pay_' + 'a'.repeat(26)
const REFUND_ID = 'ref_' + 'b'.repeat(26)
const NOW = '2026-11-18T12:00:02.000Z'
const PROVIDER_UPDATED = '2026-11-18T12:00:01.000Z'
const SECRET = 'hyperswitch-refund-test-secret'

function refundBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event_id: 'evt_refund_' + 'c'.repeat(16),
    event_type: 'refund_succeeded',
    merchant_id: MERCHANT,
    timestamp: PROVIDER_UPDATED,
    content: {
      type: 'refund_details',
      object: {
        refund_id: REFUND_ID,
        payment_id: PAYMENT_ID,
        merchant_id: MERCHANT,
        amount: 300,
        currency: 'USD',
        status: 'succeeded',
        updated_at: PROVIDER_UPDATED,
        ...overrides,
      },
    },
  })
}

function asBody(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function envelope(body = refundBody()) {
  const rawBody = asBody(body)
  const value = parseHyperswitchWebhookEnvelope(rawBody, MERCHANT)
  if (!value) throw new Error('invalid test webhook envelope')
  return { rawBody, value }
}

async function sign(rawBody: ArrayBuffer, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, rawBody)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

type Receipt = {
  event_row_id: string
  event_id: string
  payload_sha256: string
  state: 'RECEIVED' | 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED'
  outcome_code: string | null
}
type Refund = {
  refund_id: string
  merchant_id: string
  customer_id: string
  order_id: string
  payment_id: string
  amount_minor: string
  currency: string
  status: 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REVIEW' | 'RECONCILIATION_REQUIRED'
  version: string
  provider_updated_at: string | null
}
type Conflict = {
  conflict_id: string
  existing_payload_sha256: string
  state: 'OPEN' | 'RESOLVED'
  occurrence_count: string
  version: string
}

function fakePool(options: {
  refund?: Partial<Refund> | null
  receipt?: Partial<Receipt> | null
  conflict?: Partial<Conflict> | null
  failSql?: string
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  let storedReceipt: Receipt | null = options.receipt ? {
    event_row_id: 'evtrow_existing',
    event_id: 'evt_refund_' + 'c'.repeat(16),
    payload_sha256: 'b'.repeat(64),
    state: 'APPLIED',
    outcome_code: null,
    ...options.receipt,
  } : null
  let storedRefund: Refund | null = options.refund === null ? null : {
    refund_id: REFUND_ID,
    merchant_id: MERCHANT,
    customer_id: 'customer_01',
    order_id: 'order_01',
    payment_id: PAYMENT_ID,
    amount_minor: '300',
    currency: 'USD',
    status: 'PENDING',
    version: '2',
    provider_updated_at: '2026-11-18T12:00:00.000000Z',
    ...options.refund,
  }
  let storedConflict: Conflict | null = options.conflict ? {
    conflict_id: 'evtconf_existing',
    existing_payload_sha256: 'b'.repeat(64),
    state: 'OPEN',
    occurrence_count: '1',
    version: '1',
    ...options.conflict,
  } : null

  const client = {
    async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.failSql && sql.includes(options.failSql)) throw new Error('postgres unavailable')

      if (sql.startsWith('INSERT INTO payment_provider_events')) {
        if (!storedReceipt) {
          storedReceipt = {
            event_row_id: String(values[0]),
            event_id: String(values[3]),
            payload_sha256: String(values[6]),
            state: 'RECEIVED',
            outcome_code: null,
          }
          return { rows: [{ ...storedReceipt }] as unknown as Row[] }
        }
        return { rows: [] as unknown as Row[] }
      }
      if (sql.startsWith('SELECT event_row_id, event_id, payload_sha256, state')) {
        return { rows: storedReceipt ? [{ ...storedReceipt }] as unknown as Row[] : [] as unknown as Row[] }
      }
      if (sql.startsWith('SELECT refund_id')) {
        return { rows: storedRefund ? [{
          ...storedRefund,
          provider_updated_at: storedRefund.provider_updated_at,
        }] as unknown as Row[] : [] as unknown as Row[] }
      }
      if (sql.startsWith('UPDATE refunds SET status')) {
        if (!storedRefund || Number(storedRefund.version) !== Number(values[4])) return { rows: [] as unknown as Row[] }
        storedRefund = {
          ...storedRefund,
          status: String(values[0]) as Refund['status'],
          provider_updated_at: String(values[1]),
          version: String(Number(storedRefund.version) + 1),
        }
        return { rows: [{ refund_id: storedRefund.refund_id }] as unknown as Row[] }
      }
      if (sql.startsWith('UPDATE payment_provider_events SET state')) {
        if (!storedReceipt || storedReceipt.state !== 'RECEIVED') return { rows: [] as unknown as Row[] }
        storedReceipt = {
          ...storedReceipt,
          state: String(values[0]) as Receipt['state'],
          outcome_code: values[2] === null ? null : String(values[2]),
        }
        return { rows: [{ ...storedReceipt }] as unknown as Row[] }
      }
      if (sql.startsWith('SELECT conflict_id')) {
        return { rows: storedConflict ? [{ ...storedConflict }] as unknown as Row[] : [] as unknown as Row[] }
      }
      if (sql.startsWith('INSERT INTO payment_provider_event_conflicts')) {
        if (!storedConflict) {
          storedConflict = {
            conflict_id: String(values[0]),
            existing_payload_sha256: String(values[4]),
            state: 'OPEN',
            occurrence_count: '1',
            version: '1',
          }
          return { rows: [{ conflict_id: storedConflict.conflict_id }] as unknown as Row[] }
        }
        return { rows: [] as unknown as Row[] }
      }
      if (sql.startsWith('UPDATE payment_provider_event_conflicts')) {
        if (!storedConflict) return { rows: [] as unknown as Row[] }
        storedConflict = {
          ...storedConflict,
          occurrence_count: String(Number(storedConflict.occurrence_count) + 1),
          version: String(Number(storedConflict.version) + 1),
        }
        return { rows: [{ conflict_id: storedConflict.conflict_id }] as unknown as Row[] }
      }
      return { rows: [] as unknown as Row[] }
    },
    release: vi.fn(),
  } as unknown as W07WebhookPostgresClient
  const pool = { query: vi.fn(), connect: vi.fn(async () => client) } as unknown as W07WebhookPostgresPool
  return { pool, calls, client, get receipt() { return storedReceipt }, get refund() { return storedRefund }, get conflict() { return storedConflict } }
}

const dependencies = {
  now: () => new Date(NOW),
  createEventRowId: () => 'evtrow_test',
  createConflictId: () => 'evtconf_test',
}
const PAYLOAD_HASH = 'a'.repeat(64)

describe('W07 native PostgreSQL Hyperswitch refund webhook', () => {
  it('applies a matching refund and receipt in one transaction with version CAS', async () => {
    const parsed = envelope()
    const fake = fakePool()
    const result = await persistHyperswitchRefundEnvelopePostgres(
      fake.pool, parsed.value, PAYLOAD_HASH, dependencies,
    )
    expect(result).toMatchObject({
      outcome: 'APPLIED',
      state: 'APPLIED',
      eventId: parsed.value.eventId,
      receiptId: 'evtrow_test',
      payloadSha256: PAYLOAD_HASH,
    })
    expect(fake.calls[0]?.sql).toBe('BEGIN')
    const update = fake.calls.find(call => call.sql.startsWith('UPDATE refunds SET status'))
    expect(update?.values).toEqual([
      'SUCCEEDED', PROVIDER_UPDATED, NOW, REFUND_ID, 2, MERCHANT, PAYMENT_ID, 300, 'USD',
    ])
    expect(fake.receipt?.state).toBe('APPLIED')
    expect(fake.refund?.version).toBe('3')
    expect(fake.calls.at(-1)?.sql).toBe('COMMIT')
    expect(fake.client.release).toHaveBeenCalledOnce()
  })

  it('records an unknown refund as reconciliation without updating financial state', async () => {
    const parsed = envelope()
    const fake = fakePool({ refund: null })
    const result = await persistHyperswitchRefundEnvelopePostgres(
      fake.pool, parsed.value, PAYLOAD_HASH, dependencies,
    )
    expect(result).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED' })
    expect(fake.calls.some(call => call.sql.startsWith('UPDATE refunds SET status'))).toBe(false)
    expect(fake.receipt?.outcome_code).toBe('UNKNOWN_LOCAL_REFUND')
  })

  it('does not apply mismatched amount or stale provider timestamps', async () => {
    const mismatch = envelope(refundBody({ amount: 301 }))
    const mismatchPool = fakePool()
    const mismatchResult = await persistHyperswitchRefundEnvelopePostgres(
      mismatchPool.pool, mismatch.value, PAYLOAD_HASH, dependencies,
    )
    expect(mismatchResult.outcome).toBe('RECONCILIATION_REQUIRED')
    expect(mismatchPool.calls.some(call => call.sql.startsWith('UPDATE refunds SET status'))).toBe(false)

    const stale = envelope(refundBody({ updated_at: '2026-11-18T11:59:59.000Z' }))
    const stalePool = fakePool()
    const staleResult = await persistHyperswitchRefundEnvelopePostgres(
      stalePool.pool, stale.value, PAYLOAD_HASH, dependencies,
    )
    expect(staleResult.outcome).toBe('RECONCILIATION_REQUIRED')
    expect(stalePool.calls.some(call => call.sql.startsWith('UPDATE refunds SET status'))).toBe(false)
  })

  it('returns duplicates for an identical event and records changed payloads as conflicts', async () => {
    const parsed = envelope()
    const duplicatePool = fakePool({
      receipt: { payload_sha256: PAYLOAD_HASH, state: 'APPLIED' },
    })
    const duplicate = await persistHyperswitchRefundEnvelopePostgres(
      duplicatePool.pool, parsed.value, PAYLOAD_HASH, dependencies,
    )
    expect(duplicate.outcome).toBe('DUPLICATE')
    expect(duplicatePool.calls.some(call => call.sql.startsWith('SELECT refund_id'))).toBe(false)

    const conflictPool = fakePool({ receipt: { payload_sha256: 'b'.repeat(64), state: 'APPLIED' } })
    const conflict = await persistHyperswitchRefundEnvelopePostgres(
      conflictPool.pool, parsed.value, PAYLOAD_HASH, dependencies,
    )
    expect(conflict.outcome).toBe('PAYLOAD_CONFLICT')
    expect(conflict.conflictId).toBe('evtconf_test')
    expect(conflictPool.calls.some(call => call.sql.startsWith('INSERT INTO payment_provider_event_conflicts'))).toBe(true)
  })

  it('rolls back on PostgreSQL failure and releases the connection', async () => {
    const parsed = envelope()
    const fake = fakePool({ failSql: 'FROM refunds' })
    await expect(persistHyperswitchRefundEnvelopePostgres(
      fake.pool, parsed.value, PAYLOAD_HASH, dependencies,
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(fake.calls.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.client.release).toHaveBeenCalledOnce()
  })

  it('verifies raw HMAC before opening a PostgreSQL transaction and routes only refund_details', async () => {
    const rawBody = asBody(refundBody())
    const signatureHeader = await sign(rawBody)
    const fake = fakePool()
    const input = {
      rawBody,
      signatureHeader,
      webhookSecret: SECRET,
      expectedMerchantId: MERCHANT,
    }
    const result = await receiveHyperswitchRefundWebhookPostgres(fake.pool, input, dependencies)
    expect(result?.outcome).toBe('APPLIED')
    expect(fake.calls[0]?.sql).toBe('BEGIN')

    const invalid = fakePool()
    await expect(receiveHyperswitchRefundWebhookPostgres(invalid.pool, {
      ...input,
      signatureHeader: 'invalid',
    }, dependencies)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
    expect(invalid.pool.connect).not.toHaveBeenCalled()

    const nonRefund = fakePool()
    const nonRefundBody = asBody(JSON.stringify({
      event_id: 'evt_payment_01',
      event_type: 'payment_succeeded',
      merchant_id: MERCHANT,
      content: { type: 'payment_details', object: { payment_id: PAYMENT_ID } },
    }))
    await expect(receiveHyperswitchRefundWebhookPostgres(nonRefund.pool, {
      rawBody: nonRefundBody,
      signatureHeader: 'invalid',
      webhookSecret: SECRET,
      expectedMerchantId: MERCHANT,
    })).resolves.toBeNull()
    expect(nonRefund.pool.connect).not.toHaveBeenCalled()
  })
})

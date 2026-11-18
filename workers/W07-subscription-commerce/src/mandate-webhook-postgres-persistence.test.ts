import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  PaymentPersistenceError,
} from './payment-persistence.js'
import type {
  W07WebhookPostgresClient,
  W07WebhookPostgresPool,
} from './payment-webhook-database-postgres.js'
import {
  receiveHyperswitchMandateWebhookPostgres,
} from './mandate-webhook-postgres-persistence.js'

const SECRET = 'mandate-postgres-test-secret'
const MERCHANT = 'merchant_mandate_test'
const CUSTOMER = 'customer_mandate_test'
const METHOD_ID = 'pm_mandate_test'
const PAYMENT_ID = 'pay_' + 'a'.repeat(26)
const PROVIDER_MANDATE_ID = 'mandate_provider_test'
const MANDATE_ID = 'mnd_' + 'b'.repeat(26)
const NOW = '2026-11-18T10:30:00.000Z'
const PRIOR = '2026-11-18T10:00:00.000Z'
const ACTIVE_AT = '2026-11-18T10:29:00.000Z'
const REVOKED_AT = '2026-11-18T10:29:30.000Z'

type Receipt = {
  event_row_id: string
  event_id: string
  payload_sha256: string
  state: 'RECEIVED' | 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED'
  outcome_code: string | null
}
type Mandate = {
  mandate_record_id: string
  customer_id: string
  payment_method_id: string
  provider_mandate_id: string | null
  source_payment_id: string
  status: 'PENDING_PROVIDER_CONFIRMATION' | 'ACTIVE' | 'REVOKED' | 'FAILED' | 'EXPIRED'
  version: string
  provider_updated_at: string | null
  updated_at: string
}

function bytes(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text)
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
}

function fixture(options: { mandate?: Mandate | null; failOnMandateUpdate?: boolean; revocationExists?: boolean } = {}) {
  const initialMandate: Mandate = {
    mandate_record_id: MANDATE_ID,
    customer_id: CUSTOMER,
    payment_method_id: METHOD_ID,
    provider_mandate_id: null,
    source_payment_id: PAYMENT_ID,
    status: 'PENDING_PROVIDER_CONFIRMATION',
    version: '1',
    provider_updated_at: null,
    updated_at: PRIOR,
  }
  const state: {
    receipt: Receipt | null
    mandate: Mandate | null
    conflict: { conflict_id: string; existing_payload_sha256: string; state: 'OPEN' | 'RESOLVED'; occurrence_count: string; version: string } | null
    revocationCompleted: boolean
  } = {
    receipt: null,
    mandate: options.mandate === undefined ? initialMandate : options.mandate,
    conflict: null,
    revocationCompleted: false,
  }
  let snapshot: typeof state | null = null
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    if (sql === 'BEGIN') {
      snapshot = JSON.parse(JSON.stringify(state)) as typeof state
      return { rows: [], rowCount: 0 }
    }
    if (sql === 'COMMIT') {
      snapshot = null
      return { rows: [], rowCount: 0 }
    }
    if (sql === 'ROLLBACK') {
      if (snapshot) {
        state.receipt = snapshot.receipt
        state.mandate = snapshot.mandate
        state.conflict = snapshot.conflict
        state.revocationCompleted = snapshot.revocationCompleted
      }
      snapshot = null
      return { rows: [], rowCount: 0 }
    }
    if (sql.startsWith('INSERT INTO payment_provider_events')) {
      if (state.receipt) return { rows: [], rowCount: 0 }
      const [eventRowId, , , eventId, , , payloadHash] = values as string[]
      state.receipt = {
        event_row_id: eventRowId!,
        event_id: eventId!,
        payload_sha256: payloadHash!,
        state: 'RECEIVED',
        outcome_code: null,
      }
      return { rows: [state.receipt], rowCount: 1 }
    }
    if (sql.includes('FROM payment_provider_events WHERE provider = $1')) {
      return { rows: state.receipt ? [{ ...state.receipt }] : [], rowCount: state.receipt ? 1 : 0 }
    }
    if (sql.startsWith("UPDATE payment_provider_events SET state = 'RECEIVED'")) {
      const [, , eventId, hash] = values as string[]
      if (state.receipt?.event_id === eventId && state.receipt.payload_sha256 === hash &&
          state.receipt.state === 'RECONCILIATION_REQUIRED') {
        state.receipt.state = 'RECEIVED'
        state.receipt.outcome_code = null
        return { rows: [{ ...state.receipt }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }
    if (sql.startsWith('SELECT conflict_id, existing_payload_sha256')) {
      return { rows: state.conflict ? [{ ...state.conflict }] : [], rowCount: state.conflict ? 1 : 0 }
    }
    if (sql.startsWith('INSERT INTO payment_provider_event_conflicts')) {
      const [id, , , , existingHash] = values as string[]
      if (state.conflict) return { rows: [], rowCount: 0 }
      state.conflict = {
        conflict_id: id!,
        existing_payload_sha256: existingHash!,
        state: 'OPEN',
        occurrence_count: '1',
        version: '1',
      }
      return { rows: [{ conflict_id: id }], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE payment_provider_event_conflicts SET')) {
      if (!state.conflict) return { rows: [], rowCount: 0 }
      state.conflict.occurrence_count = String(Number(state.conflict.occurrence_count) + 1)
      state.conflict.version = String(Number(state.conflict.version) + 1)
      return { rows: [{ conflict_id: state.conflict.conflict_id }], rowCount: 1 }
    }
    if (sql.startsWith('SELECT mandate_record_id, customer_id')) {
      const [, , paymentMethodId, providerMandateId, sourcePaymentId] = values as string[]
      const mandate = state.mandate
      const matches = mandate && mandate.payment_method_id === paymentMethodId &&
        (mandate.provider_mandate_id === providerMandateId ||
          (mandate.provider_mandate_id === null && mandate.source_payment_id === sourcePaymentId))
      return { rows: matches ? [{ ...mandate }] : [], rowCount: matches ? 1 : 0 }
    }
    if (sql.startsWith('UPDATE payment_mandates SET provider_mandate_id')) {
      if (options.failOnMandateUpdate) throw new Error('forced mandate update failure')
      const [providerMandateId, status, providerUpdatedAt, updatedAt, mandateId, , , , methodId,
        version, oldStatus, eventId, hash] = values as string[]
      const mandate = state.mandate
      const event = state.receipt
      const matches = mandate && event && mandate.mandate_record_id === mandateId &&
        mandate.payment_method_id === methodId && mandate.version === version && mandate.status === oldStatus &&
        (mandate.provider_mandate_id === providerMandateId ||
          (mandate.provider_mandate_id === null && mandate.source_payment_id === values[7])) &&
        (!mandate.provider_updated_at || Date.parse(mandate.provider_updated_at) < Date.parse(providerUpdatedAt!)) &&
        event.event_id === eventId && event.payload_sha256 === hash && event.state === 'RECEIVED'
      if (!matches) return { rows: [], rowCount: 0 }
      mandate.provider_mandate_id ??= providerMandateId!
      mandate.status = status as Mandate['status']
      mandate.provider_updated_at = providerUpdatedAt!
      mandate.version = String(Number(mandate.version) + 1)
      mandate.updated_at = updatedAt!
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('UPDATE payment_method_revocation_requests SET status')) {
      state.revocationCompleted = options.revocationExists === true && state.mandate?.status === 'REVOKED'
      return { rows: [], rowCount: state.revocationCompleted ? 1 : 0 }
    }
    if (sql.startsWith('SELECT mandate_record_id FROM payment_mandates')) {
      const [id, , , providerMandateId, methodId, status, providerUpdatedAt] = values as string[]
      const mandate = state.mandate
      const matches = mandate && mandate.mandate_record_id === id &&
        mandate.provider_mandate_id === providerMandateId && mandate.payment_method_id === methodId &&
        mandate.status === status && mandate.provider_updated_at === providerUpdatedAt
      return { rows: matches ? [{ mandate_record_id: id }] : [], rowCount: matches ? 1 : 0 }
    }
    if (sql.startsWith('UPDATE payment_provider_events SET state = $1')) {
      const [status, , outcomeCode, , , eventId, hash] = values as string[]
      const receipt = state.receipt
      if (!receipt || receipt.event_id !== eventId || receipt.payload_sha256 !== hash ||
          receipt.state !== 'RECEIVED') return { rows: [], rowCount: 0 }
      receipt.state = status as Receipt['state']
      receipt.outcome_code = outcomeCode!
      return { rows: [{ ...receipt }], rowCount: 1 }
    }
    throw new Error('Unexpected SQL: ' + sql)
  })
  const client = {
    query,
    release: vi.fn(),
  } as unknown as W07WebhookPostgresClient
  const pool = {
    query: vi.fn(),
    connect: vi.fn(async () => client),
  } as unknown as W07WebhookPostgresPool
  return { pool, state, calls, query, client }
}

async function signedInput(options: {
  eventId?: string
  eventType?: 'mandate_active' | 'mandate_revoked'
  status?: 'active' | 'revoked'
  providerUpdatedAt?: string
  contentType?: string
  providerMandateId?: string
  paymentMethodId?: string
  paymentId?: string | null
  merchantId?: string
} = {}) {
  const eventType = options.eventType ?? 'mandate_active'
  const status = options.status ?? (eventType === 'mandate_active' ? 'active' : 'revoked')
  const body = JSON.stringify({
    event_id: options.eventId ?? 'evt_mandate_native_001',
    event_type: eventType,
    merchant_id: options.merchantId ?? MERCHANT,
    timestamp: NOW,
    content: {
      type: options.contentType ?? 'mandate_details',
      object: {
        mandate_id: options.providerMandateId ?? PROVIDER_MANDATE_ID,
        payment_method_id: options.paymentMethodId ?? METHOD_ID,
        status,
        payment_id: options.paymentId === undefined ? PAYMENT_ID : options.paymentId,
        updated_at: options.providerUpdatedAt ?? ACTIVE_AT,
      },
    },
  })
  const rawBody = bytes(body)
  const signature = createHmac('sha512', SECRET).update(new TextEncoder().encode(body)).digest('hex')
  return {
    rawBody,
    signatureHeader: signature,
    webhookSecret: SECRET,
    expectedMerchantId: MERCHANT,
  }
}

const dependencies = {
  now: () => new Date(NOW),
  createEventRowId: () => 'evtrow_mandate_native_001',
  createConflictId: () => 'evtconf_mandate-native-001',
}

describe('W07 native PostgreSQL Hyperswitch mandate webhook', () => {
  it('applies a signed mandate_active event with receipt and version CAS in one transaction', async () => {
    const f = fixture()
    const result = await receiveHyperswitchMandateWebhookPostgres(f.pool, await signedInput(), dependencies)
    expect(result).toMatchObject({ outcome: 'APPLIED', state: 'APPLIED', eventId: 'evt_mandate_native_001' })
    expect(f.state.mandate).toMatchObject({
      status: 'ACTIVE',
      provider_mandate_id: PROVIDER_MANDATE_ID,
      version: '2',
      provider_updated_at: ACTIVE_AT,
    })
    expect(f.state.receipt).toMatchObject({ state: 'APPLIED', outcome_code: 'MANDATE_STATUS_APPLIED' })
    expect(f.calls[0]?.sql).toBe('BEGIN')
    expect(f.calls.at(-1)?.sql).toBe('COMMIT')
    expect(f.client.release).toHaveBeenCalledOnce()
  })

  it('finishes a provider-deleted saved-method request only after the mandate becomes terminal', async () => {
    const mandate: Mandate = {
      mandate_record_id: MANDATE_ID,
      customer_id: CUSTOMER,
      payment_method_id: METHOD_ID,
      provider_mandate_id: PROVIDER_MANDATE_ID,
      source_payment_id: PAYMENT_ID,
      status: 'ACTIVE',
      version: '2',
      provider_updated_at: ACTIVE_AT,
      updated_at: ACTIVE_AT,
    }
    const f = fixture({ mandate, revocationExists: true })
    const result = await receiveHyperswitchMandateWebhookPostgres(
      f.pool,
      await signedInput({ eventId: 'evt_mandate_revoked', eventType: 'mandate_revoked', providerUpdatedAt: REVOKED_AT }),
      dependencies,
    )
    expect(result).toMatchObject({ outcome: 'APPLIED', state: 'APPLIED' })
    expect(f.state.mandate).toMatchObject({ status: 'REVOKED', version: '3' })
    expect(f.state.revocationCompleted).toBe(true)
    expect(f.calls.some((call) => call.sql.startsWith('UPDATE payment_method_revocation_requests SET status'))).toBe(true)
  })

  it('records a payload conflict without replacing the first event receipt', async () => {
    const f = fixture()
    const firstInput = await signedInput()
    const first = await receiveHyperswitchMandateWebhookPostgres(f.pool, firstInput, dependencies)
    const conflict = await receiveHyperswitchMandateWebhookPostgres(
      f.pool,
      await signedInput({ providerUpdatedAt: REVOKED_AT }),
      dependencies,
    )
    expect(first?.outcome).toBe('APPLIED')
    expect(conflict).toMatchObject({ outcome: 'PAYLOAD_CONFLICT', conflictId: 'evtconf_mandate-native-001' })
    expect(f.state.receipt).toMatchObject({
      state: 'APPLIED',
      payload_sha256: first?.payloadSha256,
    })
    expect(f.state.conflict?.existing_payload_sha256).toBe(first?.payloadSha256)
  })

  it('reopens the exact unresolved event after its local mandate source arrives', async () => {
    const f = fixture({ mandate: null })
    const input = await signedInput({ eventId: 'evt_mandate_waiting_for_source' })
    const pending = await receiveHyperswitchMandateWebhookPostgres(f.pool, input, dependencies)
    expect(pending).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED' })
    f.state.mandate = {
      mandate_record_id: MANDATE_ID,
      customer_id: CUSTOMER,
      payment_method_id: METHOD_ID,
      provider_mandate_id: null,
      source_payment_id: PAYMENT_ID,
      status: 'PENDING_PROVIDER_CONFIRMATION',
      version: '1',
      provider_updated_at: null,
      updated_at: PRIOR,
    }
    const replay = await receiveHyperswitchMandateWebhookPostgres(f.pool, input, dependencies)
    expect(replay).toMatchObject({ outcome: 'APPLIED', state: 'APPLIED', receiptId: 'evtrow_mandate_native_001' })
    expect(f.state.mandate?.status).toBe('ACTIVE')
    expect(f.state.receipt?.state).toBe('APPLIED')
  })

  it('rejects an invalid raw-body HMAC before opening a database connection', async () => {
    const f = fixture()
    const input = await signedInput()
    await expect(receiveHyperswitchMandateWebhookPostgres(
      f.pool, { ...input, signatureHeader: '0'.repeat(128) }, dependencies,
    )).rejects.toMatchObject({ code: 'INVALID_SIGNATURE', status: 401 })
    expect(f.pool.connect).not.toHaveBeenCalled()
  })

  it('rolls back the receipt when mandate state persistence fails', async () => {
    const f = fixture({ failOnMandateUpdate: true })
    await expect(receiveHyperswitchMandateWebhookPostgres(f.pool, await signedInput(), dependencies))
      .rejects.toBeInstanceOf(PaymentPersistenceError)
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK')
    expect(f.state.receipt).toBeNull()
    expect(f.state.mandate?.status).toBe('PENDING_PROVIDER_CONFIRMATION')
    expect(f.client.release).toHaveBeenCalledOnce()
  })

  it('returns null for unrelated Hyperswitch event families', async () => {
    const f = fixture()
    const input = await signedInput()
    const rawBody = bytes(JSON.stringify({
      event_id: 'evt_payment_other',
      event_type: 'payment_succeeded',
      merchant_id: MERCHANT,
      content: { type: 'payment_details', object: { payment_id: PAYMENT_ID } },
    }))
    expect(await receiveHyperswitchMandateWebhookPostgres(
      f.pool, { ...input, rawBody }, dependencies,
    )).toBeNull()
    expect(f.pool.connect).not.toHaveBeenCalled()
  })
})

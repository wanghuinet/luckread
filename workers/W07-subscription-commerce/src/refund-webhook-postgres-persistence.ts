import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  PaymentPersistenceError,
  type WebhookReceiptResult,
} from './payment-persistence.js'
import {
  parseHyperswitchRfc3339Timestamp,
  parseHyperswitchWebhookEnvelope,
  verifyHyperswitchWebhookSignature,
  type HyperswitchWebhookEnvelope,
} from './hyperswitch-webhook-signature.js'

const PROVIDER = 'hyperswitch'
const REFUND_ID_PATTERN = /^ref_[A-Za-z0-9]{26}$/
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

type ReceiptRow = Readonly<{
  [key: string]: unknown
  event_row_id: string
  event_id: string
  payload_sha256: string
  state: 'RECEIVED' | 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED'
  outcome_code: string | null
}>

type RefundRow = Readonly<{
  [key: string]: unknown
  refund_id: string
  merchant_id: string
  customer_id: string
  order_id: string
  payment_id: string
  amount_minor: string | number
  currency: string
  status: 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REVIEW' | 'RECONCILIATION_REQUIRED'
  version: string | number
  provider_updated_at: string | null
}>

type ConflictRow = Readonly<{
  [key: string]: unknown
  conflict_id: string
  existing_payload_sha256: string
  state: 'OPEN' | 'RESOLVED'
  occurrence_count: string | number
  version: string | number
}>

export type HyperswitchRefundPostgresDependencies = Readonly<{
  now?: () => Date
  createEventRowId?: () => string
  createConflictId?: () => string
}>

function nonBlank(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function dateNow(now?: () => Date): string {
  const value = (now ?? (() => new Date()))()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return value.toISOString()
}

function safeInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) ? number : null
}

function resultFromReceipt(
  receipt: ReceiptRow,
  payloadHash: string,
  options: Readonly<{ duplicate?: boolean; conflictId?: string }> = {},
): WebhookReceiptResult {
  if (receipt.state === 'RECEIVED' && !options.conflictId) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)
  return {
    outcome: options.conflictId
      ? 'PAYLOAD_CONFLICT'
      : options.duplicate && receipt.state === 'APPLIED' ? 'DUPLICATE'
        : receipt.state === 'APPLIED' ? 'APPLIED'
          : receipt.state === 'REJECTED' ? 'REJECTED' : 'RECONCILIATION_REQUIRED',
    eventId: receipt.event_id,
    receiptId: receipt.event_row_id,
    state: receipt.state,
    payloadSha256: payloadHash,
    ...(options.conflictId ? { conflictId: options.conflictId } : {}),
  }
}

function isRefundCandidate(rawBody: ArrayBuffer): boolean {
  if (!(rawBody instanceof ArrayBuffer) || rawBody.byteLength < 2 ||
      rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) return false
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const content = (value as Record<string, unknown>).content
    return typeof content === 'object' && content !== null && !Array.isArray(content) &&
      (content as Record<string, unknown>).type === 'refund_details'
  } catch {
    return false
  }
}

async function readReceipt(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
): Promise<ReceiptRow | null> {
  const selected = await client.query<ReceiptRow>(
    'SELECT event_row_id, event_id, payload_sha256, state, outcome_code ' +
    'FROM payment_provider_events WHERE provider = $1 AND merchant_id = $2 AND event_id = $3 LIMIT 1 FOR UPDATE',
    [PROVIDER, envelope.merchantId, envelope.eventId],
  )
  return selected.rows[0] ?? null
}

async function writePayloadConflict(
  client: W07WebhookPostgresClient,
  firstReceipt: ReceiptRow,
  envelope: HyperswitchWebhookEnvelope,
  incomingHash: string,
  now: string,
  createId: () => string,
): Promise<string> {
  if (!HASH_PATTERN.test(firstReceipt.payload_sha256) || firstReceipt.payload_sha256 === incomingHash) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
  }

  let existing = (await client.query<ConflictRow>(
    'SELECT conflict_id, existing_payload_sha256, state, occurrence_count::text AS occurrence_count, ' +
    'version::text AS version FROM payment_provider_event_conflicts ' +
    'WHERE provider = $1 AND merchant_id = $2 AND event_id = $3 AND incoming_payload_sha256 = $4 ' +
    'LIMIT 1 FOR UPDATE',
    [PROVIDER, envelope.merchantId, envelope.eventId, incomingHash],
  )).rows[0]

  if (!existing) {
    const conflictId = createId()
    if (!/^evtconf_[A-Za-z0-9-]{1,247}$/.test(conflictId)) {
      throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
    }
    const inserted = await client.query<{ conflict_id: string }>(
      'INSERT INTO payment_provider_event_conflicts ' +
      '(conflict_id, provider, merchant_id, event_id, existing_payload_sha256, incoming_payload_sha256, ' +
      'state, occurrence_count, version, first_seen_at, last_seen_at, resolved_at, resolution_code) ' +
      "VALUES ($1,$2,$3,$4,$5,$6,'OPEN',1,1,$7::timestamptz,$7::timestamptz,NULL,NULL) " +
      'ON CONFLICT (provider,merchant_id,event_id,incoming_payload_sha256) DO NOTHING ' +
      'RETURNING conflict_id',
      [
        conflictId, PROVIDER, envelope.merchantId, envelope.eventId,
        firstReceipt.payload_sha256, incomingHash, now,
      ],
    )
    if (inserted.rows[0]) return inserted.rows[0].conflict_id

    // A concurrent observation inserted the same conflict identity. Re-read it
    // under lock and increment exactly once for this delivery.
    existing = (await client.query<ConflictRow>(
      'SELECT conflict_id, existing_payload_sha256, state, occurrence_count::text AS occurrence_count, ' +
      'version::text AS version FROM payment_provider_event_conflicts ' +
      'WHERE provider = $1 AND merchant_id = $2 AND event_id = $3 AND incoming_payload_sha256 = $4 ' +
      'LIMIT 1 FOR UPDATE',
      [PROVIDER, envelope.merchantId, envelope.eventId, incomingHash],
    )).rows[0]
  }

  if (!existing || existing.existing_payload_sha256 !== firstReceipt.payload_sha256) {
    throw new PaymentPersistenceError('CONFLICT', 409)
  }
  if (existing.state === 'RESOLVED') return existing.conflict_id

  const occurrenceCount = safeInteger(existing.occurrence_count)
  const version = safeInteger(existing.version)
  if (occurrenceCount === null || version === null) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  const updated = await client.query<{ conflict_id: string }>(
    'UPDATE payment_provider_event_conflicts SET occurrence_count = occurrence_count + 1, ' +
    'version = version + 1, last_seen_at = GREATEST(last_seen_at + INTERVAL \'1 millisecond\', $1::timestamptz) ' +
    'WHERE conflict_id = $2 AND state = \'OPEN\' AND version = $3 AND occurrence_count = $4 ' +
    'RETURNING conflict_id',
    [now, existing.conflict_id, version, occurrenceCount],
  )
  if (!updated.rows[0]) throw new PaymentPersistenceError('CONFLICT', 409)
  return updated.rows[0].conflict_id
}

async function finalizeReceipt(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
  payloadHash: string,
  state: 'APPLIED' | 'RECONCILIATION_REQUIRED',
  outcomeCode: string | null,
  now: string,
): Promise<ReceiptRow> {
  const updated = await client.query<ReceiptRow>(
    'UPDATE payment_provider_events SET state = $1, processed_at = $2::timestamptz, outcome_code = $3 ' +
    'WHERE provider = $4 AND merchant_id = $5 AND event_id = $6 AND payload_sha256 = $7 AND state = \'RECEIVED\' ' +
    'RETURNING event_row_id, event_id, payload_sha256, state, outcome_code',
    [state, now, outcomeCode, PROVIDER, envelope.merchantId, envelope.eventId, payloadHash],
  )
  if (updated.rows[0]) return updated.rows[0]
  const receipt = await readReceipt(client, envelope)
  if (!receipt || receipt.state === 'RECEIVED') {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
  if (receipt.payload_sha256 !== payloadHash) {
    throw new PaymentPersistenceError('CONFLICT', 409)
  }
  return receipt
}

async function processRefundInTransaction(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
  payloadHash: string,
  now: string,
  eventRowId: string,
  createConflictId: () => string,
): Promise<WebhookReceiptResult> {
  const inserted = await client.query<ReceiptRow>(
    'INSERT INTO payment_provider_events ' +
    '(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code) ' +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,'RECEIVED',$8::timestamptz,NULL,NULL) " +
    'ON CONFLICT (provider,merchant_id,event_id) DO NOTHING ' +
    'RETURNING event_row_id,event_id,payload_sha256,state,outcome_code',
    [
      eventRowId, PROVIDER, envelope.merchantId, envelope.eventId, envelope.eventType,
      typeof envelope.resource.payment_id === 'string' && PAYMENT_ID_PATTERN.test(envelope.resource.payment_id)
        ? envelope.resource.payment_id : null,
      payloadHash, now,
    ],
  )
  const receipt = inserted.rows[0] ?? await readReceipt(client, envelope)
  if (!receipt) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)

  if (receipt.payload_sha256 !== payloadHash) {
    const conflictId = await writePayloadConflict(
      client, receipt, envelope, payloadHash, now, createConflictId,
    )
    return resultFromReceipt(receipt, payloadHash, { conflictId })
  }
  if (receipt.state !== 'RECEIVED') {
    return resultFromReceipt(receipt, payloadHash, { duplicate: true })
  }

  const resource = envelope.resource
  const refundId = resource.refund_id
  const paymentId = resource.payment_id
  const amount = safeInteger(resource.amount)
  const currency = resource.currency
  const rawStatus = resource.status
  const rawUpdated = resource.updated_at ?? resource.updated
  const expectedStatus = envelope.eventType === 'refund_succeeded' ? 'SUCCEEDED'
    : envelope.eventType === 'refund_failed' ? 'FAILED'
      : envelope.eventType === 'refund_review' ? 'REVIEW' : null
  const providerUpdatedMillis = typeof rawUpdated === 'string'
    ? parseHyperswitchRfc3339Timestamp(rawUpdated)
    : null

  if (
    expectedStatus === null ||
    typeof refundId !== 'string' || !REFUND_ID_PATTERN.test(refundId) ||
    typeof paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(paymentId) ||
    amount === null || amount <= 0 ||
    typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency) ||
    rawStatus !== expectedStatus.toLowerCase() ||
    providerUpdatedMillis === null ||
    (resource.merchant_id !== undefined && resource.merchant_id !== envelope.merchantId)
  ) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED',
      'REFUND_EVENT_SHAPE_OR_SEMANTICS_INVALID', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const providerUpdatedAt = new Date(providerUpdatedMillis).toISOString()
  const selected = await client.query<RefundRow>(
    'SELECT refund_id, merchant_id, customer_id, order_id, payment_id, amount_minor::text AS amount_minor, ' +
    'currency, status, version::text AS version, ' +
    'CASE WHEN provider_updated_at IS NULL THEN NULL ELSE ' +
    'to_char(provider_updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') END AS provider_updated_at ' +
    'FROM refunds WHERE refund_id = $1 AND provider = $2 LIMIT 1 FOR UPDATE',
    [refundId, PROVIDER],
  )
  const refund = selected.rows[0]
  if (!refund) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'UNKNOWN_LOCAL_REFUND', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const amountMinor = safeInteger(refund.amount_minor)
  const version = safeInteger(refund.version)
  if (
    refund.merchant_id !== envelope.merchantId ||
    refund.payment_id !== paymentId ||
    amountMinor !== amount ||
    refund.currency !== currency ||
    version === null
  ) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED',
      'REFUND_IDENTITY_OR_AMOUNT_MISMATCH', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const previousUpdatedMillis = refund.provider_updated_at === null
    ? null
    : parseHyperswitchRfc3339Timestamp(refund.provider_updated_at)
  if ((previousUpdatedMillis === null && refund.provider_updated_at !== null) ||
      (previousUpdatedMillis !== null && providerUpdatedMillis <= previousUpdatedMillis)) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED',
      'STALE_OR_INVALID_REFUND_TIMESTAMP', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const terminal = refund.status === 'SUCCEEDED' || refund.status === 'FAILED'
  if (terminal && refund.status !== expectedStatus) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED',
      'TERMINAL_REFUND_STATUS_CONFLICT', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const updated = await client.query<{ refund_id: string }>(
    'UPDATE refunds SET status = $1, provider_updated_at = $2::timestamptz, outcome_code = NULL, ' +
    'version = version + 1, updated_at = GREATEST(updated_at + INTERVAL \'1 millisecond\', $3::timestamptz) ' +
    'WHERE refund_id = $4 AND version = $5 AND merchant_id = $6 AND payment_id = $7 ' +
    'AND amount_minor = $8 AND currency = $9 ' +
    'AND (provider_updated_at IS NULL OR provider_updated_at < $2::timestamptz) ' +
    'RETURNING refund_id',
    [expectedStatus, providerUpdatedAt, now, refund.refund_id, version, envelope.merchantId, paymentId, amount, currency],
  )
  const stored = updated.rows[0]
    ? await finalizeReceipt(client, envelope, payloadHash, 'APPLIED', null, now)
    : await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'REFUND_VERSION_CAS_MISMATCH', now,
    )
  return resultFromReceipt(stored, payloadHash)
}

export async function persistHyperswitchRefundEnvelopePostgres(
  pool: W07WebhookPostgresPool,
  envelope: HyperswitchWebhookEnvelope,
  payloadHash: string,
  dependencies: HyperswitchRefundPostgresDependencies = {},
): Promise<WebhookReceiptResult> {
  if (!HASH_PATTERN.test(payloadHash) || envelope.contentType !== 'refund_details') {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  const now = dateNow(dependencies.now)
  const eventRowId = (dependencies.createEventRowId ?? (() => 'evtrow_' + crypto.randomUUID()))()
  if (!nonBlank(eventRowId, 255)) throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)

  const client = await pool.connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true
    const result = await processRefundInTransaction(
      client, envelope, payloadHash, now, eventRowId,
      dependencies.createConflictId ?? (() => 'evtconf_' + crypto.randomUUID()),
    )
    await client.query('COMMIT')
    transactionOpen = false
    return result
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK') } catch { /* preserve original failure */ }
    }
    if (error instanceof PaymentPersistenceError) throw error
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client.release()
  }
}

/**
 * Native PostgreSQL path for refund_details only. Other Hyperswitch webhook
 * event families return null and continue through their existing adapters.
 */
export async function receiveHyperswitchRefundWebhookPostgres(
  pool: W07WebhookPostgresPool,
  input: Readonly<{
    rawBody: ArrayBuffer
    signatureHeader: string | null | undefined
    webhookSecret: string | null | undefined
    expectedMerchantId: string
  }>,
  dependencies: HyperswitchRefundPostgresDependencies = {},
): Promise<WebhookReceiptResult | null> {
  if (!isRefundCandidate(input.rawBody)) return null
  if (!(input.rawBody instanceof ArrayBuffer) || input.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400)
  }
  const validSignature = await verifyHyperswitchWebhookSignature(
    input.rawBody, input.signatureHeader, input.webhookSecret,
  )
  if (!validSignature) throw new PaymentPersistenceError('INVALID_SIGNATURE', 401)
  const envelope = parseHyperswitchWebhookEnvelope(input.rawBody, input.expectedMerchantId)
  if (!envelope || envelope.contentType !== 'refund_details') {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400)
  }
  if (!nonBlank(envelope.eventId, 255) || !nonBlank(envelope.merchantId, 256)) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400)
  }
  let payloadHash: string
  try {
    payloadHash = await sha256BytesToHex(new Uint8Array(input.rawBody))
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
  return persistHyperswitchRefundEnvelopePostgres(pool, envelope, payloadHash, dependencies)
}

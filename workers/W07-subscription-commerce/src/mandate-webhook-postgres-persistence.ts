import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  PaymentPersistenceError,
  type WebhookReceiptResult,
} from './payment-persistence.js'
import {
  parseHyperswitchWebhookEnvelope,
  verifyHyperswitchWebhookSignature,
  type HyperswitchWebhookEnvelope,
} from './hyperswitch-webhook-signature.js'

const PROVIDER = 'hyperswitch'
const EVENT_TYPES = new Set(['mandate_active', 'mandate_revoked'])
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

type ReceiptRow = Readonly<{
  event_row_id: string
  event_id: string
  payload_sha256: string
  state: 'RECEIVED' | 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED'
  outcome_code: string | null
}>

type MandateRow = Readonly<{
  mandate_record_id: string
  customer_id: string
  payment_method_id: string
  provider_mandate_id: string | null
  source_payment_id: string
  status: 'PENDING_PROVIDER_CONFIRMATION' | 'ACTIVE' | 'REVOKED' | 'FAILED' | 'EXPIRED'
  version: string | number
  provider_updated_at: string | null
  updated_at: string
}>

type ConflictRow = Readonly<{
  conflict_id: string
  existing_payload_sha256: string
  state: 'OPEN' | 'RESOLVED'
  occurrence_count: string | number
  version: string | number
}>

export type HyperswitchMandatePostgresDependencies = Readonly<{
  now?: () => Date
  createEventRowId?: () => string
  createConflictId?: () => string
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonBlank(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function safeInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) ? number : null
}

function isMandateCandidate(rawBody: ArrayBuffer): boolean {
  if (!(rawBody instanceof ArrayBuffer) || rawBody.byteLength < 2 ||
      rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) return false
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
    return isRecord(parsed) && EVENT_TYPES.has(String(parsed.event_type))
  } catch {
    return false
  }
}

function dateNow(now?: () => Date): string {
  const value = (now ?? (() => new Date()))()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return value.toISOString()
}

function strictlyAfter(now: string, previous: string): string {
  const nowMillis = Date.parse(now)
  const previousMillis = Date.parse(previous)
  if (!Number.isFinite(nowMillis) || !Number.isFinite(previousMillis)) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return new Date(Math.max(nowMillis, previousMillis + 1)).toISOString()
}

function defaultEventRowId(): string {
  return 'evtrow_' + crypto.randomUUID()
}

function defaultConflictId(): string {
  return 'evtconf_' + crypto.randomUUID()
}

function resultFromReceipt(
  receipt: ReceiptRow,
  payloadHash: string,
  options: Readonly<{ duplicate?: boolean; conflictId?: string }> = {},
): WebhookReceiptResult {
  if (receipt.state === 'RECEIVED' && !options.conflictId) {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
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

async function readReceipt(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
): Promise<ReceiptRow | null> {
  const selected = await client.query<ReceiptRow>(
    'SELECT event_row_id, event_id, payload_sha256, state, outcome_code ' +
    'FROM payment_provider_events WHERE provider = $1 AND merchant_id = $2 AND event_id = $3 ' +
    'LIMIT 1 FOR UPDATE',
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
      [conflictId, PROVIDER, envelope.merchantId, envelope.eventId,
        firstReceipt.payload_sha256, incomingHash, now],
    )
    if (inserted.rows[0]) return inserted.rows[0].conflict_id

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
    "version = version + 1, last_seen_at = GREATEST(last_seen_at + INTERVAL '1 millisecond', $1::timestamptz) " +
    "WHERE conflict_id = $2 AND state = 'OPEN' AND version = $3 AND occurrence_count = $4 " +
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
  outcomeCode: string,
  now: string,
): Promise<ReceiptRow> {
  const updated = await client.query<ReceiptRow>(
    'UPDATE payment_provider_events SET state = $1, processed_at = $2::timestamptz, outcome_code = $3 ' +
    "WHERE provider = $4 AND merchant_id = $5 AND event_id = $6 AND payload_sha256 = $7 AND state = 'RECEIVED' " +
    'RETURNING event_row_id, event_id, payload_sha256, state, outcome_code',
    [state, now, outcomeCode, PROVIDER, envelope.merchantId, envelope.eventId, payloadHash],
  )
  if (updated.rows[0]) return updated.rows[0]
  const receipt = await readReceipt(client, envelope)
  if (!receipt || receipt.state === 'RECEIVED') {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
  if (receipt.payload_sha256 !== payloadHash) throw new PaymentPersistenceError('CONFLICT', 409)
  return receipt
}

async function selectMandate(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
  paymentMethodId: string,
  providerMandateId: string,
  sourcePaymentId: string | null,
): Promise<MandateRow | null> {
  const selected = await client.query<MandateRow>(
    'SELECT mandate_record_id, customer_id, payment_method_id, provider_mandate_id, source_payment_id, ' +
    'status, version::text AS version, ' +
    'CASE WHEN provider_updated_at IS NULL THEN NULL ELSE ' +
    'to_char(provider_updated_at AT TIME ZONE \\'UTC\\', \\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\\') END AS provider_updated_at, ' +
    'to_char(updated_at AT TIME ZONE \\'UTC\\', \\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\\') AS updated_at ' +
    'FROM payment_mandates WHERE provider = $1 AND merchant_id = $2 AND payment_method_id = $3 ' +
    'AND (provider_mandate_id = $4 OR (provider_mandate_id IS NULL AND source_payment_id = $5)) ' +
    'LIMIT 1 FOR UPDATE',
    [PROVIDER, envelope.merchantId, paymentMethodId, providerMandateId, sourcePaymentId ?? ''],
  )
  return selected.rows[0] ?? null
}

async function completePaymentMethodRevocation(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
  customerId: string,
  paymentMethodId: string,
  now: string,
): Promise<void> {
  await client.query(
    "UPDATE payment_method_revocation_requests SET status = 'COMPLETED', version = version + 1, " +
    "updated_at = GREATEST(updated_at + INTERVAL '1 millisecond', $1::timestamptz) " +
    "WHERE provider = 'hyperswitch' AND merchant_id = $2 AND customer_id = $3 " +
    "AND status IN ('REQUESTED','PENDING_PROVIDER','RECONCILIATION_REQUIRED') " +
    'AND provider_method_deleted_at IS NOT NULL ' +
    'AND EXISTS (SELECT 1 FROM saved_payment_methods s ' +
    'WHERE s.saved_payment_method_id = payment_method_revocation_requests.saved_payment_method_id ' +
    "AND s.provider = 'hyperswitch' AND s.merchant_id = $2 AND s.customer_id = $3 AND s.payment_method_id = $4) " +
    'AND NOT EXISTS (SELECT 1 FROM payment_mandates m JOIN saved_payment_methods s ' +
    'ON s.provider = m.provider AND s.merchant_id = m.merchant_id AND s.customer_id = m.customer_id ' +
    'AND s.payment_method_id = m.payment_method_id ' +
    'WHERE s.saved_payment_method_id = payment_method_revocation_requests.saved_payment_method_id ' +
    "AND m.status NOT IN ('REVOKED','FAILED','EXPIRED'))",
    [now, envelope.merchantId, customerId, paymentMethodId],
  )
}

async function applyMandate(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
  mandate: MandateRow,
  providerMandateId: string,
  paymentMethodId: string,
  expectedStatus: 'ACTIVE' | 'REVOKED',
  providerUpdatedAt: string,
  now: string,
  payloadHash: string,
): Promise<boolean> {
  const updatedAt = strictlyAfter(now, mandate.updated_at)
  await client.query(
    'UPDATE payment_mandates SET provider_mandate_id = COALESCE(provider_mandate_id, $1), status = $2, ' +
    'provider_updated_at = $3::timestamptz, version = version + 1, ' +
    "updated_at = GREATEST(updated_at + INTERVAL '1 millisecond', $4::timestamptz) " +
    'WHERE mandate_record_id = $5 AND provider = $6 AND merchant_id = $7 ' +
    'AND (provider_mandate_id = $1 OR (provider_mandate_id IS NULL AND source_payment_id = $8)) ' +
    'AND payment_method_id = $9 AND version = $10 AND status = $11 ' +
    'AND (provider_updated_at IS NULL OR provider_updated_at < $3::timestamptz) ' +
    "AND (($2 = 'ACTIVE' AND status IN ('PENDING_PROVIDER_CONFIRMATION','ACTIVE')) " +
    "OR ($2 = 'REVOKED' AND status IN ('PENDING_PROVIDER_CONFIRMATION','ACTIVE','REVOKED'))) " +
    "AND EXISTS (SELECT 1 FROM payment_provider_events e WHERE e.provider = $6 AND e.merchant_id = $7 " +
    "AND e.event_id = $12 AND e.payload_sha256 = $13 AND e.state = 'RECEIVED')",
    [providerMandateId, expectedStatus, providerUpdatedAt, updatedAt, mandate.mandate_record_id,
      PROVIDER, envelope.merchantId, mandate.source_payment_id, paymentMethodId, mandate.version,
      mandate.status, envelope.eventId, payloadHash],
  )

  if (expectedStatus === 'REVOKED') {
    await completePaymentMethodRevocation(client, envelope, mandate.customer_id, paymentMethodId, now)
  }

  const current = await client.query<{ mandate_record_id: string }>(
    'SELECT mandate_record_id FROM payment_mandates WHERE mandate_record_id = $1 ' +
    'AND provider = $2 AND merchant_id = $3 AND provider_mandate_id = $4 ' +
    'AND payment_method_id = $5 AND status = $6 AND provider_updated_at = $7::timestamptz LIMIT 1',
    [mandate.mandate_record_id, PROVIDER, envelope.merchantId, providerMandateId,
      paymentMethodId, expectedStatus, providerUpdatedAt],
  )
  return Boolean(current.rows[0])
}

async function processMandateEnvelope(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
  payloadHash: string,
  now: string,
  eventRowId: string,
  dependencies: HyperswitchMandatePostgresDependencies,
): Promise<WebhookReceiptResult> {
  const resourcePaymentValue = envelope.resource.payment_id
  const sourcePaymentId = typeof resourcePaymentValue === 'string' && PAYMENT_ID_PATTERN.test(resourcePaymentValue)
    ? resourcePaymentValue : null
  const invalidSourcePaymentId = resourcePaymentValue !== undefined &&
    resourcePaymentValue !== null && sourcePaymentId === null
  const inserted = await client.query<ReceiptRow>(
    'INSERT INTO payment_provider_events ' +
    '(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code) ' +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,'RECEIVED',$8::timestamptz,NULL,NULL) " +
    'ON CONFLICT (provider,merchant_id,event_id) DO NOTHING ' +
    'RETURNING event_row_id,event_id,payload_sha256,state,outcome_code',
    [eventRowId, PROVIDER, envelope.merchantId, envelope.eventId, envelope.eventType,
      sourcePaymentId, payloadHash, now],
  )
  let receipt = inserted.rows[0] ?? await readReceipt(client, envelope)
  if (!receipt) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)

  if (receipt.payload_sha256 !== payloadHash) {
    const conflictId = await writePayloadConflict(
      client, receipt, envelope, payloadHash, now,
      dependencies.createConflictId ?? defaultConflictId,
    )
    return resultFromReceipt(receipt, payloadHash, { conflictId })
  }

  if (receipt.state === 'APPLIED' || receipt.state === 'REJECTED') {
    return resultFromReceipt(receipt, payloadHash, { duplicate: true })
  }

  if (receipt.state === 'RECONCILIATION_REQUIRED') {
    const reopened = await client.query<ReceiptRow>(
      "UPDATE payment_provider_events SET state = 'RECEIVED', processed_at = NULL, outcome_code = NULL " +
      'WHERE provider = $1 AND merchant_id = $2 AND event_id = $3 AND payload_sha256 = $4 ' +
      "AND event_type IN ('mandate_active','mandate_revoked') AND state = 'RECONCILIATION_REQUIRED' " +
      'RETURNING event_row_id,event_id,payload_sha256,state,outcome_code',
      [PROVIDER, envelope.merchantId, envelope.eventId, payloadHash],
    )
    receipt = reopened.rows[0] ?? await readReceipt(client, envelope)
    if (!receipt) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)
    if (receipt.payload_sha256 !== payloadHash) {
      throw new PaymentPersistenceError('CONFLICT', 409)
    }
    if (receipt.state !== 'RECEIVED') {
      return resultFromReceipt(receipt, payloadHash, { duplicate: true })
    }
  }

  if (envelope.contentType !== 'mandate_details') {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED',
      'MANDATE_EVENT_CONTENT_TYPE_MISMATCH', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const expectedStatus = envelope.eventType === 'mandate_active'
    ? 'ACTIVE'
    : envelope.eventType === 'mandate_revoked' ? 'REVOKED' : null
  const providerMandateId = envelope.resource.mandate_id
  const paymentMethodId = envelope.resource.payment_method_id
  const providerStatus = envelope.resource.status
  if (
    expectedStatus === null ||
    !nonBlank(providerMandateId, 255) ||
    !nonBlank(paymentMethodId, 255) ||
    !/^[\x21-\x7e]{1,255}$/.test(paymentMethodId) ||
    invalidSourcePaymentId ||
    (providerStatus !== 'active' && providerStatus !== 'revoked') ||
    providerStatus !== expectedStatus.toLowerCase() ||
    (envelope.resource.merchant_id !== undefined && envelope.resource.merchant_id !== envelope.merchantId)
  ) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'MANDATE_RESOURCE_MISMATCH', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const resourceUpdatedAt = envelope.resource.updated_at ?? envelope.resource.modified_at ?? envelope.resource.updated
  const providerEventAt = typeof resourceUpdatedAt === 'string' ? resourceUpdatedAt : envelope.timestamp
  if (typeof providerEventAt !== 'string' || !Number.isFinite(Date.parse(providerEventAt))) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'MANDATE_PROVIDER_TIMESTAMP_MISSING', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }
  const providerUpdatedAt = new Date(Date.parse(providerEventAt)).toISOString()

  const mandate = await selectMandate(
    client, envelope, paymentMethodId, providerMandateId, sourcePaymentId,
  )
  if (!mandate) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'UNKNOWN_LOCAL_MANDATE', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const applied = await applyMandate(
    client, envelope, mandate, providerMandateId, paymentMethodId,
    expectedStatus, providerUpdatedAt, now, payloadHash,
  )
  const stored = await finalizeReceipt(
    client, envelope, payloadHash,
    applied ? 'APPLIED' : 'RECONCILIATION_REQUIRED',
    applied ? 'MANDATE_STATUS_APPLIED' : 'MANDATE_STATUS_CAS_LOST_OR_OUT_OF_ORDER',
    now,
  )
  return resultFromReceipt(stored, payloadHash)
}

async function persistMandateEnvelopePostgres(
  pool: W07WebhookPostgresPool,
  envelope: HyperswitchWebhookEnvelope,
  payloadHash: string,
  dependencies: HyperswitchMandatePostgresDependencies,
): Promise<WebhookReceiptResult> {
  if (!HASH_PATTERN.test(payloadHash) || !EVENT_TYPES.has(envelope.eventType)) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  const now = dateNow(dependencies.now)
  const eventRowId = (dependencies.createEventRowId ?? defaultEventRowId)()
  if (!nonBlank(eventRowId, 255)) throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)

  const client = await pool.connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true
    const result = await processMandateEnvelope(client, envelope, payloadHash, now, eventRowId, dependencies)
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

/** Native PostgreSQL 18 transaction for signed mandate_active and mandate_revoked events. */
export async function receiveHyperswitchMandateWebhookPostgres(
  pool: W07WebhookPostgresPool,
  input: Readonly<{
    rawBody: ArrayBuffer
    signatureHeader: string | null | undefined
    webhookSecret: string | null | undefined
    expectedMerchantId: string
  }>,
  dependencies: HyperswitchMandatePostgresDependencies = {},
): Promise<WebhookReceiptResult | null> {
  if (!isMandateCandidate(input.rawBody)) return null
  if (!(input.rawBody instanceof ArrayBuffer) || input.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400)
  }
  const validSignature = await verifyHyperswitchWebhookSignature(
    input.rawBody, input.signatureHeader, input.webhookSecret,
  )
  if (!validSignature) throw new PaymentPersistenceError('INVALID_SIGNATURE', 401)

  const envelope = parseHyperswitchWebhookEnvelope(input.rawBody, input.expectedMerchantId)
  if (!envelope || !EVENT_TYPES.has(envelope.eventType)) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400)
  }
  if (!nonBlank(envelope.eventId, 255) || !nonBlank(envelope.merchantId, 256) ||
      !nonBlank(envelope.eventType, 96)) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400)
  }

  let payloadHash: string
  try {
    payloadHash = await sha256BytesToHex(new Uint8Array(input.rawBody))
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
  return persistMandateEnvelopePostgres(pool, envelope, payloadHash, dependencies)
}

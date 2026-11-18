import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  PaymentPersistenceError,
  type PaymentAttemptStatus,
  type WebhookReceiptResult,
} from './payment-persistence.js'
import {
  parseHyperswitchRfc3339Timestamp,
  parseHyperswitchWebhookEnvelope,
  verifyHyperswitchWebhookSignature,
  type HyperswitchWebhookEnvelope,
} from './hyperswitch-webhook-signature.js'
import { validateHyperswitchPaymentWebhook } from './hyperswitch-webhook-payment-validation.js'

const PROVIDER = 'hyperswitch'
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

type ReceiptRow = Readonly<{
  event_row_id: string
  event_id: string
  payload_sha256: string
  state: 'RECEIVED' | 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED'
  outcome_code: string | null
}>

type PaymentRow = Readonly<{
  payment_id: string
  order_id: string
  customer_id: string
  provider: string
  merchant_id: string
  amount_minor: string | number
  currency: string
  status: PaymentAttemptStatus
  version: string | number
  provider_updated_at: string | null
  created_at: string
  updated_at: string
}>

type OrderRow = Readonly<{
  order_id: string
  customer_id: string
  status: string
  version: string | number
  currency: string
  total_minor: string | number
  updated_at: string
}>

type RenewalCycleRow = Readonly<{
  cycle_id: string
  state: string
  version: string | number
  updated_at: string
}>

type ConflictRow = Readonly<{
  conflict_id: string
  existing_payload_sha256: string
  state: 'OPEN' | 'RESOLVED'
  occurrence_count: string | number
  version: string | number
}>

type VerifiedSetupConsent = Readonly<{
  paymentMethodId: string
  acceptedAt: string
  providerMandateId: string | null
}>

export type HyperswitchPaymentPostgresDependencies = Readonly<{
  now?: () => Date
  createEventRowId?: () => string
  createConflictId?: () => string
  createSavedPaymentMethodId?: () => string
  createPaymentMandateId?: () => string
}>

function nonBlank(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function safeInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) ? number : null
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

function defaultSavedPaymentMethodId(): string {
  return 'spm_' + crypto.randomUUID().replace(/-/g, '').slice(0, 26)
}

function defaultPaymentMandateId(): string {
  return 'mnd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 26)
}

function isPaymentCandidate(rawBody: ArrayBuffer): boolean {
  if (!(rawBody instanceof ArrayBuffer) || rawBody.byteLength < 2 ||
      rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) return false
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const content = (value as Record<string, unknown>).content
    return typeof content === 'object' && content !== null && !Array.isArray(content) &&
      (content as Record<string, unknown>).type === 'payment_details'
  } catch {
    return false
  }
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
  state: 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED',
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
  if (receipt.payload_sha256 !== payloadHash) throw new PaymentPersistenceError('CONFLICT', 409)
  return receipt
}

function providerStatusCanApply(current: PaymentAttemptStatus, next: PaymentAttemptStatus): boolean {
  const terminal = new Set<PaymentAttemptStatus>([
    'succeeded', 'failed', 'cancelled', 'cancelled_post_capture', 'expired',
  ])
  if (current === next) return true
  if (terminal.has(current)) return false

  const transitions: Partial<Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]>> = {
    INITIATING: ['processing', 'succeeded', 'failed', 'cancelled', 'cancelled_post_capture', 'expired'],
    requires_payment_method: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
    requires_confirmation: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
    requires_customer_action: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
    requires_merchant_action: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
    requires_capture: ['processing', 'succeeded', 'failed', 'cancelled_post_capture', 'expired'],
    processing: ['succeeded', 'failed', 'cancelled', 'cancelled_post_capture', 'expired'],
    partially_captured: ['processing', 'failed', 'cancelled_post_capture', 'expired'],
    partially_captured_and_capturable: ['processing', 'succeeded', 'failed', 'cancelled_post_capture', 'expired'],
  }
  return (transitions[current] ?? []).includes(next)
}

function readVerifiedSetupConsent(
  resource: Record<string, unknown>,
  payment: PaymentRow,
  eventType: string,
  now: string,
): VerifiedSetupConsent | null {
  if (
    eventType !== 'payment_succeeded' ||
    resource.payment_id !== payment.payment_id ||
    resource.merchant_id !== payment.merchant_id ||
    resource.customer_id !== payment.customer_id ||
    resource.amount !== safeInteger(payment.amount_minor) ||
    resource.currency !== payment.currency ||
    resource.status !== 'succeeded' ||
    typeof resource.payment_method_id !== 'string' ||
    !nonBlank(resource.payment_method_id, 255) ||
    !/^[\x21-\x7e]{1,255}$/.test(resource.payment_method_id)
  ) return null

  const mandateData = resource.mandate_data
  if (typeof mandateData !== 'object' || mandateData === null || Array.isArray(mandateData)) return null
  const mandate = mandateData as Record<string, unknown>
  const acceptance = mandate.customer_acceptance
  if (typeof acceptance !== 'object' || acceptance === null || Array.isArray(acceptance)) return null
  const accepted = acceptance as Record<string, unknown>
  if (
    (accepted.acceptance_type !== undefined && accepted.acceptance_type !== 'online') ||
    typeof accepted.accepted_at !== 'string'
  ) return null
  const online = accepted.online
  if (typeof online !== 'object' || online === null || Array.isArray(online)) return null
  const onlineFacts = online as Record<string, unknown>
  if (
    typeof onlineFacts.ip_address !== 'string' || !nonBlank(onlineFacts.ip_address, 128) ||
    typeof onlineFacts.user_agent !== 'string' || !nonBlank(onlineFacts.user_agent, 1024)
  ) return null

  const acceptedMillis = parseHyperswitchRfc3339Timestamp(accepted.accepted_at)
  const paymentCreatedMillis = Date.parse(payment.created_at)
  const nowMillis = Date.parse(now)
  if (
    acceptedMillis === null || !Number.isFinite(paymentCreatedMillis) || !Number.isFinite(nowMillis) ||
    acceptedMillis < paymentCreatedMillis || acceptedMillis > nowMillis
  ) return null

  let providerMandateId: string | null = null
  if (resource.mandate_id !== undefined && resource.mandate_id !== null) {
    if (!nonBlank(resource.mandate_id, 255)) return null
    providerMandateId = resource.mandate_id
  }
  return {
    paymentMethodId: resource.payment_method_id,
    acceptedAt: new Date(acceptedMillis).toISOString(),
    providerMandateId,
  }
}

async function selectPayment(
  client: W07WebhookPostgresClient,
  paymentId: string,
): Promise<PaymentRow | null> {
  const selected = await client.query<PaymentRow>(
    'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor::text AS amount_minor, ' +
    'currency, status, version::text AS version, ' +
    'CASE WHEN provider_updated_at IS NULL THEN NULL ELSE ' +
    'to_char(provider_updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') END AS provider_updated_at, ' +
    'to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS created_at, ' +
    'to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at ' +
    'FROM payments WHERE provider = $1 AND payment_id = $2 LIMIT 1 FOR UPDATE',
    [PROVIDER, paymentId],
  )
  return selected.rows[0] ?? null
}

async function selectOrder(
  client: W07WebhookPostgresClient,
  payment: PaymentRow,
): Promise<OrderRow | null> {
  const selected = await client.query<OrderRow>(
    'SELECT order_id, customer_id, status, version::text AS version, currency, total_minor::text AS total_minor, ' +
    'to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at ' +
    'FROM orders WHERE order_id = $1 AND customer_id = $2 LIMIT 1 FOR UPDATE',
    [payment.order_id, payment.customer_id],
  )
  return selected.rows[0] ?? null
}

async function insertVerifiedConsent(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
  payment: PaymentRow,
  setupConsent: VerifiedSetupConsent,
  now: string,
  dependencies: HyperswitchPaymentPostgresDependencies,
): Promise<void> {
  const savedPaymentMethodId = (dependencies.createSavedPaymentMethodId ?? defaultSavedPaymentMethodId)()
  const mandateRecordId = (dependencies.createPaymentMandateId ?? defaultPaymentMandateId)()
  if (!/^spm_[A-Za-z0-9]{26}$/.test(savedPaymentMethodId) || !/^mnd_[A-Za-z0-9]{26}$/.test(mandateRecordId)) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
  }

  await client.query(
    'INSERT INTO saved_payment_methods ' +
    '(saved_payment_method_id, provider, merchant_id, customer_id, payment_method_id, source_payment_id, source_event_id, created_at) ' +
    "VALUES ($1,'hyperswitch',$2,$3,$4,$5,$6,$7::timestamptz) " +
    'ON CONFLICT (provider,merchant_id,payment_method_id) DO NOTHING',
    [savedPaymentMethodId, payment.merchant_id, payment.customer_id, setupConsent.paymentMethodId,
      payment.payment_id, envelope.eventId, now],
  )
  await client.query(
    'INSERT INTO payment_mandates ' +
    '(mandate_record_id, provider, merchant_id, customer_id, payment_method_id, source_payment_id, source_event_id, ' +
    'consent_accepted_at, consent_acceptance_type, consent_scope, consent_terms_version, provider_mandate_id, ' +
    'status, version, provider_updated_at, created_at, updated_at) ' +
    "VALUES ($1,'hyperswitch',$2,$3,$4,$5,$6,$7::timestamptz,'online','OFF_SESSION_RECURRING', " +
    "'luckread-recurring-consent-v1',$8,'PENDING_PROVIDER_CONFIRMATION',1,NULL,$9::timestamptz,$9::timestamptz) " +
    'ON CONFLICT (provider,merchant_id,source_payment_id) DO NOTHING',
    [mandateRecordId, payment.merchant_id, payment.customer_id, setupConsent.paymentMethodId,
      payment.payment_id, envelope.eventId, setupConsent.acceptedAt, setupConsent.providerMandateId, now],
  )
}

async function processPaymentEnvelope(
  client: W07WebhookPostgresClient,
  envelope: HyperswitchWebhookEnvelope,
  payloadHash: string,
  now: string,
  eventRowId: string,
  dependencies: HyperswitchPaymentPostgresDependencies,
): Promise<WebhookReceiptResult> {
  const paymentIdValue = envelope.resource.payment_id
  const paymentId = typeof paymentIdValue === 'string' && PAYMENT_ID_PATTERN.test(paymentIdValue)
    ? paymentIdValue : null
  const inserted = await client.query<ReceiptRow>(
    'INSERT INTO payment_provider_events ' +
    '(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code) ' +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,'RECEIVED',$8::timestamptz,NULL,NULL) " +
    'ON CONFLICT (provider,merchant_id,event_id) DO NOTHING ' +
    'RETURNING event_row_id,event_id,payload_sha256,state,outcome_code',
    [eventRowId, PROVIDER, envelope.merchantId, envelope.eventId, envelope.eventType,
      paymentId, payloadHash, now],
  )
  const receipt = inserted.rows[0] ?? await readReceipt(client, envelope)
  if (!receipt) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503)

  if (receipt.payload_sha256 !== payloadHash) {
    const conflictId = await writePayloadConflict(
      client, receipt, envelope, payloadHash, now,
      dependencies.createConflictId ?? defaultConflictId,
    )
    return resultFromReceipt(receipt, payloadHash, { conflictId })
  }
  if (receipt.state !== 'RECEIVED') {
    return resultFromReceipt(receipt, payloadHash, { duplicate: true })
  }

  if (!paymentId) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'INVALID_PROVIDER_PAYMENT_ID', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const payment = await selectPayment(client, paymentId)
  if (!payment) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'UNKNOWN_LOCAL_PAYMENT', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  const amountMinor = safeInteger(payment.amount_minor)
  const paymentVersion = safeInteger(payment.version)
  if (amountMinor === null || paymentVersion === null) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  const decision = validateHyperswitchPaymentWebhook(envelope, {
    paymentId: payment.payment_id,
    merchantId: payment.merchant_id,
    amountMinor,
    currency: payment.currency,
    lastProviderUpdatedAt: payment.provider_updated_at,
  })
  if (decision.outcome === 'REJECT') {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'REJECTED', 'VALIDATION_' + decision.reason, now,
    )
    return resultFromReceipt(stored, payloadHash)
  }
  if (decision.outcome === 'STALE') {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'STALE_PROVIDER_TIMESTAMP', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }
  if (decision.outcome === 'RECONCILIATION_REQUIRED') {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'VALIDATION_' + decision.reason, now,
    )
    return resultFromReceipt(stored, payloadHash)
  }
  if (!providerStatusCanApply(payment.status, decision.providerStatus)) {
    const stored = await finalizeReceipt(
      client, envelope, payloadHash, 'RECONCILIATION_REQUIRED', 'FORBIDDEN_PAYMENT_TRANSITION', now,
    )
    return resultFromReceipt(stored, payloadHash)
  }

  let order: OrderRow | null = null
  if (decision.providerStatus === 'succeeded') order = await selectOrder(client, payment)
  const paymentUpdatedAt = strictlyAfter(now, payment.updated_at)
  const providerUpdatedAt = new Date(Date.parse(decision.providerUpdatedAt)).toISOString()
  const paymentUpdate = await client.query<{ payment_id: string }>(
    'UPDATE payments SET status = $1, version = version + 1, provider_updated_at = $2::timestamptz, ' +
    'updated_at = GREATEST(updated_at + INTERVAL \'1 millisecond\', $3::timestamptz) ' +
    'WHERE payment_id = $4 AND provider = $5 AND merchant_id = $6 AND amount_minor = $7 AND currency = $8 ' +
    'AND version = $9 AND status = $10 AND (provider_updated_at IS NULL OR provider_updated_at < $2::timestamptz) ' +
    'AND EXISTS (SELECT 1 FROM payment_provider_events e WHERE e.provider = $11 AND e.merchant_id = $12 ' +
    'AND e.event_id = $13 AND e.payload_sha256 = $14 AND e.state = \'RECEIVED\') RETURNING payment_id',
    [decision.providerStatus, providerUpdatedAt, paymentUpdatedAt, payment.payment_id, PROVIDER,
      payment.merchant_id, amountMinor, payment.currency, paymentVersion, payment.status,
      PROVIDER, envelope.merchantId, envelope.eventId, payloadHash],
  )
  const paymentApplied = Boolean(paymentUpdate.rows[0])

  const allowedOrderStatuses = ['CREATED', 'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'COMPLETED']
  const orderMatches = Boolean(order &&
    order.order_id === payment.order_id &&
    order.customer_id === payment.customer_id &&
    order.currency === payment.currency &&
    safeInteger(order.total_minor) === amountMinor)
  let orderApplied = false

  if (decision.providerStatus === 'succeeded' && paymentApplied && order && orderMatches) {
    if (order.status === 'CREATED' || order.status === 'PENDING_PAYMENT') {
      const orderUpdatedAt = strictlyAfter(now, order.updated_at)
      const confirmed = await client.query<{ order_id: string }>(
        "UPDATE orders SET status = 'CONFIRMED', version = version + 1, confirmed_at = $1::timestamptz, " +
        "updated_at = GREATEST(updated_at + INTERVAL '1 millisecond', $1::timestamptz) " +
        'WHERE order_id = $2 AND customer_id = $3 AND currency = $4 AND total_minor = $5 ' +
        'AND status = $6 AND version = $7 ' +
        'AND EXISTS (SELECT 1 FROM payments p WHERE p.payment_id = $8 AND p.order_id = orders.order_id ' +
        'AND p.customer_id = orders.customer_id AND p.provider = $9 AND p.status = \'succeeded\' ' +
        'AND p.provider_updated_at = $10::timestamptz) ' +
        'AND EXISTS (SELECT 1 FROM payment_provider_events e WHERE e.provider = $9 AND e.merchant_id = $11 ' +
        'AND e.event_id = $12 AND e.payload_sha256 = $13 AND e.state = \'RECEIVED\') RETURNING order_id',
        [orderUpdatedAt, order.order_id, order.customer_id, order.currency, amountMinor,
          order.status, safeInteger(order.version), payment.payment_id, PROVIDER, providerUpdatedAt,
          envelope.merchantId, envelope.eventId, payloadHash],
      )
      orderApplied = Boolean(confirmed.rows[0])
    } else {
      orderApplied = allowedOrderStatuses.includes(order.status)
    }
  }

  const setupConsent = decision.providerStatus === 'succeeded'
    ? readVerifiedSetupConsent(envelope.resource, payment, envelope.eventType, now)
    : null
  if (paymentApplied && setupConsent) {
    await insertVerifiedConsent(client, envelope, payment, setupConsent, now, dependencies)
  }

  const renewalCycleTarget: 'SUCCEEDED' | 'FAILED' | 'RECONCILIATION_REQUIRED' | null =
    decision.providerStatus === 'succeeded'
      ? (orderMatches && allowedOrderStatuses.includes(order?.status ?? '') ? 'SUCCEEDED' : 'RECONCILIATION_REQUIRED')
      : ['failed', 'cancelled', 'expired'].includes(decision.providerStatus)
        ? 'FAILED'
        : decision.providerStatus === 'cancelled_post_capture'
          ? 'RECONCILIATION_REQUIRED'
          : null

  let renewalCycleRequired = false
  let renewalCycleApplied = false
  if (renewalCycleTarget !== null) {
    const selectedCycle = await client.query<RenewalCycleRow>(
      'SELECT cycle_id, state, version::text AS version, ' +
      'to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at ' +
      'FROM subscription_renewal_cycles WHERE payment_id = $1 AND provider = $2 AND merchant_id = $3 ' +
      'LIMIT 1 FOR UPDATE',
      [payment.payment_id, PROVIDER, payment.merchant_id],
    )
    const cycle = selectedCycle.rows[0]
    if (cycle && (cycle.state === 'SUBMITTING' || cycle.state === 'SUBMITTED')) {
      renewalCycleRequired = true
      const cycleVersion = safeInteger(cycle.version)
      if (cycleVersion === null) throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500)
      const cycleUpdatedAt = strictlyAfter(now, cycle.updated_at)
      const renewalOutcomeCode = renewalCycleTarget === 'RECONCILIATION_REQUIRED'
        ? (decision.providerStatus === 'succeeded'
          ? 'SUCCEEDED_PAYMENT_ORDER_BINDING_REQUIRED'
          : 'POST_CAPTURE_CANCELLATION_REQUIRES_RECONCILIATION')
        : null
      const cycleUpdate = await client.query<{ cycle_id: string }>(
        'UPDATE subscription_renewal_cycles SET state = $1, provider_response_status = $2, outcome_code = $3, ' +
        'lease_token = NULL, lease_expires_at = NULL, version = version + 1, updated_at = $4::timestamptz ' +
        'WHERE cycle_id = $5 AND version = $6 AND state = $7 ' +
        'AND EXISTS (SELECT 1 FROM payments p WHERE p.payment_id = $8 AND p.provider = $9 ' +
        'AND p.merchant_id = $10 AND p.status = $2 AND p.provider_updated_at = $11::timestamptz) ' +
        'AND EXISTS (SELECT 1 FROM payment_provider_events e WHERE e.provider = $9 AND e.merchant_id = $12 ' +
        'AND e.event_id = $13 AND e.payload_sha256 = $14 AND e.state = \'RECEIVED\') RETURNING cycle_id',
        [renewalCycleTarget, decision.providerStatus, renewalOutcomeCode, cycleUpdatedAt,
          cycle.cycle_id, cycleVersion, cycle.state, payment.payment_id, PROVIDER,
          payment.merchant_id, providerUpdatedAt, envelope.merchantId, envelope.eventId, payloadHash],
      )
      renewalCycleApplied = Boolean(cycleUpdate.rows[0])
    }
  }

  const eventApplied = paymentApplied &&
    (decision.providerStatus !== 'succeeded' || orderApplied) &&
    (!renewalCycleRequired || renewalCycleApplied)
  const outcomeCode = !paymentApplied
    ? 'PAYMENT_STATUS_CAS_LOST'
    : decision.providerStatus === 'succeeded' && !orderApplied
      ? 'ORDER_CONFIRMATION_REQUIRED'
      : renewalCycleRequired && !renewalCycleApplied
        ? 'RENEWAL_CYCLE_OUTCOME_CAS_LOST'
        : decision.providerStatus === 'succeeded'
          ? 'PAYMENT_STATUS_APPLIED_AND_ORDER_CONFIRMED'
          : 'PAYMENT_STATUS_APPLIED'

  if (eventApplied && paymentApplied && decision.providerStatus === 'succeeded' && orderApplied) {
    // Nothing else is required here; Order and Payment are already in this transaction.
  }
  const stored = await finalizeReceipt(
    client, envelope, payloadHash,
    eventApplied ? 'APPLIED' : 'RECONCILIATION_REQUIRED',
    eventApplied ? outcomeCode : outcomeCode,
    now,
  )
  return resultFromReceipt(stored, payloadHash)
}

async function persistPaymentEnvelopePostgres(
  pool: W07WebhookPostgresPool,
  envelope: HyperswitchWebhookEnvelope,
  payloadHash: string,
  dependencies: HyperswitchPaymentPostgresDependencies,
): Promise<WebhookReceiptResult> {
  if (!HASH_PATTERN.test(payloadHash) || envelope.contentType !== 'payment_details') {
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
    const result = await processPaymentEnvelope(client, envelope, payloadHash, now, eventRowId, dependencies)
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
 * Native PostgreSQL transaction path for payment_details. Other event families
 * return null so the existing mandate compatibility path remains isolated.
 */
export async function receiveHyperswitchPaymentWebhookPostgres(
  pool: W07WebhookPostgresPool,
  input: Readonly<{
    rawBody: ArrayBuffer
    signatureHeader: string | null | undefined
    webhookSecret: string | null | undefined
    expectedMerchantId: string
  }>,
  dependencies: HyperswitchPaymentPostgresDependencies = {},
): Promise<WebhookReceiptResult | null> {
  if (!isPaymentCandidate(input.rawBody)) return null
  if (!(input.rawBody instanceof ArrayBuffer) || input.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400)
  }
  const validSignature = await verifyHyperswitchWebhookSignature(
    input.rawBody, input.signatureHeader, input.webhookSecret,
  )
  if (!validSignature) throw new PaymentPersistenceError('INVALID_SIGNATURE', 401)

  const envelope = parseHyperswitchWebhookEnvelope(input.rawBody, input.expectedMerchantId)
  if (!envelope || envelope.contentType !== 'payment_details') {
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
  return persistPaymentEnvelopePostgres(pool, envelope, payloadHash, dependencies)
}

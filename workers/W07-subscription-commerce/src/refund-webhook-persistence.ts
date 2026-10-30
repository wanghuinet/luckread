/// <reference types="@cloudflare/workers-types" />

import type { HyperswitchWebhookEnvelope } from './hyperswitch-webhook-signature.js';
import { parseHyperswitchRfc3339Timestamp } from './hyperswitch-webhook-signature.js';

type RefundState = 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REVIEW' | 'RECONCILIATION_REQUIRED';

type RefundRow = Readonly<{
  refund_id: string;
  merchant_id: string;
  customer_id: string;
  order_id: string;
  payment_id: string;
  amount_minor: number;
  currency: string;
  status: RefundState;
  version: number;
  provider_updated_at: string | null;
}>;

export type RefundWebhookReceipt = Readonly<{
  outcome: 'APPLIED' | 'RECONCILIATION_REQUIRED';
  eventId: string;
  receiptId: string;
  state: 'APPLIED' | 'RECONCILIATION_REQUIRED';
  payloadSha256: string;
}>;

export type RefundWebhookDependencies = Readonly<{
  now?: () => Date;
  createEventRowId?: () => string;
}>;

const PROVIDER = 'hyperswitch';
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function fail(code: 'WEBHOOK_REJECTED' | 'SERVICE_UNAVAILABLE' | 'INTEGRITY_VIOLATION'): never {
  throw new Error(code);
}

function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function dateNow(now?: () => Date): string {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail('INTEGRITY_VIOLATION');
  return value.toISOString();
}

function defaultEventRowId(): string {
  return 'evtrow_' + crypto.randomUUID();
}

/**
 * Process a refund_details event only after the shared raw-body HMAC signature,
 * merchant and provider-event deduplication checks have succeeded.
 *
 * D1-04 stores only normalized refund facts and the event hash. The signed body
 * and provider credentials are never persisted. This routine never changes
 * payment state, ledger facts, subscription state or entitlements.
 */
export async function persistHyperswitchRefundWebhook(
  db: D1Database,
  envelope: HyperswitchWebhookEnvelope,
  payloadSha256: string,
  dependencies: RefundWebhookDependencies = {},
): Promise<RefundWebhookReceipt> {
  if (!HASH_PATTERN.test(payloadSha256)) fail('INTEGRITY_VIOLATION');
  const now = dateNow(dependencies.now);
  const eventRowId = (dependencies.createEventRowId ?? defaultEventRowId)();
  if (!validText(eventRowId, 255)) fail('INTEGRITY_VIOLATION');

  const resource = envelope.resource;
  const rawRefundId = resource.refund_id;
  const rawPaymentId = resource.payment_id;
  const rawAmount = resource.amount;
  const rawCurrency = resource.currency;
  const rawStatus = resource.status;
  const rawUpdated = resource.updated_at ?? resource.updated;
  const expectedState = envelope.eventType === 'refund_succeeded' ? 'SUCCEEDED'
    : envelope.eventType === 'refund_failed' ? 'FAILED'
      : envelope.eventType === 'refund_review' ? 'REVIEW' : null;

  if (
    envelope.contentType !== 'refund_details' ||
    !expectedState ||
    typeof rawRefundId !== 'string' || !/^ref_[A-Za-z0-9]{26}$/.test(rawRefundId) ||
    typeof rawPaymentId !== 'string' || !PAYMENT_ID_PATTERN.test(rawPaymentId) ||
    typeof rawAmount !== 'number' || !Number.isSafeInteger(rawAmount) || rawAmount <= 0 ||
    typeof rawCurrency !== 'string' || !CURRENCY_PATTERN.test(rawCurrency) ||
    rawStatus !== expectedState.toLowerCase() ||
    typeof rawUpdated !== 'string' ||
    parseHyperswitchRfc3339Timestamp(rawUpdated) === null ||
    (resource.merchant_id !== undefined && resource.merchant_id !== envelope.merchantId)
  ) {
    return persistRefundReceiptOnly(db, envelope, payloadSha256, eventRowId, now,
      'RECONCILIATION_REQUIRED', 'REFUND_EVENT_SHAPE_OR_SEMANTICS_INVALID');
  }

  let refund: RefundRow | null;
  try {
    refund = await db.prepare(
      'SELECT refund_id, merchant_id, customer_id, order_id, payment_id, amount_minor, currency, ' +
      'status, version, provider_updated_at FROM refunds WHERE refund_id = ? AND provider = ? LIMIT 1',
    ).bind(rawRefundId, PROVIDER).first<RefundRow>();
  } catch {
    fail('SERVICE_UNAVAILABLE');
  }

  if (!refund ||
      refund.merchant_id !== envelope.merchantId ||
      refund.payment_id !== rawPaymentId ||
      refund.amount_minor !== rawAmount ||
      refund.currency !== rawCurrency) {
    return persistRefundReceiptOnly(db, envelope, payloadSha256, eventRowId, now,
      'RECONCILIATION_REQUIRED', refund ? 'REFUND_IDENTITY_OR_AMOUNT_MISMATCH' : 'UNKNOWN_LOCAL_REFUND');
  }

  const providerUpdated = parseHyperswitchRfc3339Timestamp(rawUpdated);
  const previousUpdated = refund.provider_updated_at === null
    ? null
    : parseHyperswitchRfc3339Timestamp(refund.provider_updated_at);
  if (providerUpdated === null || (refund.provider_updated_at !== null &&
      (previousUpdated === null || providerUpdated <= previousUpdated))) {
    return persistRefundReceiptOnly(db, envelope, payloadSha256, eventRowId, now,
      'RECONCILIATION_REQUIRED', 'STALE_OR_INVALID_REFUND_TIMESTAMP');
  }

  const isTerminal = refund.status === 'SUCCEEDED' || refund.status === 'FAILED';
  const validTransition = !isTerminal || refund.status === expectedState;
  if (!validTransition) {
    return persistRefundReceiptOnly(db, envelope, payloadSha256, eventRowId, now,
      'RECONCILIATION_REQUIRED', 'TERMINAL_REFUND_STATUS_CONFLICT');
  }

  const providerTime = new Date(providerUpdated).toISOString();
  const processedAt = now;
  try {
    await db.batch([
      db.prepare(
        'INSERT INTO payment_provider_events ' +
        '(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code) ' +
        "VALUES(?,?,?,?,?,?,?,'RECEIVED',?,NULL,NULL) " +
        'ON CONFLICT(provider,merchant_id,event_id) DO NOTHING',
      ).bind(
        eventRowId, PROVIDER, envelope.merchantId, envelope.eventId, envelope.eventType,
        rawPaymentId, payloadSha256, now,
      ),
      db.prepare(
        'UPDATE refunds SET status = ?, provider_updated_at = ?, outcome_code = NULL, ' +
        'version = version + 1, updated_at = ? WHERE refund_id = ? AND version = ? ' +
        'AND merchant_id = ? AND payment_id = ? AND amount_minor = ? AND currency = ?',
      ).bind(
        expectedState, providerTime, now, refund.refund_id, refund.version,
        envelope.merchantId, rawPaymentId, rawAmount, rawCurrency,
      ),
      db.prepare(
        'UPDATE payment_provider_events SET ' +
        "state = CASE WHEN EXISTS (SELECT 1 FROM refunds WHERE refund_id = ? AND version = ? AND status = ? AND provider_updated_at = ?) THEN 'APPLIED' ELSE 'RECONCILIATION_REQUIRED' END, " +
        'processed_at = ?, ' +
        "outcome_code = CASE WHEN EXISTS (SELECT 1 FROM refunds WHERE refund_id = ? AND version = ? AND status = ? AND provider_updated_at = ?) THEN NULL ELSE 'REFUND_VERSION_CAS_MISMATCH' END " +
        "WHERE provider = ? AND merchant_id = ? AND event_id = ? AND payload_sha256 = ? AND state = 'RECEIVED'",
      ).bind(
        refund.refund_id, refund.version + 1, expectedState, providerTime,
        processedAt, refund.refund_id, refund.version + 1, expectedState, providerTime,
        PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256,
      ),
    ]);
  } catch {
    fail('SERVICE_UNAVAILABLE');
  }

  const receipt = await db.prepare(
    'SELECT event_row_id, state, outcome_code FROM payment_provider_events ' +
    'WHERE provider = ? AND merchant_id = ? AND event_id = ? AND payload_sha256 = ? LIMIT 1',
  ).bind(PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256).first<{
    event_row_id: string; state: 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED' | 'RECEIVED'; outcome_code: string | null;
  }>();
  if (!receipt || receipt.state === 'RECEIVED') fail('SERVICE_UNAVAILABLE');
  return {
    outcome: receipt.state === 'APPLIED' ? 'APPLIED' : 'RECONCILIATION_REQUIRED',
    eventId: envelope.eventId,
    receiptId: receipt.event_row_id,
    state: receipt.state === 'APPLIED' ? 'APPLIED' : 'RECONCILIATION_REQUIRED',
    payloadSha256,
  };
}

async function persistRefundReceiptOnly(
  db: D1Database,
  envelope: HyperswitchWebhookEnvelope,
  payloadSha256: string,
  eventRowId: string,
  now: string,
  state: 'RECONCILIATION_REQUIRED',
  outcomeCode: string,
): Promise<RefundWebhookReceipt> {
  const paymentId = typeof envelope.resource.payment_id === 'string' &&
    PAYMENT_ID_PATTERN.test(envelope.resource.payment_id) ? envelope.resource.payment_id : null;
  try {
    await db.batch([
      db.prepare(
        'INSERT INTO payment_provider_events ' +
        '(event_row_id,provider,merchant_id,event_id,event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code) ' +
        "VALUES(?,?,?,?,?,?,?,'RECEIVED',?,NULL,NULL) " +
        'ON CONFLICT(provider,merchant_id,event_id) DO NOTHING',
      ).bind(
        eventRowId, PROVIDER, envelope.merchantId, envelope.eventId, envelope.eventType,
        paymentId, payloadSha256, now,
      ),
      db.prepare(
        'UPDATE payment_provider_events SET state = ?, processed_at = ?, outcome_code = ? ' +
        "WHERE provider = ? AND merchant_id = ? AND event_id = ? AND payload_sha256 = ? AND state = 'RECEIVED'",
      ).bind(state, now, outcomeCode, PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256),
    ]);
  } catch {
    fail('SERVICE_UNAVAILABLE');
  }
  const receipt = await db.prepare(
    'SELECT event_row_id, state FROM payment_provider_events WHERE provider = ? AND merchant_id = ? AND event_id = ? LIMIT 1',
  ).bind(PROVIDER, envelope.merchantId, envelope.eventId).first<{
    event_row_id: string; state: 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED' | 'RECEIVED';
  }>();
  if (!receipt || receipt.state === 'RECEIVED') fail('SERVICE_UNAVAILABLE');
  return {
    outcome: receipt.state === 'APPLIED' ? 'APPLIED' : 'RECONCILIATION_REQUIRED',
    eventId: envelope.eventId,
    receiptId: receipt.event_row_id,
    state: receipt.state === 'APPLIED' ? 'APPLIED' : 'RECONCILIATION_REQUIRED',
    payloadSha256,
  };
}

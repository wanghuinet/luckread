/// <reference types="@cloudflare/workers-types" />

import {
  verifyHyperswitchWebhookSignature,
  parseHyperswitchWebhookEnvelope,
} from './hyperswitch-webhook-signature.js';
import type { HyperswitchPayment } from './hyperswitch-client.js';
import { validateHyperswitchPaymentWebhook } from './hyperswitch-webhook-payment-validation.js';

export type PaymentAttemptStatus =
  | 'INITIATING'
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_customer_action'
  | 'requires_merchant_action'
  | 'requires_capture'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'cancelled_post_capture'
  | 'partially_captured'
  | 'partially_captured_and_capturable'
  | 'expired';

export type PaymentAttemptDto = Readonly<{
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: PaymentAttemptStatus;
  version: number;
  providerUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PaymentPersistenceErrorCode =
  | 'VALIDATION_FAILED'
  | 'PRECONDITION_REQUIRED'
  | 'RESOURCE_NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
  | 'INVALID_SIGNATURE'
  | 'WEBHOOK_REJECTED'
  | 'INTEGRITY_VIOLATION'
  | 'SERVICE_UNAVAILABLE';

export class PaymentPersistenceError extends Error {
  constructor(
    readonly code: PaymentPersistenceErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = 'PaymentPersistenceError';
  }
}

type OrderRow = {
  order_id: string;
  customer_id: string;
  status: string;
  currency: string;
  total_minor: number;
};

type PaymentRow = {
  payment_id: string;
  order_id: string;
  customer_id: string;
  provider: string;
  merchant_id: string;
  amount_minor: number;
  currency: string;
  status: PaymentAttemptStatus;
  version: number;
  idempotency_key: string;
  request_hash: string;
  provider_updated_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
};

type ProviderEventRow = {
  event_row_id: string;
  provider: string;
  merchant_id: string;
  event_id: string;
  event_type: string;
  payment_id: string | null;
  payload_sha256: string;
  state: 'RECEIVED' | 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED';
  received_at: string;
  processed_at: string | null;
  outcome_code: string | null;
};

type ProviderEventConflictRow = {
  conflict_id: string;
  provider: string;
  merchant_id: string;
  event_id: string;
  existing_payload_sha256: string;
  incoming_payload_sha256: string;
  state: 'OPEN' | 'RESOLVED';
  occurrence_count: number;
  version: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  resolution_code: string | null;
};

export type PaymentPersistenceDependencies = Readonly<{
  now?: () => Date;
  createPaymentId?: () => string;
  createEventRowId?: () => string;
  createConflictId?: () => string;
}>;

export type PaymentAttemptCreation = Readonly<{
  payment: PaymentAttemptDto;
  replayed: boolean;
}>;

export type WebhookReceiptResult = Readonly<{
  outcome: 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED' | 'DUPLICATE' | 'PAYLOAD_CONFLICT';
  eventId: string;
  receiptId: string;
  state: ProviderEventRow['state'];
  payloadSha256: string;
  conflictId?: string;
}>;

const PROVIDER = 'hyperswitch';
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

function nonBlank(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function safeMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseDate(now: () => Date): string {
  const date = now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  return date.toISOString();
}

/** D1 text timestamps are UTC ISO-8601 values in these candidate schemas. */
function strictlyAfter(now: string, previous: string): string {
  return now > previous ? now : new Date(Date.parse(previous) + 1).toISOString();
}

function defaultPaymentId(): string {
  return 'pay_' + crypto.randomUUID().replace(/-/g, '').slice(0, 26);
}

function defaultEventRowId(): string {
  return 'evtrow_' + crypto.randomUUID();
}

function defaultConflictId(): string {
  return 'evtconf_' + crypto.randomUUID();
}

async function sha256Hex(input: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toDto(row: PaymentRow): PaymentAttemptDto {
  return {
    paymentId: row.payment_id,
    orderId: row.order_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status,
    version: row.version,
    providerUpdatedAt: row.provider_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readPaymentByCustomerAndKey(
  db: D1Database,
  customerId: string,
  idempotencyKey: string,
): Promise<PaymentRow | null> {
  return db.prepare(
    'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
    'idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at ' +
    'FROM payments WHERE customer_id = ? AND idempotency_key = ? LIMIT 1',
  ).bind(customerId, idempotencyKey).first<PaymentRow>();
}

async function readPaymentByOrder(
  db: D1Database,
  customerId: string,
  orderId: string,
): Promise<PaymentRow | null> {
  return db.prepare(
    'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
    'idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at ' +
    "FROM payments WHERE customer_id = ? AND order_id = ? AND status NOT IN ('failed','cancelled','cancelled_post_capture','expired') LIMIT 1",
  ).bind(customerId, orderId).first<PaymentRow>();
}

function replayOrConflict(
  existing: PaymentRow,
  requestHash: string,
): PaymentAttemptCreation {
  if (existing.request_hash !== requestHash) {
    throw new PaymentPersistenceError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409);
  }
  return { payment: toDto(existing), replayed: true };
}

/**
 * Persist a provider payment attempt before any network request. This helper
 * does not call Hyperswitch, capture funds, confirm the Order, post ledger
 * entries, or grant subscription entitlements.
 *
 * Idempotency-Key is scoped to the authenticated customer. A repeat with the
 * same semantic order returns the same stable payment ID; reuse for a
 * different order, amount, currency, merchant, or provider conflicts.
 */
export async function createPaymentAttempt(
  db: D1Database,
  customerIdInput: string,
  orderIdInput: string,
  idempotencyKeyInput: string | null | undefined,
  expectedMerchantIdInput: string | null | undefined,
  dependencies: PaymentPersistenceDependencies = {},
): Promise<PaymentAttemptCreation> {
  if (!nonBlank(customerIdInput, 256)) {
    throw new PaymentPersistenceError('VALIDATION_FAILED', 400);
  }
  if (!nonBlank(orderIdInput, 255)) {
    throw new PaymentPersistenceError('VALIDATION_FAILED', 400);
  }
  if (idempotencyKeyInput == null || idempotencyKeyInput.trim() === '') {
    throw new PaymentPersistenceError('PRECONDITION_REQUIRED', 428);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKeyInput)) {
    throw new PaymentPersistenceError('VALIDATION_FAILED', 400);
  }
  if (!nonBlank(expectedMerchantIdInput, 256)) {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  const hashRequest = async (orderId: string, amountMinor: number, currency: string) =>
    sha256Hex(new TextEncoder().encode(JSON.stringify({
      operation: 'createPaymentAttempt',
      customerId: customerIdInput,
      orderId,
      provider: PROVIDER,
      merchantId: expectedMerchantIdInput,
      amountMinor,
      currency,
    })));

  // Replays must be resolved before checking the Order's current lifecycle
  // state. A retry after the Order moved to CONFIRMED/COMPLETED still returns
  // the original Payment attempt; it must not create or conflict on a second
  // attempt simply because the business lifecycle advanced after the request.
  try {
    const existing = await readPaymentByCustomerAndKey(db, customerIdInput, idempotencyKeyInput);
    if (existing) {
      return replayOrConflict(
        existing,
        await hashRequest(orderIdInput, existing.amount_minor, existing.currency),
      );
    }
  } catch (error) {
    if (error instanceof PaymentPersistenceError) throw error;
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  let order: OrderRow | null;
  try {
    order = await db.prepare(
      'SELECT order_id, customer_id, status, currency, total_minor FROM orders ' +
      'WHERE order_id = ? AND customer_id = ? LIMIT 1',
    ).bind(orderIdInput, customerIdInput).first<OrderRow>();
  } catch {
    // Missing migration/schema and transient D1 errors must never become a
    // fabricated payment success or leak SQL/database names to a caller.
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!order) throw new PaymentPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (
    !['CREATED', 'PENDING_PAYMENT'].includes(order.status) ||
    !safeMinor(order.total_minor) ||
    typeof order.currency !== 'string' ||
    !CURRENCY_PATTERN.test(order.currency)
  ) {
    throw new PaymentPersistenceError('CONFLICT', 409);
  }

  const requestHash = await hashRequest(order.order_id, order.total_minor, order.currency);

  const nowFn = dependencies.now ?? (() => new Date());
  const createdAt = parseDate(nowFn);
  const paymentId = (dependencies.createPaymentId ?? defaultPaymentId)();
  if (!PAYMENT_ID_PATTERN.test(paymentId)) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  try {
    const inserted = await db.prepare(
      'INSERT INTO payments ' +
      '(payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
      'idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at) ' +
      "VALUES (?, ?, ?, 'hyperswitch', ?, ?, ?, 'INITIATING', 1, ?, ?, NULL, NULL, ?, ?)",
    ).bind(
      paymentId, order.order_id, customerIdInput, expectedMerchantIdInput, order.total_minor,
      order.currency, idempotencyKeyInput, requestHash, createdAt, createdAt,
    ).run();
    if (Number(inserted.meta?.changes ?? 0) !== 1) {
      throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
    }

    return {
      payment: {
        paymentId,
        orderId: order.order_id,
        amountMinor: order.total_minor,
        currency: order.currency,
        status: 'INITIATING',
        version: 1,
        providerUpdatedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
      replayed: false,
    };
  } catch (error) {
    if (error instanceof PaymentPersistenceError) throw error;
    // Unique keys arbitrate races. Re-read to distinguish a same-key replay,
    // semantic key reuse, and a second live attempt for the same Order.
    try {
      const raced = await readPaymentByCustomerAndKey(db, customerIdInput, idempotencyKeyInput);
      if (raced) return replayOrConflict(raced, requestHash);
      const live = await readPaymentByOrder(db, customerIdInput, order.order_id);
      if (live) throw new PaymentPersistenceError('CONFLICT', 409);
    } catch (recoveryError) {
      if (recoveryError instanceof PaymentPersistenceError) throw recoveryError;
      throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
    }
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
}

/**
 * Persist the validated response from the existing server-only Hyperswitch
 * create-intent adapter. Client secrets deliberately never enter D1. A caller
 * should return the secret only through an authorized checkout DTO and only
 * after this local comparison succeeds.
 */
export async function recordUnconfirmedHyperswitchIntent(
  db: D1Database,
  customerIdInput: string,
  paymentIdInput: string,
  expectedMerchantIdInput: string,
  providerPayment: HyperswitchPayment,
  dependencies: Pick<PaymentPersistenceDependencies, 'now'> = {},
): Promise<PaymentAttemptDto> {
  if (!nonBlank(customerIdInput, 256) || !PAYMENT_ID_PATTERN.test(paymentIdInput)) {
    throw new PaymentPersistenceError('VALIDATION_FAILED', 400);
  }
  if (!nonBlank(expectedMerchantIdInput, 256)) {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (
    providerPayment.paymentId !== paymentIdInput ||
    providerPayment.merchantId !== expectedMerchantIdInput ||
    !safeMinor(providerPayment.amount) ||
    !CURRENCY_PATTERN.test(providerPayment.currency) ||
    !['requires_payment_method', 'requires_confirmation'].includes(providerPayment.status)
  ) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
  }

  let existing: PaymentRow | null;
  try {
    existing = await db.prepare(
      'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
      'idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at ' +
      'FROM payments WHERE payment_id = ? AND customer_id = ? LIMIT 1',
    ).bind(paymentIdInput, customerIdInput).first<PaymentRow>();
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!existing) throw new PaymentPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (
    existing.merchant_id !== expectedMerchantIdInput ||
    existing.amount_minor !== providerPayment.amount ||
    existing.currency !== providerPayment.currency
  ) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
  }
  if (existing.status === providerPayment.status && existing.version >= 2) return toDto(existing);
  if (existing.status !== 'INITIATING' || existing.version !== 1) {
    throw new PaymentPersistenceError('CONFLICT', 409);
  }

  const updatedAt = strictlyAfter(parseDate(dependencies.now ?? (() => new Date())), existing.updated_at);
  try {
    const result = await db.prepare(
      "UPDATE payments SET status = ?, version = version + 1, updated_at = ? " +
      "WHERE payment_id = ? AND customer_id = ? AND merchant_id = ? AND amount_minor = ? AND currency = ? " +
      "AND status = 'INITIATING' AND version = 1",
    ).bind(
      providerPayment.status, updatedAt, paymentIdInput, customerIdInput, expectedMerchantIdInput,
      providerPayment.amount, providerPayment.currency,
    ).run();
    if (Number(result.meta?.changes ?? 0) === 1) {
      return {
        ...toDto(existing),
        status: providerPayment.status,
        version: 2,
        updatedAt,
      };
    }
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  try {
    const raced = await db.prepare(
      'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
      'idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at ' +
      'FROM payments WHERE payment_id = ? AND customer_id = ? LIMIT 1',
    ).bind(paymentIdInput, customerIdInput).first<PaymentRow>();
    if (raced && raced.status === providerPayment.status && raced.version >= 2) return toDto(raced);
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  throw new PaymentPersistenceError('CONFLICT', 409);
}

export type ReceiveHyperswitchWebhookInput = Readonly<{
  rawBody: ArrayBuffer;
  signatureHeader: string | null | undefined;
  webhookSecret: string | null | undefined;
  expectedMerchantId: string;
}>;

/**
 * Verify signature and merchant before persisting an inbox receipt. This method
 * accepts already-buffered bytes; the HTTP adapter must enforce the same 1 MiB
 * limit while streaming the body, before creating the ArrayBuffer.
 *
 * A verified event is only durably received here. It does not confirm an Order,
 * post a ledger fact, grant/revoke access, or treat provider state as applied.
 */
const TERMINAL_PAYMENT_STATUSES = new Set<PaymentAttemptStatus>([
  'succeeded', 'failed', 'cancelled', 'cancelled_post_capture', 'expired',
]);

/** Status edges intersected from contracts/state-machines/payment.json for the event statuses currently validated. */
const ALLOWED_PROVIDER_STATUS_TRANSITIONS: Partial<Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]>> = {
  INITIATING: ['processing', 'succeeded', 'failed', 'cancelled', 'cancelled_post_capture', 'expired'],
  requires_payment_method: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
  requires_confirmation: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
  requires_customer_action: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
  requires_merchant_action: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
  requires_capture: ['processing', 'succeeded', 'failed', 'cancelled_post_capture', 'expired'],
  processing: ['succeeded', 'failed', 'cancelled', 'cancelled_post_capture', 'expired'],
  partially_captured: ['processing', 'failed', 'cancelled_post_capture', 'expired'],
  partially_captured_and_capturable: ['processing', 'succeeded', 'failed', 'cancelled_post_capture', 'expired'],
};

function canApplyProviderStatusTransition(
  current: PaymentAttemptStatus,
  next: PaymentAttemptStatus,
): boolean {
  if (current === next) return true;
  if (TERMINAL_PAYMENT_STATUSES.has(current)) return false;
  return (ALLOWED_PROVIDER_STATUS_TRANSITIONS[current] ?? []).includes(next);
}

async function readProviderEvent(
  db: D1Database,
  merchantId: string,
  eventId: string,
): Promise<ProviderEventRow | null> {
  return db.prepare(
    'SELECT event_row_id, provider, merchant_id, event_id, event_type, payment_id, payload_sha256, state, ' +
    'received_at, processed_at, outcome_code FROM payment_provider_events ' +
    'WHERE provider = ? AND merchant_id = ? AND event_id = ? LIMIT 1',
  ).bind(PROVIDER, merchantId, eventId).first<ProviderEventRow>();
}

async function readPaymentForWebhook(
  db: D1Database,
  paymentId: string,
): Promise<PaymentRow | null> {
  return db.prepare(
    'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
    'idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at ' +
    'FROM payments WHERE provider = ? AND payment_id = ? LIMIT 1',
  ).bind(PROVIDER, paymentId).first<PaymentRow>();
}

function resultFromProviderEvent(
  row: ProviderEventRow,
  incomingHash: string,
  preferredOutcome?: WebhookReceiptResult['outcome'],
): WebhookReceiptResult {
  if (row.state === 'RECEIVED') throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  return {
    outcome: preferredOutcome ??
      (row.state === 'APPLIED' ? 'APPLIED' : row.state === 'REJECTED' ? 'REJECTED' : 'RECONCILIATION_REQUIRED'),
    eventId: row.event_id,
    receiptId: row.event_row_id,
    state: row.state,
    payloadSha256: incomingHash,
  };
}

async function persistNonApplicableWebhook(
  db: D1Database,
  envelope: NonNullable<ReturnType<typeof parseHyperswitchWebhookEnvelope>>,
  payloadSha256: string,
  eventRowId: string,
  now: string,
  state: 'RECONCILIATION_REQUIRED' | 'REJECTED',
  outcomeCode: string,
  createConflictId: () => string,
): Promise<WebhookReceiptResult> {
  const statements = [
    db.prepare(
      'INSERT INTO payment_provider_events ' +
      '(event_row_id, provider, merchant_id, event_id, event_type, payment_id, payload_sha256, state, received_at, processed_at, outcome_code) ' +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, NULL, NULL) " +
      'ON CONFLICT(provider, merchant_id, event_id) DO NOTHING',
    ).bind(
      eventRowId, PROVIDER, envelope.merchantId, envelope.eventId, envelope.eventType,
      envelope.contentType === 'payment_details' && typeof envelope.resource.payment_id === 'string' &&
        PAYMENT_ID_PATTERN.test(envelope.resource.payment_id) ? envelope.resource.payment_id : null,
      payloadSha256, now,
    ),
    db.prepare(
      'UPDATE payment_provider_events SET state = ?, processed_at = ?, outcome_code = ? ' +
      "WHERE provider = ? AND merchant_id = ? AND event_id = ? AND payload_sha256 = ? AND state = 'RECEIVED'",
    ).bind(state, now, outcomeCode, PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256),
  ];
  try {
    await db.batch(statements);
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  const stored = await readProviderEvent(db, envelope.merchantId, envelope.eventId).catch(() => null);
  if (!stored) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  if (stored.payload_sha256 !== payloadSha256) {
    const conflictId = await recordWebhookConflict(
      db, stored, payloadSha256, now, createConflictId,
    );
    return {
      outcome: 'PAYLOAD_CONFLICT',
      eventId: stored.event_id,
      receiptId: stored.event_row_id,
      state: stored.state,
      payloadSha256,
      conflictId,
    };
  }
  if (stored.state === 'RECEIVED') throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  return resultFromProviderEvent(stored, payloadSha256);
}

async function persistAndApplyProviderStatus(
  db: D1Database,
  envelope: NonNullable<ReturnType<typeof parseHyperswitchWebhookEnvelope>>,
  payment: PaymentRow,
  providerStatus: PaymentAttemptStatus,
  providerUpdatedAt: string,
  payloadSha256: string,
  eventRowId: string,
  now: string,
): Promise<WebhookReceiptResult> {
  const canonicalProviderUpdatedAt = new Date(Date.parse(providerUpdatedAt)).toISOString();
  const updatedAt = strictlyAfter(now, payment.updated_at);
  const insertEvent = db.prepare(
    'INSERT INTO payment_provider_events ' +
    '(event_row_id, provider, merchant_id, event_id, event_type, payment_id, payload_sha256, state, received_at, processed_at, outcome_code) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, NULL, NULL) " +
    'ON CONFLICT(provider, merchant_id, event_id) DO NOTHING',
  ).bind(
    eventRowId, PROVIDER, envelope.merchantId, envelope.eventId, envelope.eventType,
    payment.payment_id, payloadSha256, now,
  );
  const updatePayment = db.prepare(
    'UPDATE payments SET status = ?, version = version + 1, provider_updated_at = ?, updated_at = ? ' +
    'WHERE payment_id = ? AND provider = ? AND merchant_id = ? AND amount_minor = ? AND currency = ? ' +
    'AND version = ? AND status = ? AND (provider_updated_at IS NULL OR provider_updated_at < ?) ' +
    "AND EXISTS (SELECT 1 FROM payment_provider_events e WHERE e.provider = ? AND e.merchant_id = ? AND e.event_id = ? AND e.payload_sha256 = ? AND e.state = 'RECEIVED')",
  ).bind(
    providerStatus, canonicalProviderUpdatedAt, updatedAt,
    payment.payment_id, PROVIDER, payment.merchant_id, payment.amount_minor, payment.currency,
    payment.version, payment.status, canonicalProviderUpdatedAt,
    PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256,
  );
  const targetExists = 'EXISTS (' +
    'SELECT 1 FROM payments p ' +
    'WHERE p.payment_id = ? AND p.provider = ? AND p.merchant_id = ? ' +
    'AND p.amount_minor = ? AND p.currency = ? AND p.status = ? ' +
    'AND p.provider_updated_at = ?)';
  const updateEvent = db.prepare(
    'UPDATE payment_provider_events SET state = CASE WHEN ' + targetExists +
    " THEN 'APPLIED' ELSE 'RECONCILIATION_REQUIRED' END, processed_at = ?, outcome_code = CASE WHEN " +
    targetExists + " THEN 'PAYMENT_STATUS_APPLIED' ELSE 'PAYMENT_STATUS_CAS_LOST' END " +
    "WHERE provider = ? AND merchant_id = ? AND event_id = ? AND payload_sha256 = ? AND state = 'RECEIVED'",
  ).bind(
    payment.payment_id, PROVIDER, payment.merchant_id, payment.amount_minor, payment.currency,
    providerStatus, canonicalProviderUpdatedAt,
    now,
    payment.payment_id, PROVIDER, payment.merchant_id, payment.amount_minor, payment.currency,
    providerStatus, canonicalProviderUpdatedAt,
    PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256,
  );

  let batchResults: D1Result[];
  try {
    batchResults = await db.batch([insertEvent, updatePayment, updateEvent]);
  } catch {
    const raced = await readProviderEvent(db, envelope.merchantId, envelope.eventId).catch(() => null);
    if (!raced) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
    if (raced.payload_sha256 !== payloadSha256) {
      const conflictId = await recordWebhookConflict(
        db, raced, payloadSha256, now, defaultConflictId,
      );
      return {
        outcome: 'PAYLOAD_CONFLICT',
        eventId: raced.event_id,
        receiptId: raced.event_row_id,
        state: raced.state,
        payloadSha256,
        conflictId,
      };
    }
    if (raced.state !== 'RECEIVED') return resultFromProviderEvent(raced, payloadSha256, 'DUPLICATE');
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  const stored = await readProviderEvent(db, envelope.merchantId, envelope.eventId).catch(() => null);
  if (!stored) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  if (stored.payload_sha256 !== payloadSha256) {
    const conflictId = await recordWebhookConflict(
      db, stored, payloadSha256, now, defaultConflictId,
    );
    return {
      outcome: 'PAYLOAD_CONFLICT',
      eventId: stored.event_id,
      receiptId: stored.event_row_id,
      state: stored.state,
      payloadSha256,
      conflictId,
    };
  }
  if (stored.state === 'RECEIVED') throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  if (stored.state === 'APPLIED' && Number(batchResults[1]?.meta?.changes ?? 0) === 1) {
    return resultFromProviderEvent(stored, payloadSha256, 'APPLIED');
  }
  return resultFromProviderEvent(stored, payloadSha256, stored.state === 'APPLIED' ? 'DUPLICATE' : undefined);
}

/**
 * Verify the exact raw-body signature, bind provider facts to the local Payment
 * snapshot, and atomically record the event outcome with any allowed Payment
 * status CAS. No raw webhook body or provider secret is persisted.
 *
 * The HTTP adapter must enforce the 1 MiB body limit while streaming before
 * passing an ArrayBuffer here. This function does not confirm Orders, post
 * ledger facts, or grant/revoke subscription entitlements.
 */
export async function receiveHyperswitchWebhook(
  db: D1Database,
  input: ReceiveHyperswitchWebhookInput,
  dependencies: Pick<PaymentPersistenceDependencies, 'now' | 'createEventRowId' | 'createConflictId'> = {},
): Promise<WebhookReceiptResult> {
  if (!(input.rawBody instanceof ArrayBuffer) || input.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
  }
  const validSignature = await verifyHyperswitchWebhookSignature(
    input.rawBody,
    input.signatureHeader,
    input.webhookSecret,
  );
  if (!validSignature) throw new PaymentPersistenceError('INVALID_SIGNATURE', 401);

  const envelope = parseHyperswitchWebhookEnvelope(input.rawBody, input.expectedMerchantId);
  if (!envelope) throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
  if (
    !nonBlank(envelope.eventId, 255) ||
    !nonBlank(envelope.eventType, 96) ||
    !nonBlank(envelope.merchantId, 256)
  ) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
  }

  const now = parseDate(dependencies.now ?? (() => new Date()));
  const payloadSha256 = await sha256Hex(input.rawBody);
  const existing = await readProviderEvent(db, envelope.merchantId, envelope.eventId).catch(() => {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  });

  if (existing && existing.payload_sha256 !== payloadSha256) {
    const conflictId = await recordWebhookConflict(
      db, existing, payloadSha256, now, dependencies.createConflictId ?? defaultConflictId,
    );
    return {
      outcome: 'PAYLOAD_CONFLICT',
      eventId: existing.event_id,
      receiptId: existing.event_row_id,
      state: existing.state,
      payloadSha256,
      conflictId,
    };
  }
  if (existing && existing.state !== 'RECEIVED') {
    return resultFromProviderEvent(existing, payloadSha256, 'DUPLICATE');
  }

  const eventRowId = existing?.event_row_id ?? (dependencies.createEventRowId ?? defaultEventRowId)();
  const createConflictId = dependencies.createConflictId ?? defaultConflictId;

  if (envelope.contentType !== 'payment_details') {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'UNSUPPORTED_CONTENT_TYPE', createConflictId,
    );
  }

  const resourcePaymentId = envelope.resource.payment_id;
  if (typeof resourcePaymentId !== 'string' || !PAYMENT_ID_PATTERN.test(resourcePaymentId)) {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'INVALID_PROVIDER_PAYMENT_ID', createConflictId,
    );
  }

  let payment: PaymentRow | null;
  try {
    payment = await readPaymentForWebhook(db, resourcePaymentId);
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!payment) {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'UNKNOWN_LOCAL_PAYMENT', createConflictId,
    );
  }

  const decision = validateHyperswitchPaymentWebhook(envelope, {
    paymentId: payment.payment_id,
    merchantId: payment.merchant_id,
    amountMinor: payment.amount_minor,
    currency: payment.currency,
    lastProviderUpdatedAt: payment.provider_updated_at,
  });

  if (decision.outcome === 'REJECT') {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'REJECTED',
      'VALIDATION_' + decision.reason, createConflictId,
    );
  }
  if (decision.outcome === 'STALE') {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'STALE_PROVIDER_TIMESTAMP', createConflictId,
    );
  }
  if (decision.outcome === 'RECONCILIATION_REQUIRED') {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'VALIDATION_' + decision.reason, createConflictId,
    );
  }
  if (!canApplyProviderStatusTransition(payment.status, decision.providerStatus)) {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'FORBIDDEN_PAYMENT_TRANSITION', createConflictId,
    );
  }

  return persistAndApplyProviderStatus(
    db, envelope, payment, decision.providerStatus, decision.providerUpdatedAt,
    payloadSha256, eventRowId, now,
  );
}

async function recordWebhookConflict(
  db: D1Database,
  firstReceipt: ProviderEventRow,
  incomingHash: string,
  now: string,
  createId: () => string,
): Promise<string> {
  if (!SHA256_PATTERN.test(firstReceipt.payload_sha256) || firstReceipt.payload_sha256 === incomingHash) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  try {
    const existing = await db.prepare(
      'SELECT conflict_id, provider, merchant_id, event_id, existing_payload_sha256, incoming_payload_sha256, ' +
      'state, occurrence_count, version, first_seen_at, last_seen_at, resolved_at, resolution_code ' +
      'FROM payment_provider_event_conflicts WHERE provider = ? AND merchant_id = ? AND event_id = ? ' +
      'AND incoming_payload_sha256 = ? LIMIT 1',
    ).bind(PROVIDER, firstReceipt.merchant_id, firstReceipt.event_id, incomingHash).first<ProviderEventConflictRow>();
    if (existing) {
      if (
        existing.existing_payload_sha256 !== firstReceipt.payload_sha256 ||
        existing.state === 'RESOLVED'
      ) return existing.conflict_id;

      const updatedAt = strictlyAfter(now, existing.last_seen_at);
      const updated = await db.prepare(
        "UPDATE payment_provider_event_conflicts SET occurrence_count = occurrence_count + 1, " +
        "version = version + 1, last_seen_at = ? WHERE conflict_id = ? AND state = 'OPEN' " +
        'AND version = ? AND occurrence_count = ?',
      ).bind(updatedAt, existing.conflict_id, existing.version, existing.occurrence_count).run();
      if (Number(updated.meta?.changes ?? 0) === 1) return existing.conflict_id;

      const raced = await db.prepare(
        'SELECT conflict_id, existing_payload_sha256, state FROM payment_provider_event_conflicts ' +
        'WHERE provider = ? AND merchant_id = ? AND event_id = ? AND incoming_payload_sha256 = ? LIMIT 1',
      ).bind(PROVIDER, firstReceipt.merchant_id, firstReceipt.event_id, incomingHash).first<{
        conflict_id: string; existing_payload_sha256: string; state: 'OPEN' | 'RESOLVED';
      }>();
      if (raced && raced.existing_payload_sha256 === firstReceipt.payload_sha256) return raced.conflict_id;
      throw new PaymentPersistenceError('CONFLICT', 409);
    }

    const conflictId = createId();
    if (!nonBlank(conflictId, 255)) throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
    const inserted = await db.prepare(
      'INSERT INTO payment_provider_event_conflicts ' +
      '(conflict_id, provider, merchant_id, event_id, existing_payload_sha256, incoming_payload_sha256, ' +
      "state, occurrence_count, version, first_seen_at, last_seen_at, resolved_at, resolution_code) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'OPEN', 1, 1, ?, ?, NULL, NULL)",
    ).bind(
      conflictId, PROVIDER, firstReceipt.merchant_id, firstReceipt.event_id,
      firstReceipt.payload_sha256, incomingHash, now, now,
    ).run();
    if (Number(inserted.meta?.changes ?? 0) !== 1) {
      throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    return conflictId;
  } catch (error) {
    if (error instanceof PaymentPersistenceError) throw error;
    try {
      const raced = await db.prepare(
        'SELECT conflict_id, existing_payload_sha256, state FROM payment_provider_event_conflicts ' +
        'WHERE provider = ? AND merchant_id = ? AND event_id = ? AND incoming_payload_sha256 = ? LIMIT 1',
      ).bind(PROVIDER, firstReceipt.merchant_id, firstReceipt.event_id, incomingHash).first<{
        conflict_id: string; existing_payload_sha256: string; state: 'OPEN' | 'RESOLVED';
      }>();
      if (raced && raced.existing_payload_sha256 === firstReceipt.payload_sha256) return raced.conflict_id;
    } catch {
      // Fall through to a generic dependency error.
    }
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
}

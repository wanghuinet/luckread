/// <reference types="@cloudflare/workers-types" />

import { strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js';
import { CanonicalJsonError, sha256BytesToHex, sha256CanonicalJsonForIdempotency } from '../../W10-async/src/canonical-json-idempotency.js';

import {
  verifyHyperswitchWebhookSignature,
  parseHyperswitchWebhookEnvelope,
  parseHyperswitchRfc3339Timestamp,
} from './hyperswitch-webhook-signature.js';
import type { HyperswitchPayment } from './hyperswitch-client.js';
import { validateHyperswitchPaymentWebhook } from './hyperswitch-webhook-payment-validation.js';
import { persistHyperswitchRefundWebhook } from './refund-webhook-persistence.js';

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
  has_demo_pricing: number;
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

type OrderForWebhookRow = {
  order_id: string;
  customer_id: string;
  status: string;
  version: number;
  currency: string;
  total_minor: number;
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

type RenewalCycleWebhookState = 'AWAITING_PRICING' | 'AWAITING_MANDATE' | 'PREPARED' | 'PAYMENT_READY' | 'SUCCEEDED' | 'FAILED' | 'RECONCILIATION_REQUIRED';

type PaymentMandateRow = {
  mandate_record_id: string;
  provider: string;
  merchant_id: string;
  customer_id: string;
  payment_method_id: string;
  source_payment_id: string;
  source_event_id: string;
  consent_accepted_at: string;
  consent_acceptance_type: 'online';
  consent_scope: 'OFF_SESSION_RECURRING';
  consent_terms_version: 'luckread-recurring-consent-v1';
  provider_mandate_id: string | null;
  status: 'PENDING_PROVIDER_CONFIRMATION' | 'ACTIVE' | 'REVOKED' | 'FAILED' | 'EXPIRED';
  version: number;
  provider_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentPersistenceDependencies = Readonly<{
  now?: () => Date;
  createPaymentId?: () => string;
  createEventRowId?: () => string;
  createConflictId?: () => string;
  createSavedPaymentMethodId?: () => string;
  createPaymentMandateId?: () => string;
  paymentEnvironment?: 'sandbox' | 'production';
}>;

export type PaymentAttemptCreation = Readonly<{
  payment: PaymentAttemptDto;
  replayed: boolean;
  pricingMode: 'live' | 'demo';
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

/** D1 text timestamps are canonical UTC ISO-8601 values in these candidate schemas. */
function strictlyAfter(now: string, previous: string): string {
  const next = strictlyAfterCanonicalUtcTimestamp(now, previous);
  if (next === null) throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
  return next;
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

function defaultSavedPaymentMethodId(): string {
  return 'spm_' + crypto.randomUUID().replace(/-/g, '').slice(0, 26);
}

function defaultPaymentMandateId(): string {
  return 'mnd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 26);
}

/**
 * Compatibility adapter only: W10 owns the shared SHA-256 implementation.
 * Restrict inputs to the exact byte containers used here and preserve their
 * byte range (especially the raw signed webhook body) without re-serialization.
 */
async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  try {
    return await sha256BytesToHex(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
}

const MAX_PAYMENT_ATTEMPT_FINGERPRINT_BYTES = 8192;

type PaymentAttemptRequestHashes = Readonly<{
  canonical: string;
  compatible: readonly string[];
}>;

/**
 * New payment attempts use W10's strict canonical JSON + SHA-256 implementation.
 * The legacy hash is retained only as a replay-compatible alias for rows written
 * before this migration; it is never persisted for a newly created attempt.
 */
async function paymentAttemptRequestHashes(input: Readonly<{
  customerId: string;
  orderId: string;
  merchantId: string;
  amountMinor: number;
  currency: string;
}>): Promise<PaymentAttemptRequestHashes> {
  const payload = {
    operation: 'createPaymentAttempt',
    customerId: input.customerId,
    orderId: input.orderId,
    provider: PROVIDER,
    merchantId: input.merchantId,
    amountMinor: input.amountMinor,
    currency: input.currency,
  };

  let canonical: string;
  try {
    const fingerprint = await sha256CanonicalJsonForIdempotency(
      payload,
      MAX_PAYMENT_ATTEMPT_FINGERPRINT_BYTES,
    );
    canonical = fingerprint.slice('sha256:'.length);
  } catch (error) {
    if (error instanceof CanonicalJsonError && error.code !== 'HASH_UNAVAILABLE') {
      throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  let legacy: string;
  try {
    // Exact pre-W10 serialization is read-only compatibility for existing D1-04 rows.
    legacy = await sha256Hex(new TextEncoder().encode(JSON.stringify(payload)));
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  return {
    canonical,
    compatible: canonical === legacy ? [canonical] : [canonical, legacy],
  };
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
  compatibleRequestHashes: readonly string[],
  pricingMode: 'live' | 'demo',
): PaymentAttemptCreation {
  if (!compatibleRequestHashes.includes(existing.request_hash)) {
    throw new PaymentPersistenceError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409);
  }
  return { payment: toDto(existing), replayed: true, pricingMode };
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

  const hashRequest = (orderId: string, amountMinor: number, currency: string) =>
    paymentAttemptRequestHashes({
      customerId: customerIdInput,
      orderId,
      merchantId: expectedMerchantIdInput,
      amountMinor,
      currency,
    });

  // Read the immutable tax-mode marker before resolving a payment replay. This
  // prevents a Demo attempt from being retried after switching to production,
  // while preserving normal idempotency after the Order lifecycle advances.
  let order: OrderRow | null;
  try {
    order = await db.prepare(
      'SELECT order_id, customer_id, status, currency, total_minor, ' +
      "CASE WHEN EXISTS (SELECT 1 FROM order_lines AS demo_lines WHERE demo_lines.order_id = orders.order_id " +
      "AND json_valid(demo_lines.item_snapshot_json) AND json_extract(demo_lines.item_snapshot_json, '$.luckreadPricing.mode') = 'demo') " +
      'THEN 1 ELSE 0 END AS has_demo_pricing ' +
      'FROM orders WHERE order_id = ? AND customer_id = ? LIMIT 1',
    ).bind(orderIdInput, customerIdInput).first<OrderRow>();
  } catch {
    // Missing migration/schema and transient D1 errors must never become a
    // fabricated payment success or leak SQL/database names to a caller.
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!order) throw new PaymentPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (order.has_demo_pricing !== 0 && order.has_demo_pricing !== 1) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  const pricingMode = order.has_demo_pricing === 1 ? 'demo' : 'live';
  if (pricingMode === 'demo' && dependencies.paymentEnvironment !== 'sandbox') {
    throw new PaymentPersistenceError('CONFLICT', 409);
  }

  // Lifecycle checks remain after idempotency resolution, preserving retries.
  try {
    const existing = await readPaymentByCustomerAndKey(db, customerIdInput, idempotencyKeyInput);
    if (existing) {
      const hashes = await hashRequest(orderIdInput, existing.amount_minor, existing.currency);
      return replayOrConflict(existing, hashes.compatible, pricingMode);
    }
  } catch (error) {
    if (error instanceof PaymentPersistenceError) throw error;
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  if (
    !['CREATED', 'PENDING_PAYMENT'].includes(order.status) ||
    !safeMinor(order.total_minor) ||
    typeof order.currency !== 'string' ||
    !CURRENCY_PATTERN.test(order.currency)
  ) {
    throw new PaymentPersistenceError('CONFLICT', 409);
  }

  const requestHashes = await hashRequest(order.order_id, order.total_minor, order.currency);
  const requestHash = requestHashes.canonical;

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
      pricingMode,
    };
  } catch (error) {
    if (error instanceof PaymentPersistenceError) throw error;
    // Unique keys arbitrate races. Re-read to distinguish a same-key replay,
    // semantic key reuse, and a second live attempt for the same Order.
    try {
      const raced = await readPaymentByCustomerAndKey(db, customerIdInput, idempotencyKeyInput);
      if (raced) return replayOrConflict(raced, requestHashes.compatible, pricingMode);
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

/**
 * Record that a previously persisted MIT payment was submitted to Hyperswitch.
 * The synchronous provider response is not payment evidence; preserve the local
 * processing state and wait for the signed webhook/reconciliation path.
 */
export async function recordHyperswitchMerchantInitiatedSubmission(
  db: D1Database,
  customerIdInput: string,
  paymentIdInput: string,
  expectedMerchantIdInput: string,
  expectedPaymentMethodIdInput: string,
  providerPayment: HyperswitchPayment,
  dependencies: Pick<PaymentPersistenceDependencies, 'now'> = {},
): Promise<PaymentAttemptDto> {
  if (!nonBlank(customerIdInput, 256) ||
      !PAYMENT_ID_PATTERN.test(paymentIdInput) ||
      !nonBlank(expectedMerchantIdInput, 256) ||
      !nonBlank(expectedPaymentMethodIdInput, 255)) {
    throw new PaymentPersistenceError('VALIDATION_FAILED', 400);
  }
  if (
    providerPayment.paymentId !== paymentIdInput ||
    providerPayment.merchantId !== expectedMerchantIdInput ||
    providerPayment.amount <= 0 ||
    !Number.isSafeInteger(providerPayment.amount) ||
    !CURRENCY_PATTERN.test(providerPayment.currency) ||
    (providerPayment.customerId != null && providerPayment.customerId !== customerIdInput) ||
    (providerPayment.paymentMethodId != null && providerPayment.paymentMethodId !== expectedPaymentMethodIdInput)
  ) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
  }

  const selectById = () => db.prepare(
    'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
    'idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at ' +
    'FROM payments WHERE payment_id = ? AND customer_id = ? LIMIT 1',
  ).bind(paymentIdInput, customerIdInput).first<PaymentRow>();

  let existing: PaymentRow | null;
  try {
    existing = await selectById();
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!existing) throw new PaymentPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (
    existing.provider !== PROVIDER ||
    existing.merchant_id !== expectedMerchantIdInput ||
    existing.amount_minor !== providerPayment.amount ||
    existing.currency !== providerPayment.currency
  ) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
  }

  // If a verified webhook arrived before this response was persisted, it wins.
  // Never regress an already advanced payment or mark fulfillment from this API call.
  if (existing.status !== 'INITIATING' || existing.version !== 1) {
    return toDto(existing);
  }

  const updatedAt = strictlyAfter(parseDate(dependencies.now ?? (() => new Date())), existing.updated_at);
  try {
    await db.prepare(
      "UPDATE payments SET status = 'processing', version = version + 1, updated_at = ? " +
      "WHERE payment_id = ? AND customer_id = ? AND provider = 'hyperswitch' AND merchant_id = ? " +
      "AND amount_minor = ? AND currency = ? AND status = 'INITIATING' AND version = 1",
    ).bind(
      updatedAt, paymentIdInput, customerIdInput, expectedMerchantIdInput,
      providerPayment.amount, providerPayment.currency,
    ).run();
    const latest = await selectById();
    if (!latest) throw new PaymentPersistenceError('RESOURCE_NOT_FOUND', 404);
    return toDto(latest);
  } catch (error) {
    if (error instanceof PaymentPersistenceError) throw error;
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
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

async function readOrderForWebhook(
  db: D1Database,
  payment: PaymentRow,
): Promise<OrderForWebhookRow | null> {
  return db.prepare(
    'SELECT order_id, customer_id, status, version, currency, total_minor, updated_at ' +
    'FROM orders WHERE order_id = ? AND customer_id = ? LIMIT 1',
  ).bind(payment.order_id, payment.customer_id).first<OrderForWebhookRow>();
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


type VerifiedSetupConsent = Readonly<{
  paymentMethodId: string;
  acceptedAt: string;
  providerMandateId: string | null;
}>;

/**
 * Accept recurring-consent evidence only from the signature-verified provider
 * resource. Browser flags are not accepted as consent evidence. No token is
 * persisted when the provider resource omits or malforms the acceptance facts.
 */
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
    resource.amount !== payment.amount_minor ||
    resource.currency !== payment.currency ||
    resource.status !== 'succeeded' ||
    typeof resource.payment_method_id !== 'string' ||
    !nonBlank(resource.payment_method_id, 255) ||
    !/^[\x21-\x7e]{1,255}$/.test(resource.payment_method_id)
  ) return null;

  // Hyperswitch's documented outgoing payment webhook nests acceptance under
  // mandate_data.customer_acceptance; unlike the confirmation request, this
  // response shape does not require an acceptance_type field.
  const mandateData = resource.mandate_data;
  if (typeof mandateData !== 'object' || mandateData === null || Array.isArray(mandateData)) return null;
  const mandate = mandateData as Record<string, unknown>;
  const acceptance = mandate.customer_acceptance;
  if (typeof acceptance !== 'object' || acceptance === null || Array.isArray(acceptance)) return null;
  const accepted = acceptance as Record<string, unknown>;
  if (
    (accepted.acceptance_type !== undefined && accepted.acceptance_type !== 'online') ||
    typeof accepted.accepted_at !== 'string'
  ) return null;
  const online = accepted.online;
  if (typeof online !== 'object' || online === null || Array.isArray(online)) return null;
  const onlineFacts = online as Record<string, unknown>;
  if (
    typeof onlineFacts.ip_address !== 'string' ||
    !nonBlank(onlineFacts.ip_address, 128) ||
    typeof onlineFacts.user_agent !== 'string' ||
    !nonBlank(onlineFacts.user_agent, 1024)
  ) return null;

  const acceptedMillis = parseHyperswitchRfc3339Timestamp(accepted.accepted_at);
  const paymentCreatedMillis = Date.parse(payment.created_at);
  const nowMillis = Date.parse(now);
  if (
    acceptedMillis === null ||
    !Number.isFinite(paymentCreatedMillis) ||
    !Number.isFinite(nowMillis) ||
    acceptedMillis < paymentCreatedMillis ||
    acceptedMillis > nowMillis
  ) return null;

  let providerMandateId: string | null = null;
  if (resource.mandate_id !== undefined && resource.mandate_id !== null) {
    if (!nonBlank(resource.mandate_id, 255)) return null;
    providerMandateId = resource.mandate_id;
  }

  return {
    paymentMethodId: resource.payment_method_id,
    acceptedAt: new Date(acceptedMillis).toISOString(),
    providerMandateId,
  };
}

async function persistAndApplyProviderStatus(
  db: D1Database,
  envelope: NonNullable<ReturnType<typeof parseHyperswitchWebhookEnvelope>>,
  payment: PaymentRow,
  order: OrderForWebhookRow | null,
  providerStatus: PaymentAttemptStatus,
  providerUpdatedAt: string,
  payloadSha256: string,
  eventRowId: string,
  now: string,
  setupConsent: VerifiedSetupConsent | null,
  dependencies: Pick<PaymentPersistenceDependencies, 'createSavedPaymentMethodId' | 'createPaymentMandateId'>,
): Promise<WebhookReceiptResult> {
  const canonicalProviderUpdatedAt = new Date(Date.parse(providerUpdatedAt)).toISOString();
  const paymentUpdatedAt = strictlyAfter(now, payment.updated_at);
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
    providerStatus, canonicalProviderUpdatedAt, paymentUpdatedAt,
    payment.payment_id, PROVIDER, payment.merchant_id, payment.amount_minor, payment.currency,
    payment.version, payment.status, canonicalProviderUpdatedAt,
    PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256,
  );

  const statements: D1PreparedStatement[] = [insertEvent, updatePayment];
  const confirmableOrder = providerStatus === 'succeeded' &&
    order !== null &&
    order.order_id === payment.order_id &&
    order.customer_id === payment.customer_id &&
    order.currency === payment.currency &&
    order.total_minor === payment.amount_minor &&
    ['CREATED', 'PENDING_PAYMENT'].includes(order.status);

  if (confirmableOrder && order) {
    const orderUpdatedAt = strictlyAfter(now, order.updated_at);
    statements.push(db.prepare(
      "UPDATE orders SET status = 'CONFIRMED', version = version + 1, confirmed_at = ?, updated_at = ? " +
      'WHERE order_id = ? AND customer_id = ? AND currency = ? AND total_minor = ? AND status = ? AND version = ? ' +
      "AND EXISTS (SELECT 1 FROM payments p WHERE p.payment_id = ? AND p.order_id = orders.order_id " +
      "AND p.customer_id = orders.customer_id AND p.provider = 'hyperswitch' AND p.status = 'succeeded' " +
      "AND p.provider_updated_at = ? AND EXISTS (SELECT 1 FROM payment_provider_events e " +
      "WHERE e.provider = ? AND e.merchant_id = ? AND e.event_id = ? AND e.payload_sha256 = ? AND e.state = 'RECEIVED'))",
    ).bind(
      orderUpdatedAt, orderUpdatedAt,
      order.order_id, order.customer_id, order.currency, order.total_minor, order.status, order.version,
      payment.payment_id, canonicalProviderUpdatedAt,
      PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256,
    ));
  }

  // The verified payment event is also the durable cycle outcome signal.
  // Only a matched renewal Order can close a cycle as paid; an unknown/mismatched
  // Order becomes reconciliation-required and never grants D1-01 entitlement.
  const renewalCycleTarget: 'SUCCEEDED' | 'FAILED' | 'RECONCILIATION_REQUIRED' | null =
    providerStatus === 'succeeded'
      ? (order !== null &&
          order.order_id === payment.order_id &&
          order.customer_id === payment.customer_id &&
          order.currency === payment.currency &&
          order.total_minor === payment.amount_minor &&
          ['CREATED', 'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'COMPLETED'].includes(order.status))
        ? 'SUCCEEDED'
        : 'RECONCILIATION_REQUIRED'
      : ['failed', 'cancelled', 'expired'].includes(providerStatus)
        ? 'FAILED'
        : providerStatus === 'cancelled_post_capture'
          ? 'RECONCILIATION_REQUIRED'
          : null;

  let renewalCycleOutcomeRequired: { cycleId: string; targetState: 'SUCCEEDED' | 'FAILED' | 'RECONCILIATION_REQUIRED' } | null = null;
  if (renewalCycleTarget !== null) {
    let renewalCycle: {
      cycle_id: string;
      state: 'SUBMITTING' | 'SUBMITTED' | RenewalCycleWebhookState;
      version: number;
      updated_at: string;
    } | null = null;
    try {
      renewalCycle = await db.prepare(
        'SELECT cycle_id, state, version, updated_at FROM subscription_renewal_cycles ' +
        'WHERE payment_id = ? AND provider = ? AND merchant_id = ? LIMIT 1',
      ).bind(payment.payment_id, PROVIDER, payment.merchant_id).first<{
        cycle_id: string;
        state: 'SUBMITTING' | 'SUBMITTED' | RenewalCycleWebhookState;
        version: number;
        updated_at: string;
      }>();
    } catch (error) {
      // Before migration 0004 is applied there cannot be any durable renewal
      // cycle rows. Do not let this new optional capability break ordinary
      // customer-present checkout webhooks; all other D1 read failures retry.
      const message = error instanceof Error ? error.message : String(error);
      if (!/no such table:\s*subscription_renewal_cycles/i.test(message)) {
        throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
      }
    }
    if (renewalCycle && ['SUBMITTING', 'SUBMITTED'].includes(renewalCycle.state)) {
      renewalCycleOutcomeRequired = { cycleId: renewalCycle.cycle_id, targetState: renewalCycleTarget };
      const cycleUpdatedAt = strictlyAfter(now, renewalCycle.updated_at);
      const renewalOutcomeCode = renewalCycleTarget === 'RECONCILIATION_REQUIRED'
        ? (providerStatus === 'succeeded' ? 'SUCCEEDED_PAYMENT_ORDER_BINDING_REQUIRED' : 'POST_CAPTURE_CANCELLATION_REQUIRES_RECONCILIATION')
        : null;
      statements.push(db.prepare(
        'UPDATE subscription_renewal_cycles SET state = ?, provider_response_status = ?, outcome_code = ?, ' +
        'lease_token = NULL, lease_expires_at = NULL, version = version + 1, updated_at = ? ' +
        'WHERE cycle_id = ? AND version = ? AND state = ? ' +
        'AND EXISTS (SELECT 1 FROM payments p WHERE p.payment_id = ? AND p.provider = ? AND p.merchant_id = ? ' +
        'AND p.status = ? AND p.provider_updated_at = ?) ' +
        'AND EXISTS (SELECT 1 FROM payment_provider_events e WHERE e.provider = ? AND e.merchant_id = ? ' +
        "AND e.event_id = ? AND e.payload_sha256 = ? AND e.state = 'RECEIVED')",
      ).bind(
        renewalCycleTarget, providerStatus, renewalOutcomeCode, cycleUpdatedAt,
        renewalCycle.cycle_id, renewalCycle.version, renewalCycle.state,
        payment.payment_id, PROVIDER, payment.merchant_id, providerStatus, canonicalProviderUpdatedAt,
        PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256,
      ));
    }
  }

  if (setupConsent) {
    const savedPaymentMethodId = (dependencies.createSavedPaymentMethodId ?? defaultSavedPaymentMethodId)();
    const mandateRecordId = (dependencies.createPaymentMandateId ?? defaultPaymentMandateId)();
    if (!/^spm_[A-Za-z0-9]{26}$/.test(savedPaymentMethodId) || !/^mnd_[A-Za-z0-9]{26}$/.test(mandateRecordId)) {
      throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    // Persist only provider-issued opaque references and minimal consent evidence.
    // The provider event stays RECEIVED until the rest of this same D1 batch completes.
    statements.push(db.prepare(
      'INSERT INTO saved_payment_methods ' +
      '(saved_payment_method_id, provider, merchant_id, customer_id, payment_method_id, source_payment_id, source_event_id, created_at) ' +
      "VALUES (?, 'hyperswitch', ?, ?, ?, ?, ?, ?) " +
      'ON CONFLICT(provider, merchant_id, payment_method_id) DO NOTHING',
    ).bind(
      savedPaymentMethodId, payment.merchant_id, payment.customer_id,
      setupConsent.paymentMethodId, payment.payment_id, envelope.eventId, now,
    ));
    statements.push(db.prepare(
      'INSERT INTO payment_mandates ' +
      '(mandate_record_id, provider, merchant_id, customer_id, payment_method_id, source_payment_id, source_event_id, ' +
      'consent_accepted_at, consent_acceptance_type, consent_scope, consent_terms_version, provider_mandate_id, status, version, ' +
      'provider_updated_at, created_at, updated_at) ' +
      "VALUES (?, 'hyperswitch', ?, ?, ?, ?, ?, ?, 'online', 'OFF_SESSION_RECURRING', " +
      "'luckread-recurring-consent-v1', ?, 'PENDING_PROVIDER_CONFIRMATION', 1, NULL, ?, ?) " +
      'ON CONFLICT(provider, merchant_id, source_payment_id) DO NOTHING',
    ).bind(
      mandateRecordId, payment.merchant_id, payment.customer_id, setupConsent.paymentMethodId,
      payment.payment_id, envelope.eventId, setupConsent.acceptedAt, setupConsent.providerMandateId,
      now, now,
    ));
  }

  const paymentMatches = 'EXISTS (' +
    'SELECT 1 FROM payments p ' +
    'WHERE p.payment_id = ? AND p.provider = ? AND p.merchant_id = ? ' +
    'AND p.amount_minor = ? AND p.currency = ? AND p.status = ? ' +
    'AND p.provider_updated_at = ?)';
  const confirmedOrFulfilledOrderMatches = 'EXISTS (' +
    'SELECT 1 FROM orders o ' +
    'WHERE o.order_id = ? AND o.customer_id = ? AND o.currency = ? ' +
    "AND o.total_minor = ? AND o.status IN ('CONFIRMED','PROCESSING','COMPLETED'))";
  const renewalCycleAppliedMatches = renewalCycleOutcomeRequired
    ? 'EXISTS (SELECT 1 FROM subscription_renewal_cycles rc WHERE rc.cycle_id = ? AND rc.payment_id = ? AND rc.state = ?)'
    : '';
  const bindRenewalCycleMatch = (): unknown[] => renewalCycleOutcomeRequired
    ? [renewalCycleOutcomeRequired.cycleId, payment.payment_id, renewalCycleOutcomeRequired.targetState]
    : [];
  const eventAppliedCondition = (providerStatus === 'succeeded'
    ? paymentMatches + ' AND ' + confirmedOrFulfilledOrderMatches
    : paymentMatches) +
    (renewalCycleOutcomeRequired ? ' AND ' + renewalCycleAppliedMatches : '');
  const outcomeExpression = providerStatus === 'succeeded'
    ? 'CASE WHEN ' + eventAppliedCondition +
      " THEN 'PAYMENT_STATUS_APPLIED_AND_ORDER_CONFIRMED' WHEN " + paymentMatches +
      (renewalCycleOutcomeRequired ? ' AND ' + renewalCycleAppliedMatches : '') +
      " THEN 'ORDER_CONFIRMATION_REQUIRED' ELSE 'PAYMENT_STATUS_CAS_LOST' END"
    : 'CASE WHEN ' + eventAppliedCondition +
      " THEN 'PAYMENT_STATUS_APPLIED' ELSE 'PAYMENT_STATUS_CAS_LOST' END";

  const bindPaymentMatch = () => [
    payment.payment_id, PROVIDER, payment.merchant_id, payment.amount_minor,
    payment.currency, providerStatus, canonicalProviderUpdatedAt,
  ];
  const bindOrderMatch = () => [
    payment.order_id, payment.customer_id, payment.currency, payment.amount_minor,
  ];
  const eventUpdateSql =
    'UPDATE payment_provider_events SET state = CASE WHEN ' + eventAppliedCondition +
    " THEN 'APPLIED' ELSE 'RECONCILIATION_REQUIRED' END, processed_at = ?, outcome_code = " +
    outcomeExpression +
    " WHERE provider = ? AND merchant_id = ? AND event_id = ? AND payload_sha256 = ? AND state = 'RECEIVED'";
  const updateEventValues: unknown[] = [
    ...bindPaymentMatch(),
    ...(providerStatus === 'succeeded' ? bindOrderMatch() : []),
    ...bindRenewalCycleMatch(),
    now,
    ...bindPaymentMatch(),
    ...(providerStatus === 'succeeded' ? bindOrderMatch() : []),
    ...bindRenewalCycleMatch(),
    ...(providerStatus === 'succeeded' ? bindPaymentMatch() : []),
    ...(providerStatus === 'succeeded' ? bindRenewalCycleMatch() : []),
    PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256,
  ];
  statements.push(db.prepare(eventUpdateSql).bind(...updateEventValues));

  let batchResults: D1Result[];
  try {
    // Event receipt, provider Payment fact, optional Order confirmation and
    // terminal inbox outcome commit or roll back in one D1 batch. When a
    // provider confirms a payment for a non-confirmable Order, retain the
    // Payment fact but mark the event for reconciliation and do not confirm.
    batchResults = await db.batch(statements);
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
    if (raced.state !== 'RECEIVED') return resultFromProviderEvent(raced, payloadSha256, raced.state === 'APPLIED' ? 'DUPLICATE' : undefined);
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
  const eventResultIndex = statements.length - 1;
  if (stored.state === 'APPLIED' && Number(batchResults[1]?.meta?.changes ?? 0) === 1 &&
      Number(batchResults[eventResultIndex]?.meta?.changes ?? 0) === 1) {
    return resultFromProviderEvent(stored, payloadSha256, 'APPLIED');
  }
  return resultFromProviderEvent(stored, payloadSha256, stored.state === 'APPLIED' ? 'DUPLICATE' : undefined);
}


async function readMandateForWebhook(
  db: D1Database,
  merchantId: string,
  providerMandateId: string,
  paymentMethodId: string,
): Promise<PaymentMandateRow | null> {
  return db.prepare(
    'SELECT mandate_record_id, provider, merchant_id, customer_id, payment_method_id, source_payment_id, source_event_id, ' +
    'consent_accepted_at, consent_acceptance_type, consent_scope, consent_terms_version, provider_mandate_id, status, version, ' +
    'provider_updated_at, created_at, updated_at FROM payment_mandates ' +
    'WHERE provider = ? AND merchant_id = ? AND provider_mandate_id = ? AND payment_method_id = ? LIMIT 1',
  ).bind(PROVIDER, merchantId, providerMandateId, paymentMethodId).first<PaymentMandateRow>();
}

/**
 * Apply only the signed, merchant-bound Hyperswitch mandate lifecycle events.
 * Hyperswitch's MandateResponse has no resource update timestamp in the
 * documented schema, so use the provider envelope timestamp as notification
 * ordering evidence and fail closed if neither a resource nor envelope event
 * timestamp is present. A revoked mandate can never be re-activated.
 */
async function receiveHyperswitchMandateWebhook(
  db: D1Database,
  envelope: NonNullable<ReturnType<typeof parseHyperswitchWebhookEnvelope>>,
  payloadSha256: string,
  eventRowId: string,
  now: string,
  createConflictId: () => string,
): Promise<WebhookReceiptResult> {
  if (envelope.contentType !== 'mandate_details') {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'MANDATE_EVENT_CONTENT_TYPE_MISMATCH', createConflictId,
    );
  }

  const expectedStatus = envelope.eventType === 'mandate_active'
    ? 'ACTIVE'
    : envelope.eventType === 'mandate_revoked'
      ? 'REVOKED'
      : null;
  const resource = envelope.resource;
  const providerMandateId = resource.mandate_id;
  const paymentMethodId = resource.payment_method_id;
  const providerStatus = resource.status;
  if (
    expectedStatus === null ||
    !nonBlank(providerMandateId, 255) ||
    !nonBlank(paymentMethodId, 255) ||
    !/^[\x21-\x7e]{1,255}$/.test(paymentMethodId) ||
    (providerStatus !== 'active' && providerStatus !== 'revoked') ||
    providerStatus !== expectedStatus.toLowerCase() ||
    (resource.merchant_id !== undefined && resource.merchant_id !== envelope.merchantId)
  ) {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'MANDATE_RESOURCE_MISMATCH', createConflictId,
    );
  }

  const resourceUpdatedAt = resource.updated_at ?? resource.modified_at ?? resource.updated;
  const providerEventAt = typeof resourceUpdatedAt === 'string'
    ? resourceUpdatedAt
    : envelope.timestamp;
  if (typeof providerEventAt !== 'string' || !Number.isFinite(Date.parse(providerEventAt))) {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'MANDATE_PROVIDER_TIMESTAMP_MISSING', createConflictId,
    );
  }
  const canonicalProviderTimestamp = new Date(Date.parse(providerEventAt)).toISOString();

  let mandate: PaymentMandateRow | null;
  try {
    mandate = await readMandateForWebhook(db, envelope.merchantId, providerMandateId, paymentMethodId);
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!mandate) {
    return persistNonApplicableWebhook(
      db, envelope, payloadSha256, eventRowId, now, 'RECONCILIATION_REQUIRED',
      'UNKNOWN_LOCAL_MANDATE', createConflictId,
    );
  }

  const updatedAt = strictlyAfter(now, mandate.updated_at);
  const insertEvent = db.prepare(
    'INSERT INTO payment_provider_events ' +
    '(event_row_id, provider, merchant_id, event_id, event_type, payment_id, payload_sha256, state, received_at, processed_at, outcome_code) ' +
    "VALUES (?, ?, ?, ?, ?, NULL, ?, 'RECEIVED', ?, NULL, NULL) " +
    'ON CONFLICT(provider, merchant_id, event_id) DO NOTHING',
  ).bind(eventRowId, PROVIDER, envelope.merchantId, envelope.eventId, envelope.eventType, payloadSha256, now);

  const updateMandate = db.prepare(
    'UPDATE payment_mandates SET status = ?, provider_updated_at = ?, version = version + 1, updated_at = ? ' +
    'WHERE mandate_record_id = ? AND provider = ? AND merchant_id = ? AND provider_mandate_id = ? ' +
    'AND payment_method_id = ? AND version = ? AND status = ? ' +
    'AND (provider_updated_at IS NULL OR provider_updated_at < ?) ' +
    "AND ((? = 'ACTIVE' AND status IN ('PENDING_PROVIDER_CONFIRMATION','ACTIVE')) " +
    "OR (? = 'REVOKED' AND status IN ('PENDING_PROVIDER_CONFIRMATION','ACTIVE','REVOKED'))) " +
    "AND EXISTS (SELECT 1 FROM payment_provider_events e WHERE e.provider = ? AND e.merchant_id = ? " +
    "AND e.event_id = ? AND e.payload_sha256 = ? AND e.state = 'RECEIVED')",
  ).bind(
    expectedStatus, canonicalProviderTimestamp, updatedAt,
    mandate.mandate_record_id, PROVIDER, envelope.merchantId, providerMandateId,
    paymentMethodId, mandate.version, mandate.status, canonicalProviderTimestamp,
    expectedStatus, expectedStatus,
    PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256,
  );

  const updateReceipt = db.prepare(
    'UPDATE payment_provider_events SET state = CASE WHEN EXISTS (' +
    'SELECT 1 FROM payment_mandates m WHERE m.mandate_record_id = ? AND m.provider = ? AND m.merchant_id = ? ' +
    'AND m.provider_mandate_id = ? AND m.payment_method_id = ? AND m.status = ? AND m.provider_updated_at = ?) ' +
    "THEN 'APPLIED' ELSE 'RECONCILIATION_REQUIRED' END, processed_at = ?, " +
    'outcome_code = CASE WHEN EXISTS (' +
    'SELECT 1 FROM payment_mandates m WHERE m.mandate_record_id = ? AND m.provider = ? AND m.merchant_id = ? ' +
    'AND m.provider_mandate_id = ? AND m.payment_method_id = ? AND m.status = ? AND m.provider_updated_at = ?) ' +
    "THEN 'MANDATE_STATUS_APPLIED' ELSE 'MANDATE_STATUS_CAS_LOST_OR_OUT_OF_ORDER' END " +
    "WHERE provider = ? AND merchant_id = ? AND event_id = ? AND payload_sha256 = ? AND state = 'RECEIVED'",
  ).bind(
    mandate.mandate_record_id, PROVIDER, envelope.merchantId, providerMandateId, paymentMethodId,
    expectedStatus, canonicalProviderTimestamp, now,
    mandate.mandate_record_id, PROVIDER, envelope.merchantId, providerMandateId, paymentMethodId,
    expectedStatus, canonicalProviderTimestamp,
    PROVIDER, envelope.merchantId, envelope.eventId, payloadSha256,
  );

  let batchResults: D1Result[];
  try {
    batchResults = await db.batch([insertEvent, updateMandate, updateReceipt]);
  } catch {
    const raced = await readProviderEvent(db, envelope.merchantId, envelope.eventId).catch(() => null);
    if (!raced) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
    if (raced.payload_sha256 !== payloadSha256) {
      const conflictId = await recordWebhookConflict(db, raced, payloadSha256, now, createConflictId);
      return {
        outcome: 'PAYLOAD_CONFLICT',
        eventId: raced.event_id,
        receiptId: raced.event_row_id,
        state: raced.state,
        payloadSha256,
        conflictId,
      };
    }
    if (raced.state !== 'RECEIVED') return resultFromProviderEvent(raced, payloadSha256, raced.state === 'APPLIED' ? 'DUPLICATE' : undefined);
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  const stored = await readProviderEvent(db, envelope.merchantId, envelope.eventId).catch(() => null);
  if (!stored) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  if (stored.payload_sha256 !== payloadSha256) {
    const conflictId = await recordWebhookConflict(db, stored, payloadSha256, now, createConflictId);
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
  if (
    stored.state === 'APPLIED' &&
    Number(batchResults[1]?.meta?.changes ?? 0) === 1 &&
    Number(batchResults[2]?.meta?.changes ?? 0) === 1
  ) return resultFromProviderEvent(stored, payloadSha256, 'APPLIED');
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
  dependencies: Pick<PaymentPersistenceDependencies, 'now' | 'createEventRowId' | 'createConflictId' | 'createSavedPaymentMethodId' | 'createPaymentMandateId'> = {},
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
    return resultFromProviderEvent(existing, payloadSha256, existing.state === 'APPLIED' ? 'DUPLICATE' : undefined);
  }

  const eventRowId = existing?.event_row_id ?? (dependencies.createEventRowId ?? defaultEventRowId)();
  const createConflictId = dependencies.createConflictId ?? defaultConflictId;

  if (envelope.eventType === 'mandate_active' || envelope.eventType === 'mandate_revoked') {
    return receiveHyperswitchMandateWebhook(
      db, envelope, payloadSha256, eventRowId, now, createConflictId,
    );
  }

  if (envelope.contentType === 'refund_details') {
    return persistHyperswitchRefundWebhook(db, envelope, payloadSha256, {
      now: () => new Date(now),
      createEventRowId: () => eventRowId,
    });
  }

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

  let order: OrderForWebhookRow | null = null;
  if (decision.providerStatus === 'succeeded') {
    try {
      order = await readOrderForWebhook(db, payment);
    } catch {
      throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
    }
  }

  const setupConsent = decision.providerStatus === 'succeeded'
    ? readVerifiedSetupConsent(envelope.resource, payment, envelope.eventType, now)
    : null;

  return persistAndApplyProviderStatus(
    db, envelope, payment, order, decision.providerStatus, decision.providerUpdatedAt,
    payloadSha256, eventRowId, now, setupConsent, dependencies,
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

/// <reference types="@cloudflare/workers-types" />

import { CanonicalJsonError, sha256CanonicalJsonForIdempotency } from '../../W10-async/src/canonical-json-idempotency.js';
import { strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js';
import type { HyperswitchRefund } from './hyperswitch-client.js';

export type RefundStatus =
  | 'REQUESTED'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REVIEW'
  | 'RECONCILIATION_REQUIRED';

export type RefundDto = Readonly<{
  refundId: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  capturedAmountMinor: number;
  currency: string;
  status: RefundStatus;
  reason: string | null;
  version: number;
  providerUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type RefundPersistenceErrorCode =
  | 'VALIDATION_FAILED'
  | 'PRECONDITION_REQUIRED'
  | 'RESOURCE_NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
  | 'INTEGRITY_VIOLATION'
  | 'SERVICE_UNAVAILABLE';

export class RefundPersistenceError extends Error {
  constructor(readonly code: RefundPersistenceErrorCode, readonly status: number) {
    super(code);
    this.name = 'RefundPersistenceError';
  }
}

type PaymentForRefund = Readonly<{
  payment_id: string;
  order_id: string;
  customer_id: string;
  merchant_id: string;
  provider: string;
  amount_minor: number;
  currency: string;
  status: string;
}>;

type RefundRow = Readonly<{
  refund_id: string;
  merchant_id: string;
  customer_id: string;
  order_id: string;
  payment_id: string;
  amount_minor: number;
  captured_amount_minor: number;
  currency: string;
  status: RefundStatus;
  reason: string | null;
  idempotency_key: string;
  request_hash: string;
  provider_updated_at: string | null;
  outcome_code: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}>;

export type RefundReservation = Readonly<{
  refund: RefundDto;
  replayed: boolean;
}>;

export type RefundPersistenceDependencies = Readonly<{
  now?: () => Date;
  createRefundId?: () => string;
}>;

const PROVIDER = 'hyperswitch';
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const REFUND_ID_PATTERN = /^ref_[A-Za-z0-9]{26}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function nonBlank(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nowIso(now?: () => Date): string {
  const date = (now ?? (() => new Date()))();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RefundPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  return date.toISOString();
}

function nextTimestamp(now: string, previous: string): string {
  const next = strictlyAfterCanonicalUtcTimestamp(now, previous);
  if (!next) throw new RefundPersistenceError('INTEGRITY_VIOLATION', 500);
  return next;
}

function defaultRefundId(): string {
  return 'ref_' + crypto.randomUUID().replace(/-/g, '').slice(0, 26);
}

function toDto(row: RefundRow): RefundDto {
  return {
    refundId: row.refund_id,
    paymentId: row.payment_id,
    orderId: row.order_id,
    amountMinor: row.amount_minor,
    capturedAmountMinor: row.captured_amount_minor,
    currency: row.currency,
    status: row.status,
    reason: row.reason,
    version: row.version,
    providerUpdatedAt: row.provider_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function refundRequestHash(input: Readonly<{
  customerId: string;
  merchantId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  reason: string | null;
}>): Promise<string> {
  try {
    const fingerprint = await sha256CanonicalJsonForIdempotency({
      operation: 'createRefund',
      provider: PROVIDER,
      customerId: input.customerId,
      merchantId: input.merchantId,
      paymentId: input.paymentId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      reason: input.reason,
    }, 8192);
    return fingerprint.slice('sha256:'.length);
  } catch (error) {
    if (error instanceof CanonicalJsonError && error.code !== 'HASH_UNAVAILABLE') {
      throw new RefundPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    throw new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
}

async function readRefundByCustomerAndKey(
  db: D1Database,
  customerId: string,
  key: string,
): Promise<RefundRow | null> {
  return db.prepare(
    'SELECT refund_id, merchant_id, customer_id, order_id, payment_id, amount_minor, captured_amount_minor, ' +
    'currency, status, reason, idempotency_key, request_hash, provider_updated_at, outcome_code, version, created_at, updated_at ' +
    'FROM refunds WHERE customer_id = ? AND idempotency_key = ? LIMIT 1',
  ).bind(customerId, key).first<RefundRow>();
}

async function readRefundById(db: D1Database, refundId: string): Promise<RefundRow | null> {
  return db.prepare(
    'SELECT refund_id, merchant_id, customer_id, order_id, payment_id, amount_minor, captured_amount_minor, ' +
    'currency, status, reason, idempotency_key, request_hash, provider_updated_at, outcome_code, version, created_at, updated_at ' +
    'FROM refunds WHERE provider = ? AND refund_id = ? LIMIT 1',
  ).bind(PROVIDER, refundId).first<RefundRow>();
}

function replayOrConflict(row: RefundRow, requestHash: string): RefundReservation {
  if (row.request_hash !== requestHash) {
    throw new RefundPersistenceError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409);
  }
  return { refund: toDto(row), replayed: true };
}

/**
 * Reserve a stable provider refund ID before any POST /refunds network call.
 * Captured amount is supplied only from a merchant-authenticated Hyperswitch
 * payment retrieval, never from the browser or the immutable original charge.
 */
export async function createRefundReservation(
  db: D1Database,
  input: Readonly<{
    customerId: string;
    paymentId: string;
    amountMinor: number;
    currency: string;
    capturedAmountMinor: number;
    idempotencyKey: string | null;
    reason?: string | null;
    expectedMerchantId: string;
  }>,
  dependencies: RefundPersistenceDependencies = {},
): Promise<RefundReservation> {
  if (!nonBlank(input.customerId, 256)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  if (!PAYMENT_ID_PATTERN.test(input.paymentId)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  if (!safeMinor(input.amountMinor) || !safeMinor(input.capturedAmountMinor)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  if (!CURRENCY_PATTERN.test(input.currency) || !nonBlank(input.expectedMerchantId, 256)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  if (input.idempotencyKey == null || input.idempotencyKey.trim() === '') {
    throw new RefundPersistenceError('PRECONDITION_REQUIRED', 428);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  const reason = input.reason ?? null;
  if (reason !== null && !nonBlank(reason, 512)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }

  let payment: PaymentForRefund | null;
  try {
    payment = await db.prepare(
      'SELECT payment_id, order_id, customer_id, merchant_id, provider, amount_minor, currency, status ' +
      'FROM payments WHERE payment_id = ? AND customer_id = ? LIMIT 1',
    ).bind(input.paymentId, input.customerId).first<PaymentForRefund>();
  } catch {
    throw new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!payment) throw new RefundPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (
    payment.provider !== PROVIDER ||
    payment.merchant_id !== input.expectedMerchantId ||
    payment.currency !== input.currency ||
    !['succeeded', 'partially_captured'].includes(payment.status) ||
    !safeMinor(payment.amount_minor) ||
    input.capturedAmountMinor > payment.amount_minor ||
    input.amountMinor > input.capturedAmountMinor
  ) {
    throw new RefundPersistenceError('CONFLICT', 409);
  }

  const requestHash = await refundRequestHash({
    customerId: input.customerId,
    merchantId: input.expectedMerchantId,
    paymentId: input.paymentId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    reason,
  });

  try {
    const existing = await readRefundByCustomerAndKey(db, input.customerId, input.idempotencyKey);
    if (existing) return replayOrConflict(existing, requestHash);
  } catch (error) {
    if (error instanceof RefundPersistenceError) throw error;
    throw new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  const createdAt = nowIso(dependencies.now);
  const refundId = (dependencies.createRefundId ?? defaultRefundId)();
  if (!REFUND_ID_PATTERN.test(refundId)) {
    throw new RefundPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  try {
    const inserted = await db.prepare(
      'INSERT INTO refunds(refund_id,provider,merchant_id,customer_id,order_id,payment_id,amount_minor,' +
      'captured_amount_minor,currency,status,reason,idempotency_key,request_hash,provider_updated_at,outcome_code,' +
      'version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,? ,\'REQUESTED\',?,?,?,NULL,NULL,1,?,?)',
    ).bind(
      refundId, PROVIDER, payment.merchant_id, input.customerId, payment.order_id, payment.payment_id,
      input.amountMinor, input.capturedAmountMinor, payment.currency, reason, input.idempotencyKey,
      requestHash, createdAt, createdAt,
    ).run();
    if (Number(inserted.meta?.changes ?? 0) !== 1) {
      throw new RefundPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    const row = await readRefundById(db, refundId);
    if (!row) throw new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
    return { refund: toDto(row), replayed: false };
  } catch (error) {
    if (error instanceof RefundPersistenceError) throw error;
    try {
      const raced = await readRefundByCustomerAndKey(db, input.customerId, input.idempotencyKey);
      if (raced) return replayOrConflict(raced, requestHash);
    } catch (recoveryError) {
      if (recoveryError instanceof RefundPersistenceError) throw recoveryError;
    }
    // This includes a concurrent refund that consumed remaining captured amount.
    throw new RefundPersistenceError('CONFLICT', 409);
  }
}

/**
 * The authenticated create-refund response acknowledges acceptance but does
 * not finalize a refund. Only a signature-verified webhook may set SUCCEEDED
 * or FAILED; ambiguous final response shapes are marked for reconciliation.
 */
export async function recordHyperswitchRefundAcknowledgement(
  db: D1Database,
  refund: HyperswitchRefund,
  dependencies: Pick<RefundPersistenceDependencies, 'now'> = {},
): Promise<RefundDto> {
  let row: RefundRow | null;
  try {
    row = await readRefundById(db, refund.refundId);
  } catch {
    throw new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!row) throw new RefundPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (
    row.payment_id !== refund.paymentId ||
    row.amount_minor !== refund.amount ||
    row.currency !== refund.currency
  ) {
    throw new RefundPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  const nextStatus: RefundStatus =
    refund.status === 'pending' ? 'PENDING' :
    refund.status === 'review' ? 'REVIEW' :
    'RECONCILIATION_REQUIRED';
  const outcomeCode = nextStatus === 'RECONCILIATION_REQUIRED'
    ? 'API_FINAL_STATE_REQUIRES_SIGNED_WEBHOOK'
    : null;

  if (row.status === nextStatus && row.outcome_code === outcomeCode) return toDto(row);
  if (row.status !== 'REQUESTED' && row.status !== 'RECONCILIATION_REQUIRED') {
    return toDto(row);
  }

  const now = nowIso(dependencies.now);
  const updatedAt = nextTimestamp(now, row.updated_at);
  const updated = await db.prepare(
    'UPDATE refunds SET status = ?, outcome_code = ?, version = version + 1, updated_at = ? ' +
    "WHERE refund_id = ? AND version = ? AND status IN ('REQUESTED','RECONCILIATION_REQUIRED')",
  ).bind(
    nextStatus, outcomeCode, updatedAt, row.refund_id, row.version,
  ).run().catch(() => {
    throw new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
  });
  if (Number(updated.meta?.changes ?? 0) !== 1) {
    const raced = await readRefundById(db, refund.refundId).catch(() => null);
    if (!raced) throw new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
    return toDto(raced);
  }
  const latest = await readRefundById(db, refund.refundId).catch(() => null);
  if (!latest) throw new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
  return toDto(latest);
}

export type RefundPaymentReference = Readonly<{
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  merchantId: string;
}>;

/** Check local payment ownership before any merchant-authenticated provider lookup. */
export async function resolveRefundPaymentReference(
  db: D1Database,
  customerId: string,
  paymentId: string,
  expectedMerchantId: string,
): Promise<RefundPaymentReference> {
  if (!nonBlank(customerId, 256) || !PAYMENT_ID_PATTERN.test(paymentId) ||
      !nonBlank(expectedMerchantId, 256)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  let payment: PaymentForRefund | null;
  try {
    payment = await db.prepare(
      'SELECT payment_id, order_id, customer_id, merchant_id, provider, amount_minor, currency, status ' +
      'FROM payments WHERE payment_id = ? AND customer_id = ? LIMIT 1',
    ).bind(paymentId, customerId).first<PaymentForRefund>();
  } catch {
    throw new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!payment) throw new RefundPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (
    payment.provider !== PROVIDER ||
    payment.merchant_id !== expectedMerchantId ||
    !['succeeded', 'partially_captured'].includes(payment.status) ||
    !safeMinor(payment.amount_minor) ||
    !CURRENCY_PATTERN.test(payment.currency)
  ) {
    throw new RefundPersistenceError('CONFLICT', 409);
  }
  return {
    paymentId: payment.payment_id,
    orderId: payment.order_id,
    amountMinor: payment.amount_minor,
    currency: payment.currency,
    merchantId: payment.merchant_id,
  };
}

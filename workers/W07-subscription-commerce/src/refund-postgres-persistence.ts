/// <reference types="@cloudflare/workers-types" />

import { CanonicalJsonError, sha256CanonicalJsonForIdempotency } from '../../W10-async/src/canonical-json-idempotency.js';
import { strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js';
import type { HyperswitchRefund } from './hyperswitch-client.js';
import {
  RefundPersistenceError,
  type RefundDto,
  type RefundPaymentReference,
  type RefundPersistenceDependencies,
  type RefundReservation,
  type RefundStatus,
} from './refund-contracts.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';

type RefundLookupInput = Readonly<{
  customerId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  reason?: string | null;
  idempotencyKey: string | null;
  expectedMerchantId: string;
}>;

type RefundReservationInput = Readonly<{
  customerId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  capturedAmountMinor: number;
  idempotencyKey: string | null;
  reason?: string | null;
  expectedMerchantId: string;
}>;

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

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
}

function mapReadError(): RefundPersistenceError {
  return new RefundPersistenceError('SERVICE_UNAVAILABLE', 503);
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

const REFUND_COLUMNS =
  'refund_id, merchant_id, customer_id, order_id, payment_id, ' +
  'amount_minor::double precision AS amount_minor, captured_amount_minor::double precision AS captured_amount_minor, ' +
  'currency, status, reason, idempotency_key, request_hash, ' +
  "CASE WHEN provider_updated_at IS NULL THEN NULL ELSE to_char(provider_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END AS provider_updated_at, " +
  'outcome_code, version::double precision AS version, ' +
  "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at, " +
  "to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS updated_at";

async function readRefundByCustomerAndKey(
  db: W07WebhookPostgresPool,
  customerId: string,
  key: string,
): Promise<RefundRow | null> {
  const result = await db.query<RefundRow & Record<string, unknown>>(
    `SELECT ${REFUND_COLUMNS} FROM refunds WHERE customer_id = $1 AND idempotency_key = $2 LIMIT 1`,
    [customerId, key],
  );
  return result.rows[0] ?? null;
}

async function readRefundById(
  db: W07WebhookPostgresPool,
  refundId: string,
): Promise<RefundRow | null> {
  const result = await db.query<RefundRow & Record<string, unknown>>(
    `SELECT ${REFUND_COLUMNS} FROM refunds WHERE provider = $1 AND refund_id = $2 LIMIT 1`,
    [PROVIDER, refundId],
  );
  return result.rows[0] ?? null;
}

function replayOrConflict(row: RefundRow, requestHash: string): RefundReservation {
  if (row.request_hash !== requestHash) {
    throw new RefundPersistenceError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409);
  }
  return { refund: toDto(row), replayed: true };
}

function validateLookupInput(input: RefundLookupInput): string | null {
  if (!nonBlank(input.customerId, 256) || !PAYMENT_ID_PATTERN.test(input.paymentId) ||
      !safeMinor(input.amountMinor) || !CURRENCY_PATTERN.test(input.currency) ||
      !nonBlank(input.expectedMerchantId, 256)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  if (input.idempotencyKey == null || input.idempotencyKey.trim() === '') {
    throw new RefundPersistenceError('PRECONDITION_REQUIRED', 428);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  const reason = input.reason ?? null;
  if (reason !== null && !nonBlank(reason, 255)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  return reason;
}

async function readPaymentForRefund(
  db: W07WebhookPostgresPool,
  paymentId: string,
  customerId: string,
): Promise<PaymentForRefund | null> {
  const result = await db.query<PaymentForRefund & Record<string, unknown>>(
    'SELECT payment_id, order_id, customer_id, merchant_id, provider, ' +
    'amount_minor::double precision AS amount_minor, currency, status ' +
    'FROM payments WHERE payment_id = $1 AND customer_id = $2 LIMIT 1',
    [paymentId, customerId],
  );
  return result.rows[0] ?? null;
}

function mapRefundInsertError(error: unknown): RefundPersistenceError {
  const code = errorCode(error);
  // The Neon source-guard trigger serializes reservations on the Payment row
  // and rejects reservations above remaining captured funds.
  if (code === '23514') return new RefundPersistenceError('CONFLICT', 409);
  if (code === '23505') return new RefundPersistenceError('CONFLICT', 409);
  if (code.startsWith('23')) return new RefundPersistenceError('INTEGRITY_VIOLATION', 500);
  return mapReadError();
}

/** Resolve a customer-owned captured Payment before making a provider lookup. */
export async function resolveRefundPaymentReferencePostgres(
  db: W07WebhookPostgresPool,
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
    payment = await readPaymentForRefund(db, paymentId, customerId);
  } catch {
    throw mapReadError();
  }
  if (!payment) throw new RefundPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (payment.provider !== PROVIDER || payment.merchant_id !== expectedMerchantId ||
      !['succeeded', 'partially_captured'].includes(payment.status) ||
      !safeMinor(payment.amount_minor) || !CURRENCY_PATTERN.test(payment.currency)) {
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

/** Read the durable customer-scoped refund idempotency record before provider I/O. */
export async function findExistingRefundReservationPostgres(
  db: W07WebhookPostgresPool,
  input: RefundLookupInput,
): Promise<RefundReservation | null> {
  const reason = validateLookupInput(input);
  const requestHash = await refundRequestHash({
    customerId: input.customerId,
    merchantId: input.expectedMerchantId,
    paymentId: input.paymentId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    reason,
  });
  let existing: RefundRow | null;
  try {
    existing = await readRefundByCustomerAndKey(db, input.customerId, input.idempotencyKey as string);
  } catch {
    throw mapReadError();
  }
  return existing ? replayOrConflict(existing, requestHash) : null;
}

/**
 * Reserve a stable provider refund ID. The Neon trigger locks the source
 * Payment and validates the remaining captured refund balance atomically.
 */
export async function createRefundReservationPostgres(
  db: W07WebhookPostgresPool,
  input: RefundReservationInput,
  dependencies: RefundPersistenceDependencies = {},
): Promise<RefundReservation> {
  if (!nonBlank(input.customerId, 256) || !PAYMENT_ID_PATTERN.test(input.paymentId) ||
      !safeMinor(input.amountMinor) || !safeMinor(input.capturedAmountMinor) ||
      !CURRENCY_PATTERN.test(input.currency) || !nonBlank(input.expectedMerchantId, 256)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  if (input.idempotencyKey == null || input.idempotencyKey.trim() === '') {
    throw new RefundPersistenceError('PRECONDITION_REQUIRED', 428);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  const reason = input.reason ?? null;
  if (reason !== null && !nonBlank(reason, 255)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }

  let payment: PaymentForRefund | null;
  try {
    payment = await readPaymentForRefund(db, input.paymentId, input.customerId);
  } catch {
    throw mapReadError();
  }
  if (!payment) throw new RefundPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (payment.provider !== PROVIDER || payment.merchant_id !== input.expectedMerchantId ||
      payment.currency !== input.currency || !['succeeded', 'partially_captured'].includes(payment.status) ||
      !safeMinor(payment.amount_minor) || input.capturedAmountMinor > payment.amount_minor ||
      input.amountMinor > input.capturedAmountMinor) {
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
    throw mapReadError();
  }

  const createdAt = nowIso(dependencies.now);
  const refundId = (dependencies.createRefundId ?? defaultRefundId)();
  if (!REFUND_ID_PATTERN.test(refundId)) {
    throw new RefundPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  try {
    await db.query(
      'INSERT INTO refunds(refund_id,provider,merchant_id,customer_id,order_id,payment_id,amount_minor,' +
      'captured_amount_minor,currency,status,reason,idempotency_key,request_hash,provider_updated_at,outcome_code,' +
      'version,created_at,updated_at) ' +
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'REQUESTED',$10,$11,$12,NULL,NULL,1,$13::timestamptz,$13::timestamptz) " +
      'RETURNING refund_id',
      [
        refundId, PROVIDER, payment.merchant_id, input.customerId, payment.order_id, payment.payment_id,
        input.amountMinor, input.capturedAmountMinor, payment.currency, reason, input.idempotencyKey,
        requestHash, createdAt,
      ],
    );
  } catch (error) {
    const mapped = mapRefundInsertError(error);
    if (errorCode(error) === '23505' || errorCode(error) === '23514') {
      try {
        // The BEFORE INSERT source guard can reject an identical concurrent
        // replay on remaining balance before the unique key is checked.
        const raced = await readRefundByCustomerAndKey(db, input.customerId, input.idempotencyKey);
        if (raced) return replayOrConflict(raced, requestHash);
      } catch (recoveryError) {
        if (recoveryError instanceof RefundPersistenceError) throw recoveryError;
        throw mapReadError();
      }
    }
    throw mapped;
  }

  let row: RefundRow | null;
  try {
    row = await readRefundById(db, refundId);
  } catch {
    throw mapReadError();
  }
  if (!row) throw mapReadError();
  return { refund: toDto(row), replayed: false };
}

/** Record only the provider API acknowledgement; signed webhooks finalize outcomes. */
export async function recordHyperswitchRefundAcknowledgementPostgres(
  db: W07WebhookPostgresPool,
  refund: HyperswitchRefund,
  dependencies: Pick<RefundPersistenceDependencies, 'now'> = {},
): Promise<RefundDto> {
  let row: RefundRow | null;
  try {
    row = await readRefundById(db, refund.refundId);
  } catch {
    throw mapReadError();
  }
  if (!row) throw new RefundPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (row.payment_id !== refund.paymentId || row.amount_minor !== refund.amount ||
      row.currency !== refund.currency) {
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
  if (row.status !== 'REQUESTED' && row.status !== 'RECONCILIATION_REQUIRED') return toDto(row);

  const updatedAt = nextTimestamp(nowIso(dependencies.now), row.updated_at);
  try {
    await db.query(
      'UPDATE refunds SET status = $1, outcome_code = $2, version = version + 1, updated_at = $3::timestamptz ' +
      "WHERE refund_id = $4 AND version = $5 AND status IN ('REQUESTED','RECONCILIATION_REQUIRED') " +
      'RETURNING refund_id',
      [nextStatus, outcomeCode, updatedAt, row.refund_id, row.version],
    );
  } catch {
    throw mapReadError();
  }

  let latest: RefundRow | null;
  try {
    latest = await readRefundById(db, refund.refundId);
  } catch {
    throw mapReadError();
  }
  if (!latest) throw mapReadError();
  return toDto(latest);
}

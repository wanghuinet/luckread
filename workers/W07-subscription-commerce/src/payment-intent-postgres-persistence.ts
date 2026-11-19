/// <reference types="@cloudflare/workers-types" />

import {
  sha256BytesToHex,
  sha256CanonicalJsonForIdempotency,
} from '../../W10-async/src/canonical-json-idempotency.js';
import type { HyperswitchPayment } from './hyperswitch-client.js';
import {
  PaymentPersistenceError,
  type PaymentAttemptCreation,
  type PaymentAttemptDto,
  type PaymentAttemptStatus,
  type PaymentPersistenceDependencies,
} from './payment-persistence.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';

type PaymentRow = Readonly<{
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
}>;

type OrderRow = Readonly<{
  order_id: string;
  customer_id: string;
  status: string;
  currency: string;
  total_minor: number;
  has_demo_pricing: number;
}>;

const PROVIDER = 'hyperswitch';
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function nonBlank(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
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

function strictlyAfter(now: string, previous: string): string {
  const nowMillis = Date.parse(now);
  const previousMillis = Date.parse(previous);
  if (!Number.isFinite(nowMillis) || !Number.isFinite(previousMillis)) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  return new Date(Math.max(nowMillis, previousMillis + 1)).toISOString();
}

function defaultPaymentId(): string {
  return 'pay_' + crypto.randomUUID().replace(/-/g, '').slice(0, 26);
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

async function requestHashes(input: Readonly<{
  customerId: string;
  orderId: string;
  merchantId: string;
  amountMinor: number;
  currency: string;
}>): Promise<readonly string[]> {
  const payload = {
    operation: 'createPaymentAttempt',
    customerId: input.customerId,
    orderId: input.orderId,
    provider: PROVIDER,
    merchantId: input.merchantId,
    amountMinor: input.amountMinor,
    currency: input.currency,
  };
  try {
    const fingerprint = await sha256CanonicalJsonForIdempotency(payload, 8192);
    const canonical = fingerprint.slice('sha256:'.length);
    const legacy = await sha256BytesToHex(new TextEncoder().encode(JSON.stringify(payload)));
    return canonical === legacy ? [canonical] : [canonical, legacy];
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
}

const PAYMENT_COLUMNS =
  'payment_id, order_id, customer_id, provider, merchant_id, amount_minor::double precision AS amount_minor, ' +
  'currency, status, version::double precision AS version, idempotency_key, request_hash, ' +
  "CASE WHEN provider_updated_at IS NULL THEN NULL ELSE to_char(provider_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END AS provider_updated_at, " +
  'failure_code, to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS created_at, ' +
  'to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS updated_at';

async function readPaymentByCustomerAndKey(
  db: W07WebhookPostgresPool,
  customerId: string,
  idempotencyKey: string,
): Promise<PaymentRow | null> {
  const result = await db.query<PaymentRow & Record<string, unknown>>(
    `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE customer_id = $1 AND idempotency_key = $2 LIMIT 1`,
    [customerId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function readPaymentByOrder(
  db: W07WebhookPostgresPool,
  customerId: string,
  orderId: string,
): Promise<PaymentRow | null> {
  const result = await db.query<PaymentRow & Record<string, unknown>>(
    `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE customer_id = $1 AND order_id = $2 AND status NOT IN ('failed','cancelled','cancelled_post_capture','expired') LIMIT 1`,
    [customerId, orderId],
  );
  return result.rows[0] ?? null;
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
 * Native D1-04 PostgreSQL persistence for a customer-present payment attempt.
 * The order, payment attempt and idempotency keys remain in the finance domain.
 */
export async function createPaymentAttemptPostgres(
  db: W07WebhookPostgresPool,
  customerIdInput: string,
  orderIdInput: string,
  idempotencyKeyInput: string | null | undefined,
  expectedMerchantIdInput: string | null | undefined,
  dependencies: Pick<PaymentPersistenceDependencies, 'now' | 'createPaymentId' | 'paymentEnvironment'> = {},
): Promise<PaymentAttemptCreation> {
  if (!nonBlank(customerIdInput, 256) || !nonBlank(orderIdInput, 255)) {
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

  let order: OrderRow | undefined;
  try {
    const selected = await db.query<OrderRow & Record<string, unknown>>(
      'SELECT o.order_id, o.customer_id, o.status, o.currency, o.total_minor::double precision AS total_minor, ' +
      "CASE WHEN EXISTS (SELECT 1 FROM order_lines AS demo_lines WHERE demo_lines.order_id = o.order_id AND " +
      "(demo_lines.item_snapshot_json::jsonb #>> '{luckreadPricing,mode}') = 'demo') THEN 1 ELSE 0 END AS has_demo_pricing " +
      'FROM orders AS o WHERE o.order_id = $1 AND o.customer_id = $2 LIMIT 1',
      [orderIdInput, customerIdInput],
    );
    order = selected.rows[0];
  } catch {
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

  let existing: PaymentRow | null;
  try {
    existing = await readPaymentByCustomerAndKey(db, customerIdInput, idempotencyKeyInput);
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (existing) {
    const hashes = await requestHashes({
      customerId: customerIdInput, orderId: orderIdInput, merchantId: expectedMerchantIdInput,
      amountMinor: existing.amount_minor, currency: existing.currency,
    });
    return replayOrConflict(existing, hashes, pricingMode);
  }

  if (!['CREATED', 'PENDING_PAYMENT'].includes(order.status) ||
      !safeMinor(order.total_minor) || !CURRENCY_PATTERN.test(order.currency)) {
    throw new PaymentPersistenceError('CONFLICT', 409);
  }

  const hashes = await requestHashes({
    customerId: customerIdInput, orderId: order.order_id, merchantId: expectedMerchantIdInput,
    amountMinor: order.total_minor, currency: order.currency,
  });
  const createdAt = parseDate(dependencies.now ?? (() => new Date()));
  const paymentId = (dependencies.createPaymentId ?? defaultPaymentId)();
  if (!PAYMENT_ID_PATTERN.test(paymentId)) {
    throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  try {
    const inserted = await db.query<{ payment_id: string } & Record<string, unknown>>(
      'INSERT INTO payments ' +
      '(payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
      'idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at) ' +
      "VALUES ($1, $2, $3, 'hyperswitch', $4, $5, $6, 'INITIATING', 1, $7, $8, NULL, NULL, $9::timestamptz, $9::timestamptz) " +
      'RETURNING payment_id',
      [paymentId, order.order_id, customerIdInput, expectedMerchantIdInput, order.total_minor,
        order.currency, idempotencyKeyInput, hashes[0], createdAt],
    );
    if (inserted.rows.length !== 1) throw new PaymentPersistenceError('INTEGRITY_VIOLATION', 500);
    return {
      payment: {
        paymentId, orderId: order.order_id, amountMinor: order.total_minor, currency: order.currency,
        status: 'INITIATING', version: 1, providerUpdatedAt: null, createdAt, updatedAt: createdAt,
      },
      replayed: false,
      pricingMode,
    };
  } catch (error) {
    if (error instanceof PaymentPersistenceError) throw error;
    try {
      const raced = await readPaymentByCustomerAndKey(db, customerIdInput, idempotencyKeyInput);
      if (raced) return replayOrConflict(raced, hashes, pricingMode);
      const live = await readPaymentByOrder(db, customerIdInput, order.order_id);
      if (live) throw new PaymentPersistenceError('CONFLICT', 409);
    } catch (recoveryError) {
      if (recoveryError instanceof PaymentPersistenceError) throw recoveryError;
      throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
    }
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
}

/** Persist only the validated non-secret provider status after intent creation. */
export async function recordUnconfirmedHyperswitchIntentPostgres(
  db: W07WebhookPostgresPool,
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
  if (providerPayment.paymentId !== paymentIdInput ||
      providerPayment.merchantId !== expectedMerchantIdInput ||
      !safeMinor(providerPayment.amount) || !CURRENCY_PATTERN.test(providerPayment.currency) ||
      !['requires_payment_method', 'requires_confirmation'].includes(providerPayment.status)) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
  }

  let existing: PaymentRow | undefined;
  try {
    const selected = await db.query<PaymentRow & Record<string, unknown>>(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE payment_id = $1 AND customer_id = $2 LIMIT 1`,
      [paymentIdInput, customerIdInput],
    );
    existing = selected.rows[0];
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!existing) throw new PaymentPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (existing.merchant_id !== expectedMerchantIdInput ||
      existing.amount_minor !== providerPayment.amount || existing.currency !== providerPayment.currency) {
    throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
  }
  if (existing.status === providerPayment.status && existing.version >= 2) return toDto(existing);
  if (existing.status !== 'INITIATING' || existing.version !== 1) {
    throw new PaymentPersistenceError('CONFLICT', 409);
  }

  const updatedAt = strictlyAfter(
    parseDate(dependencies.now ?? (() => new Date())),
    existing.updated_at,
  );
  try {
    const updated = await db.query<{ payment_id: string } & Record<string, unknown>>(
      "UPDATE payments SET status = $1, version = version + 1, updated_at = $2::timestamptz " +
      "WHERE payment_id = $3 AND customer_id = $4 AND merchant_id = $5 AND amount_minor = $6 AND currency = $7 " +
      "AND status = 'INITIATING' AND version = 1 RETURNING payment_id",
      [providerPayment.status, updatedAt, paymentIdInput, customerIdInput, expectedMerchantIdInput,
        providerPayment.amount, providerPayment.currency],
    );
    if (updated.rows.length === 1) {
      return { ...toDto(existing), status: providerPayment.status, version: 2, updatedAt };
    }
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }

  try {
    const raced = await db.query<PaymentRow & Record<string, unknown>>(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE payment_id = $1 AND customer_id = $2 LIMIT 1`,
      [paymentIdInput, customerIdInput],
    );
    const row = raced.rows[0];
    if (row && row.status === providerPayment.status && row.version >= 2) return toDto(row);
  } catch {
    throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  throw new PaymentPersistenceError('CONFLICT', 409);
}

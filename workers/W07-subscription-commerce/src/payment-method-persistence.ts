/// <reference types="@cloudflare/workers-types" />

import { strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js';

export type PaymentMethodRevocationState =
  | 'REQUESTED'
  | 'PENDING_PROVIDER'
  | 'RECONCILIATION_REQUIRED'
  | 'COMPLETED';

export type SavedPaymentMethodMandateStatus =
  | 'ACTIVE'
  | 'PENDING_PROVIDER_CONFIRMATION'
  | 'REVOKED'
  | 'FAILED'
  | 'EXPIRED'
  | 'NONE';

export type SavedPaymentMethodRecord = Readonly<{
  savedPaymentMethodId: string;
  paymentMethodId: string;
  createdAt: string;
  mandateStatus: SavedPaymentMethodMandateStatus;
  revocationStatus: PaymentMethodRevocationState | null;
}>;

export type SavedPaymentMethodMandate = Readonly<{
  mandateRecordId: string;
  providerMandateId: string | null;
  paymentMethodId: string;
  status: SavedPaymentMethodMandateStatus;
}>;

export type PaymentMethodRevocationRequest = Readonly<{
  revocationRequestId: string;
  savedPaymentMethodId: string;
  paymentMethodId: string;
  customerId: string;
  merchantId: string;
  idempotencyKey: string;
  status: PaymentMethodRevocationState;
  providerMethodDeletedAt: string | null;
  version: number;
  updatedAt: string;
}>;

export class PaymentMethodPersistenceError extends Error {
  constructor(
    readonly code: 'VALIDATION_FAILED' | 'RESOURCE_NOT_FOUND' | 'CONFLICT' | 'SERVICE_UNAVAILABLE',
    readonly status: number,
  ) {
    super(code);
    this.name = 'PaymentMethodPersistenceError';
  }
}

type SavedPaymentMethodRow = {
  saved_payment_method_id: string;
  payment_method_id: string;
  created_at: string;
  mandate_status: SavedPaymentMethodMandateStatus;
  revocation_status: PaymentMethodRevocationState | null;
};

type MandateRow = {
  mandate_record_id: string;
  provider_mandate_id: string | null;
  payment_method_id: string;
  status: SavedPaymentMethodMandateStatus;
};

type RevocationRequestRow = {
  revocation_request_id: string;
  saved_payment_method_id: string;
  payment_method_id: string;
  provider: string;
  merchant_id: string;
  customer_id: string;
  idempotency_key: string;
  status: PaymentMethodRevocationState;
  provider_method_deleted_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

const PROVIDER = 'hyperswitch';
const SAVED_METHOD_ID = /^spm_[A-Za-z0-9]{26}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,128}$/;

function validateOwner(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new PaymentMethodPersistenceError('VALIDATION_FAILED', 400);
  }
  return value;
}

function toRequest(row: RevocationRequestRow): PaymentMethodRevocationRequest {
  return {
    revocationRequestId: row.revocation_request_id,
    savedPaymentMethodId: row.saved_payment_method_id,
    paymentMethodId: row.payment_method_id,
    customerId: row.customer_id,
    merchantId: row.merchant_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    providerMethodDeletedAt: row.provider_method_deleted_at,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

async function readRevocationRequest(
  db: D1Database,
  savedPaymentMethodId: string,
  customerId: string,
  merchantId: string,
): Promise<RevocationRequestRow | null> {
  return db.prepare(
    'SELECT revocation_request_id, saved_payment_method_id, payment_method_id, provider, merchant_id, customer_id, idempotency_key, ' +
    'status, provider_method_deleted_at, version, created_at, updated_at ' +
    'FROM payment_method_revocation_requests WHERE saved_payment_method_id = ? AND customer_id = ? AND merchant_id = ? LIMIT 1',
  ).bind(savedPaymentMethodId, customerId, merchantId).first<RevocationRequestRow>();
}

/** Return only payment methods backed by the customer's verified payment_succeeded webhook. */
export async function listSavedPaymentMethodRecords(
  db: D1Database,
  customerIdInput: string,
  merchantIdInput: string,
): Promise<readonly SavedPaymentMethodRecord[]> {
  const customerId = validateOwner(customerIdInput);
  const merchantId = validateOwner(merchantIdInput);
  let rows: { results?: SavedPaymentMethodRow[] };
  try {
    rows = await db.prepare(
      'SELECT s.saved_payment_method_id, s.payment_method_id, s.created_at, ' +
      "CASE WHEN EXISTS (SELECT 1 FROM payment_mandates m WHERE m.provider = s.provider AND m.merchant_id = s.merchant_id AND m.customer_id = s.customer_id AND m.payment_method_id = s.payment_method_id AND m.status = 'ACTIVE') THEN 'ACTIVE' " +
      "WHEN EXISTS (SELECT 1 FROM payment_mandates m WHERE m.provider = s.provider AND m.merchant_id = s.merchant_id AND m.customer_id = s.customer_id AND m.payment_method_id = s.payment_method_id AND m.status = 'PENDING_PROVIDER_CONFIRMATION') THEN 'PENDING_PROVIDER_CONFIRMATION' " +
      "WHEN EXISTS (SELECT 1 FROM payment_mandates m WHERE m.provider = s.provider AND m.merchant_id = s.merchant_id AND m.customer_id = s.customer_id AND m.payment_method_id = s.payment_method_id AND m.status = 'REVOKED') THEN 'REVOKED' " +
      "WHEN EXISTS (SELECT 1 FROM payment_mandates m WHERE m.provider = s.provider AND m.merchant_id = s.merchant_id AND m.customer_id = s.customer_id AND m.payment_method_id = s.payment_method_id AND m.status = 'EXPIRED') THEN 'EXPIRED' " +
      "WHEN EXISTS (SELECT 1 FROM payment_mandates m WHERE m.provider = s.provider AND m.merchant_id = s.merchant_id AND m.customer_id = s.customer_id AND m.payment_method_id = s.payment_method_id AND m.status = 'FAILED') THEN 'FAILED' " +
      "ELSE 'NONE' END AS mandate_status, r.status AS revocation_status " +
      'FROM saved_payment_methods s LEFT JOIN payment_method_revocation_requests r ON r.saved_payment_method_id = s.saved_payment_method_id ' +
      'WHERE s.provider = ? AND s.merchant_id = ? AND s.customer_id = ? ' +
      "AND (r.revocation_request_id IS NULL OR r.status <> 'COMPLETED') " +
      'ORDER BY s.created_at DESC, s.saved_payment_method_id DESC LIMIT 100',
    ).bind(PROVIDER, merchantId, customerId).all<SavedPaymentMethodRow>();
  } catch {
    throw new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  return (rows.results ?? []).map((row) => ({
    savedPaymentMethodId: row.saved_payment_method_id,
    paymentMethodId: row.payment_method_id,
    createdAt: row.created_at,
    mandateStatus: row.mandate_status,
    revocationStatus: row.revocation_status,
  }));
}

/** Resolve the complete local mandate set before any provider revocation is attempted. */
export async function getSavedPaymentMethodMandates(
  db: D1Database,
  customerIdInput: string,
  merchantIdInput: string,
  savedPaymentMethodId: string,
): Promise<readonly SavedPaymentMethodMandate[]> {
  const customerId = validateOwner(customerIdInput);
  const merchantId = validateOwner(merchantIdInput);
  if (!SAVED_METHOD_ID.test(savedPaymentMethodId)) throw new PaymentMethodPersistenceError('RESOURCE_NOT_FOUND', 404);
  try {
    const result = await db.prepare(
      'SELECT m.mandate_record_id, m.provider_mandate_id, m.payment_method_id, m.status ' +
      'FROM payment_mandates m JOIN saved_payment_methods s ' +
      'ON s.provider = m.provider AND s.merchant_id = m.merchant_id AND s.customer_id = m.customer_id AND s.payment_method_id = m.payment_method_id ' +
      'WHERE s.saved_payment_method_id = ? AND s.provider = ? AND s.merchant_id = ? AND s.customer_id = ? ' +
      'ORDER BY m.created_at ASC, m.mandate_record_id ASC',
    ).bind(savedPaymentMethodId, PROVIDER, merchantId, customerId).all<MandateRow>();
    return (result.results ?? []).map((row) => ({
      mandateRecordId: row.mandate_record_id,
      providerMandateId: row.provider_mandate_id,
      paymentMethodId: row.payment_method_id,
      status: row.status,
    }));
  } catch {
    throw new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
}

/** Persist the local MIT block before contacting Hyperswitch; the action is one-way and resource-scoped. */
/**
 * First invocation persists only the MIT block (one D1-04 write transaction).
 * A later replay of the same resource request is allowed to perform provider
 * I/O and its own single status-update transaction. This keeps the public
 * mutation budget at one D1-04 write transaction per request.
 */
export async function createPaymentMethodRevocationRequest(
  db: D1Database,
  customerIdInput: string,
  merchantIdInput: string,
  savedPaymentMethodId: string,
  idempotencyKeyInput: string,
  nowInput: string,
  createId: () => string = () => 'pmr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 26),
): Promise<Readonly<{
  request: PaymentMethodRevocationRequest;
  replayed: boolean;
  dispatchProvider: boolean;
}>> {
  const customerId = validateOwner(customerIdInput);
  const merchantId = validateOwner(merchantIdInput);
  if (!SAVED_METHOD_ID.test(savedPaymentMethodId) || !IDEMPOTENCY_KEY.test(idempotencyKeyInput)) {
    throw new PaymentMethodPersistenceError('VALIDATION_FAILED', 400);
  }
  const nowMs = Date.parse(nowInput);
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== nowInput) {
    throw new PaymentMethodPersistenceError('VALIDATION_FAILED', 400);
  }

  // A pre-existing request is the explicit provider-dispatch retry. This path
  // is read-only until the provider result can be committed in one later write.
  const existing = await readRevocationRequest(
    db, savedPaymentMethodId, customerId, merchantId,
  ).catch(() => {
    throw new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503);
  });
  if (existing) {
    if (existing.idempotency_key !== idempotencyKeyInput) {
      throw new PaymentMethodPersistenceError('CONFLICT', 409);
    }
    return { request: toRequest(existing), replayed: true, dispatchProvider: true };
  }

  const revocationRequestId = createId();
  if (!/^pmr_[A-Za-z0-9]{26}$/.test(revocationRequestId)) {
    throw new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  try {
    // INSERT .. SELECT proves customer, merchant and provider-method ownership
    // in the same D1 statement. Even a concurrent uniqueness winner is not
    // dispatched in this invocation; its caller must replay after the insert.
    await db.prepare(
      'INSERT INTO payment_method_revocation_requests ' +
      '(revocation_request_id, saved_payment_method_id, payment_method_id, provider, merchant_id, customer_id, idempotency_key, status, provider_method_deleted_at, version, created_at, updated_at) ' +
      "SELECT ?, s.saved_payment_method_id, s.payment_method_id, 'hyperswitch', s.merchant_id, s.customer_id, ?, 'REQUESTED', NULL, 1, ?, ? " +
      'FROM saved_payment_methods s WHERE s.saved_payment_method_id = ? AND s.provider = ? AND s.merchant_id = ? AND s.customer_id = ? ' +
      'ON CONFLICT(saved_payment_method_id) DO NOTHING',
    ).bind(revocationRequestId, idempotencyKeyInput, nowInput, nowInput,
      savedPaymentMethodId, PROVIDER, merchantId, customerId).run();
  } catch {
    throw new PaymentMethodPersistenceError('CONFLICT', 409);
  }
  const created = await readRevocationRequest(
    db, savedPaymentMethodId, customerId, merchantId,
  ).catch(() => null);
  if (!created) throw new PaymentMethodPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (created.idempotency_key !== idempotencyKeyInput) {
    throw new PaymentMethodPersistenceError('CONFLICT', 409);
  }
  // dispatchProvider=false for both the insertion winner and a concurrent
  // conflict-loser. Neither path may follow the INSERT with another D1 write.
  return {
    request: toRequest(created),
    replayed: created.revocation_request_id !== revocationRequestId,
    dispatchProvider: false,
  };
}


/** Save provider method deletion acknowledgement; complete only when every linked mandate is terminal. */
/** Save provider method deletion acknowledgement and derive terminality atomically from current D1-04 mandates. */
export async function markPaymentMethodProviderDeleted(
  db: D1Database,
  input: PaymentMethodRevocationRequest,
  nowInput: string,
): Promise<PaymentMethodRevocationRequest> {
  if (input.status === 'COMPLETED') return input;
  const updatedAt = strictlyAfterCanonicalUtcTimestamp(nowInput, input.updatedAt);
  if (updatedAt === null) throw new PaymentMethodPersistenceError('VALIDATION_FAILED', 400);
  try {
    const result = await db.prepare(
      'UPDATE payment_method_revocation_requests SET provider_method_deleted_at = COALESCE(provider_method_deleted_at, ?), ' +
      "status = CASE WHEN NOT EXISTS (SELECT 1 FROM payment_mandates m JOIN saved_payment_methods s " +
      "ON s.provider = m.provider AND s.merchant_id = m.merchant_id AND s.customer_id = m.customer_id AND s.payment_method_id = m.payment_method_id " +
      "WHERE s.saved_payment_method_id = payment_method_revocation_requests.saved_payment_method_id " +
      "AND m.status NOT IN ('REVOKED','FAILED','EXPIRED')) THEN 'COMPLETED' ELSE 'PENDING_PROVIDER' END, " +
      'version = version + 1, updated_at = ? ' +
      "WHERE revocation_request_id = ? AND customer_id = ? AND version = ? AND status <> 'COMPLETED'",
    ).bind(nowInput, updatedAt, input.revocationRequestId, input.customerId, input.version).run();
    if (Number(result.meta?.changes ?? 0) !== 1) {
      const raced = await readRevocationRequest(db, input.savedPaymentMethodId, input.customerId, input.merchantId).catch(() => null);
      // A concurrent exact removal request may have completed the provider
      // delete and advanced the same durable revocation row. Reuse its state.
      if (raced?.provider_method_deleted_at !== null && raced !== null) return toRequest(raced);
      throw new PaymentMethodPersistenceError('CONFLICT', 409);
    }
    const updated = await readRevocationRequest(db, input.savedPaymentMethodId, input.customerId, input.merchantId).catch(() => null);
    if (!updated) throw new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503);
    return toRequest(updated);
  } catch (error) {
    if (error instanceof PaymentMethodPersistenceError) throw error;
    throw new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
}

/** Atomically finish a pending method-removal request only after a signed mandate_revoked event is applied. */
export function buildCompletePaymentMethodRevocationOnMandateWebhook(
  db: D1Database,
  merchantId: string,
  customerId: string,
  paymentMethodId: string,
  nowInput: string,
): D1PreparedStatement {
  return db.prepare(
    "UPDATE payment_method_revocation_requests SET status = 'COMPLETED', version = version + 1, " +
    "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(updated_at) + (1.0 / 86400000.0), julianday(?))) " +
    "WHERE provider = 'hyperswitch' AND merchant_id = ? AND customer_id = ? " +
    "AND status IN ('REQUESTED','PENDING_PROVIDER','RECONCILIATION_REQUIRED') AND provider_method_deleted_at IS NOT NULL " +
    'AND EXISTS (SELECT 1 FROM saved_payment_methods s WHERE s.saved_payment_method_id = payment_method_revocation_requests.saved_payment_method_id ' +
    'AND s.provider = ? AND s.merchant_id = ? AND s.customer_id = ? AND s.payment_method_id = ?) ' +
    'AND NOT EXISTS (SELECT 1 FROM payment_mandates m JOIN saved_payment_methods s ON s.provider = m.provider AND s.merchant_id = m.merchant_id AND s.customer_id = m.customer_id AND s.payment_method_id = m.payment_method_id ' +
    'WHERE s.saved_payment_method_id = payment_method_revocation_requests.saved_payment_method_id AND m.status NOT IN (\'REVOKED\',\'FAILED\',\'EXPIRED\'))',
  ).bind(nowInput, merchantId, customerId, PROVIDER, merchantId, customerId, paymentMethodId);
}

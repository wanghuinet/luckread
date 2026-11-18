/// <reference types="@cloudflare/workers-types" />

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

const PROVIDER = 'hyperswitch';

/** Atomically finish a pending method-removal request only after a signed mandate_revoked event is applied. */
export function buildCompletePaymentMethodRevocationOnMandateWebhook(
  db: D1Database,
  merchantId: string,
  customerId: string,
  paymentMethodId: string,
  nowInput: string,
  databaseDialect: 'd1' | 'postgres' = 'd1',
): D1PreparedStatement {
  const updatedAtExpression = databaseDialect === 'postgres'
    ? "GREATEST(updated_at + INTERVAL '1 millisecond', ?::timestamptz)"
    : "strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(updated_at) + (1.0 / 86400000.0), julianday(?)))";
  return db.prepare(
    "UPDATE payment_method_revocation_requests SET status = 'COMPLETED', version = version + 1, " +
    "updated_at = " + updatedAtExpression + " " +
    "WHERE provider = 'hyperswitch' AND merchant_id = ? AND customer_id = ? " +
    "AND status IN ('REQUESTED','PENDING_PROVIDER','RECONCILIATION_REQUIRED') AND provider_method_deleted_at IS NOT NULL " +
    'AND EXISTS (SELECT 1 FROM saved_payment_methods s WHERE s.saved_payment_method_id = payment_method_revocation_requests.saved_payment_method_id ' +
    'AND s.provider = ? AND s.merchant_id = ? AND s.customer_id = ? AND s.payment_method_id = ?) ' +
    'AND NOT EXISTS (SELECT 1 FROM payment_mandates m JOIN saved_payment_methods s ON s.provider = m.provider AND s.merchant_id = m.merchant_id AND s.customer_id = m.customer_id AND s.payment_method_id = m.payment_method_id ' +
    'WHERE s.saved_payment_method_id = payment_method_revocation_requests.saved_payment_method_id AND m.status NOT IN (\'REVOKED\',\'FAILED\',\'EXPIRED\'))',
  ).bind(nowInput, merchantId, customerId, PROVIDER, merchantId, customerId, paymentMethodId);
}

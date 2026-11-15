/// <reference types="@cloudflare/workers-types" />

import {
  createPaymentMethodRevocationRequest,
  getSavedPaymentMethodMandates,
  listSavedPaymentMethodRecords,
  markPaymentMethodProviderDeleted,
  type PaymentMethodRevocationRequest,
  type SavedPaymentMethodMandate,
  type SavedPaymentMethodRecord,
} from './payment-method-persistence.js'

export type CreatePaymentMethodRevocationResult = Readonly<{
  request: PaymentMethodRevocationRequest
  replayed: boolean
  dispatchProvider: boolean
}>

/**
 * Single persistence boundary for saved methods, mandates and revocation state.
 * D1 and PostgreSQL implementations must preserve identical ownership,
 * idempotency and version-CAS semantics.
 */
export interface PaymentMethodReadStore {
  listSavedPaymentMethodRecords(
    customerId: string,
    merchantId: string,
  ): Promise<readonly SavedPaymentMethodRecord[]>

  getSavedPaymentMethodMandates(
    customerId: string,
    merchantId: string,
    savedPaymentMethodId: string,
  ): Promise<readonly SavedPaymentMethodMandate[]>

  createPaymentMethodRevocationRequest(
    customerId: string,
    merchantId: string,
    savedPaymentMethodId: string,
    idempotencyKey: string,
    now: string,
    createId?: () => string,
  ): Promise<CreatePaymentMethodRevocationResult>

  markPaymentMethodProviderDeleted(
    input: PaymentMethodRevocationRequest,
    now: string,
  ): Promise<PaymentMethodRevocationRequest>

  completePaymentMethodRevocationOnMandateWebhook(
    merchantId: string,
    customerId: string,
    paymentMethodId: string,
    now: string,
  ): Promise<void>
}

/** D1 remains the production adapter until a separate reviewed cutover. */
export function createD1PaymentMethodReadStore(db: D1Database): PaymentMethodReadStore {
  return {
    listSavedPaymentMethodRecords: (customerId, merchantId) =>
      listSavedPaymentMethodRecords(db, customerId, merchantId),
    getSavedPaymentMethodMandates: (customerId, merchantId, savedPaymentMethodId) =>
      getSavedPaymentMethodMandates(db, customerId, merchantId, savedPaymentMethodId),
    createPaymentMethodRevocationRequest: (
      customerId, merchantId, savedPaymentMethodId, idempotencyKey, now, createId,
    ) => createPaymentMethodRevocationRequest(
      db, customerId, merchantId, savedPaymentMethodId, idempotencyKey, now, createId,
    ),
    markPaymentMethodProviderDeleted: (input, now) =>
      markPaymentMethodProviderDeleted(db, input, now),
    async completePaymentMethodRevocationOnMandateWebhook(
      merchantId, customerId, paymentMethodId, now,
    ) {
      await db.prepare(
        "UPDATE payment_method_revocation_requests SET status = 'COMPLETED', version = version + 1, " +
        "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(updated_at) + (1.0 / 86400000.0), julianday(?))) " +
        "WHERE provider = 'hyperswitch' AND merchant_id = ? AND customer_id = ? " +
        "AND status IN ('REQUESTED','PENDING_PROVIDER','RECONCILIATION_REQUIRED') AND provider_method_deleted_at IS NOT NULL " +
        'AND EXISTS (SELECT 1 FROM saved_payment_methods s WHERE s.saved_payment_method_id = payment_method_revocation_requests.saved_payment_method_id ' +
        'AND s.provider = ? AND s.merchant_id = ? AND s.customer_id = ? AND s.payment_method_id = ?) ' +
        "AND NOT EXISTS (SELECT 1 FROM payment_mandates m JOIN saved_payment_methods s ON s.provider = m.provider AND s.merchant_id = m.merchant_id AND s.customer_id = m.customer_id AND s.payment_method_id = m.payment_method_id " +
        "WHERE s.saved_payment_method_id = payment_method_revocation_requests.saved_payment_method_id AND m.status NOT IN ('REVOKED','FAILED','EXPIRED'))",
      ).bind(now, merchantId, customerId, 'hyperswitch', merchantId, customerId, paymentMethodId).run()
    },
  }
}

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

  }
}

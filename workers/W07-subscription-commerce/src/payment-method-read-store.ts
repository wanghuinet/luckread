/// <reference types="@cloudflare/workers-types" />

import {
  getSavedPaymentMethodMandates,
  listSavedPaymentMethodRecords,
  type SavedPaymentMethodMandate,
  type SavedPaymentMethodRecord,
} from './payment-method-persistence.js'

/**
 * Read-only persistence boundary for W07 saved-method and MIT-mandate
 * ownership queries. Mutations and signed-webhook completion remain in their
 * existing D1 transaction path in this slice.
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
}

/** D1 remains the production adapter until a separate reviewed cutover. */
export function createD1PaymentMethodReadStore(db: D1Database): PaymentMethodReadStore {
  return {
    listSavedPaymentMethodRecords: (customerId, merchantId) =>
      listSavedPaymentMethodRecords(db, customerId, merchantId),
    getSavedPaymentMethodMandates: (customerId, merchantId, savedPaymentMethodId) =>
      getSavedPaymentMethodMandates(db, customerId, merchantId, savedPaymentMethodId),
  }
}

import {
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
 * PostgreSQL persistence boundary for saved methods, mandates and revocation state.
 * Ownership, idempotency and version-CAS semantics are enforced by the native Store.
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


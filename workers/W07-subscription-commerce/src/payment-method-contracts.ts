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

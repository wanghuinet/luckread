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

export type RefundReservation = Readonly<{
  refund: RefundDto;
  replayed: boolean;
}>;

export type RefundPersistenceDependencies = Readonly<{
  now?: () => Date;
  createRefundId?: () => string;
}>;

export type RefundPaymentReference = Readonly<{
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  merchantId: string;
}>;

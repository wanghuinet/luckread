export type PaymentAttemptStatus =
  | 'INITIATING'
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_customer_action'
  | 'requires_merchant_action'
  | 'requires_capture'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'cancelled_post_capture'
  | 'partially_captured'
  | 'partially_captured_and_capturable'
  | 'expired';

export type PaymentAttemptDto = Readonly<{
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: PaymentAttemptStatus;
  version: number;
  providerUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PaymentPersistenceErrorCode =
  | 'VALIDATION_FAILED'
  | 'PRECONDITION_REQUIRED'
  | 'RESOURCE_NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
  | 'INVALID_SIGNATURE'
  | 'WEBHOOK_REJECTED'
  | 'INTEGRITY_VIOLATION'
  | 'SERVICE_UNAVAILABLE';

export class PaymentPersistenceError extends Error {
  constructor(
    readonly code: PaymentPersistenceErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = 'PaymentPersistenceError';
  }
}

export type PaymentAttemptCreation = Readonly<{
  payment: PaymentAttemptDto;
  replayed: boolean;
  pricingMode: 'live' | 'demo';
}>;

export type WebhookReceiptState =
  | 'RECEIVED'
  | 'APPLIED'
  | 'RECONCILIATION_REQUIRED'
  | 'REJECTED';

export type WebhookReceiptResult = Readonly<{
  outcome: 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED' | 'DUPLICATE' | 'PAYLOAD_CONFLICT';
  eventId: string;
  receiptId: string;
  state: WebhookReceiptState;
  payloadSha256: string;
  conflictId?: string;
}>;

export type ReceiveHyperswitchWebhookInput = Readonly<{
  rawBody: ArrayBuffer;
  signatureHeader: string | null | undefined;
  webhookSecret: string | null | undefined;
  expectedMerchantId: string;
}>;

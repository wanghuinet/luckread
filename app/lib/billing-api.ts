import { apiRequest } from './api-client';

export type BillingDocumentType = 'INVOICE' | 'RECEIPT';

export type BillingDocument = {
  documentId: string;
  documentType: BillingDocumentType;
  documentNumber: string;
  orderId: string;
  paymentId: string | null;
  amountMinor: number;
  currency: string;
  snapshot: Record<string, unknown>;
  issuedAt: string;
  createdAt: string;
};

export type PaymentHistoryItem = {
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: string;
  version: number;
  providerUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  refundedMinor: number;
};

export type RefundStatus =
  | 'REQUESTED'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REVIEW'
  | 'RECONCILIATION_REQUIRED';

export type RefundHistoryItem = {
  refundId: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: RefundStatus;
  reason: string | null;
  version: number;
  providerUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingCursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type RefundRequestResult = {
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
  replayed: boolean;
};

type PageOptions = {
  limit?: number;
  cursor?: string | null;
  signal?: AbortSignal;
};

const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function buildPageQuery(options: PageOptions = {}): string {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('Billing page size must be between 1 and 50.');
  }

  const cursor = options.cursor ?? null;
  if (cursor !== null && (
    typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 512
  )) {
    throw new RangeError('Billing cursor must be between 1 and 512 characters.');
  }

  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor !== null) query.set('cursor', cursor);
  return '?' + query.toString();
}

/** Customer-owned invoice and receipt snapshots via W01 -> W07. */
export function fetchBillingDocumentsPage(options: PageOptions = {}) {
  return apiRequest<unknown>('/billing/documents' + buildPageQuery(options), {
    method: 'GET',
    signal: options.signal,
  });
}

/** Customer-owned payment history via W01 -> W07. */
export function fetchPaymentHistoryPage(options: PageOptions = {}) {
  return apiRequest<unknown>('/payments/history' + buildPageQuery(options), {
    method: 'GET',
    signal: options.signal,
  });
}

/** Customer-owned refund history via W01 -> W07. */
export function fetchRefundHistoryPage(options: PageOptions = {}) {
  return apiRequest<unknown>('/payments/refunds' + buildPageQuery(options), {
    method: 'GET',
    signal: options.signal,
  });
}

/**
 * Request a full remaining-balance refund. W01 authorizes payment.refund and
 * W07 verifies payment ownership, provider-captured funds and refundable balance.
 * A 202 response is pending provider confirmation, not a completed refund.
 */
export function requestPaymentRefund(
  paymentId: string,
  amountMinor: number,
  currency: string,
  idempotencyKey: string,
  reason?: string,
) {
  if (typeof paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(paymentId)) {
    throw new TypeError('A valid payment ID is required.');
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new TypeError('Refund amount must be a positive integer in minor currency units.');
  }
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError('A valid ISO currency code is required.');
  }
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new TypeError('A valid refund idempotency key is required.');
  }
  if (reason !== undefined && (
    typeof reason !== 'string' || reason.length < 1 || reason.length > 255 ||
    reason.trim() !== reason || /[\u0000-\u001f\u007f]/.test(reason)
  )) {
    throw new TypeError('Refund reason must be a clean string of at most 255 characters.');
  }

  return apiRequest<unknown>('/payments/refunds', {
    method: 'POST',
    idempotencyKey,
    body: JSON.stringify({
      paymentId,
      amountMinor,
      currency,
      ...(reason === undefined ? {} : { reason }),
    }),
  });
}

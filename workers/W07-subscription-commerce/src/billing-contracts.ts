export type BillingDocumentDto = Readonly<{
  documentId: string;
  documentType: 'INVOICE' | 'RECEIPT';
  documentNumber: string;
  orderId: string;
  paymentId: string | null;
  amountMinor: number;
  currency: string;
  snapshot: Readonly<Record<string, unknown>>;
  issuedAt: string;
  createdAt: string;
}>;

export type CustomerPaymentHistoryItem = Readonly<{
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
}>;

export type CustomerRefundHistoryItem = Readonly<{
  refundId: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: string;
  reason: string | null;
  version: number;
  providerUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type BillingList<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

export class BillingPersistenceError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'CONFLICT'
      | 'INTEGRITY_VIOLATION'
      | 'SERVICE_UNAVAILABLE',
    readonly status: number,
  ) {
    super(code);
    this.name = 'BillingPersistenceError';
  }
}

const MAX_PAGE_SIZE = 50;

export type BillingHistoryCursor = Readonly<{ timestamp: string; id: string }>;

export function isValidBillingId(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

export function encodeBillingHistoryCursor(value: BillingHistoryCursor): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBillingHistoryCursor(value: string | null | undefined): BillingHistoryCursor | null {
  if (value == null || value === '') return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  }
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const parsed: unknown = JSON.parse(atob(padded));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid cursor');
    const candidate = parsed as Record<string, unknown>;
    if (!validIso(candidate.timestamp) || !isValidBillingId(candidate.id, 255)) throw new Error('invalid cursor');
    if (Object.keys(candidate).length !== 2) throw new Error('invalid cursor');
    return { timestamp: candidate.timestamp, id: candidate.id };
  } catch {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  }
}

export function validateBillingPageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  }
  return value;
}

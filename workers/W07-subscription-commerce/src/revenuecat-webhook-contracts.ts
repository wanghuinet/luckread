import type { RevenueCatWebhookEvent } from './revenuecat-webhook-signature.js';

export type RevenueCatWebhookReceiptResult = Readonly<{
  outcome: 'RECEIVED' | 'DUPLICATE' | 'PAYLOAD_CONFLICT';
  eventId: string;
  receiptId: string;
  payloadSha256: string;
}>;

export interface RevenueCatWebhookReceiptStore {
  record(event: RevenueCatWebhookEvent, rawBody: ArrayBuffer): Promise<RevenueCatWebhookReceiptResult>;
}

export class RevenueCatWebhookPersistenceError extends Error {
  constructor(readonly code: 'SERVICE_UNAVAILABLE' | 'INTEGRITY_VIOLATION') {
    super(code);
    this.name = 'RevenueCatWebhookPersistenceError';
  }
}

export type RevenueCatWebhookPersistenceDependencies = Readonly<{
  now?: () => Date;
  createEventRowId?: () => string;
  createConflictId?: () => string;
}>;

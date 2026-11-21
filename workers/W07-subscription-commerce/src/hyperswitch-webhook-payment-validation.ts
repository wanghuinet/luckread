import {
  isHyperswitchPaymentStatus,
  type HyperswitchPaymentStatus,
} from './hyperswitch-client.js';
import {
  isHyperswitchWebhookEventType,
  parseHyperswitchRfc3339Timestamp,
  type HyperswitchWebhookEnvelope,
  type HyperswitchWebhookEventType,
} from './hyperswitch-webhook-signature.js';

/**
 * A server-loaded payment reference from the authoritative commerce store.
 * This helper does not load or mutate that store itself.
 */
export interface KnownHyperswitchPaymentReference {
  paymentId: string;
  merchantId: string;
  amountMinor: number;
  currency: string;
  /** Provider resource.updated last accepted for this payment, or null for a first event. */
  lastProviderUpdatedAt: string | null;
}

export type HyperswitchPaymentWebhookDecision =
  | {
      outcome: 'VALIDATED';
      eventId: string;
      paymentId: string;
      eventType: HyperswitchWebhookEventType;
      providerStatus: HyperswitchPaymentStatus;
      providerUpdatedAt: string;
    }
  | {
      outcome: 'STALE';
      eventId: string;
      paymentId: string;
      incomingUpdatedAt: string;
      storedUpdatedAt: string;
    }
  | {
      outcome: 'RECONCILIATION_REQUIRED';
      reason:
        | 'UNSUPPORTED_EVENT_SEMANTICS'
        | 'MISSING_PROVIDER_UPDATED'
        | 'INVALID_PROVIDER_UPDATED'
        | 'INVALID_STORED_PROVIDER_UPDATED'
        | 'UNKNOWN_PROVIDER_STATUS';
      eventId: string;
      paymentId: string;
    }
  | {
      outcome: 'REJECT';
      reason:
        | 'INVALID_ENVELOPE'
        | 'INVALID_LOCAL_REFERENCE'
        | 'MERCHANT_MISMATCH'
        | 'PAYMENT_ID_MISMATCH'
        | 'RESOURCE_SHAPE_INVALID'
        | 'AMOUNT_MISMATCH'
        | 'CURRENCY_MISMATCH'
        | 'EVENT_STATUS_MISMATCH';
    };

const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Only events with an unambiguous event-to-status correspondence are eligible
 * for this validation path. Capture/authorization, partial-capture, refund,
 * dispute, mandate, payout and invoice events require resource-specific
 * reconciliation logic and must not be treated as subscription payment success.
 */
const SUPPORTED_EVENT_STATUSES: Partial<Record<HyperswitchWebhookEventType, readonly HyperswitchPaymentStatus[]>> = {
  payment_succeeded: ['succeeded'],
  payment_failed: ['failed'],
  payment_processing: ['processing'],
  payment_cancelled: ['cancelled'],
  payment_cancelled_post_capture: ['cancelled_post_capture'],
  payment_expired: ['expired'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}


/**
 * Validate identity, commercial facts and event ordering before any caller
 * considers applying a state change. This function performs no I/O, persistence,
 * financial posting, payment confirmation, or entitlement grant.
 *
 * Hyperswitch recommends ordering by content.object.updated, not by envelope
 * timestamp, because webhook delivery is asynchronous and may be out of order.
 */
export function validateHyperswitchPaymentWebhook(
  envelopeInput: HyperswitchWebhookEnvelope | unknown,
  referenceInput: KnownHyperswitchPaymentReference | unknown,
): HyperswitchPaymentWebhookDecision {
  if (!isRecord(envelopeInput) || !isRecord(referenceInput)) {
    return { outcome: 'REJECT', reason: 'INVALID_ENVELOPE' };
  }

  const envelope = envelopeInput as unknown as HyperswitchWebhookEnvelope;
  const reference = referenceInput as unknown as KnownHyperswitchPaymentReference;
  const { eventId, eventType, merchantId, contentType, resource } = envelope;

  if (
    !isNonBlankString(eventId) ||
    !isHyperswitchWebhookEventType(eventType) ||
    !isNonBlankString(merchantId) ||
    contentType !== 'payment_details' ||
    !isRecord(resource)
  ) {
    return { outcome: 'REJECT', reason: 'INVALID_ENVELOPE' };
  }

  if (
    !isNonBlankString(reference.paymentId) ||
    !PAYMENT_ID_PATTERN.test(reference.paymentId) ||
    !isNonBlankString(reference.merchantId) ||
    !Number.isSafeInteger(reference.amountMinor) ||
    reference.amountMinor <= 0 ||
    typeof reference.currency !== 'string' ||
    !CURRENCY_PATTERN.test(reference.currency) ||
    !(reference.lastProviderUpdatedAt === null || typeof reference.lastProviderUpdatedAt === 'string')
  ) {
    return { outcome: 'REJECT', reason: 'INVALID_LOCAL_REFERENCE' };
  }

  if (merchantId !== reference.merchantId || resource.merchant_id !== reference.merchantId) {
    return { outcome: 'REJECT', reason: 'MERCHANT_MISMATCH' };
  }

  if (
    typeof resource.payment_id !== 'string' ||
    !PAYMENT_ID_PATTERN.test(resource.payment_id) ||
    resource.payment_id !== reference.paymentId
  ) {
    return { outcome: 'REJECT', reason: 'PAYMENT_ID_MISMATCH' };
  }

  if (
    typeof resource.amount !== 'number' ||
    !Number.isSafeInteger(resource.amount) ||
    resource.amount <= 0
  ) {
    return { outcome: 'REJECT', reason: 'RESOURCE_SHAPE_INVALID' };
  }
  if (resource.amount !== reference.amountMinor) {
    return { outcome: 'REJECT', reason: 'AMOUNT_MISMATCH' };
  }

  if (typeof resource.currency !== 'string' || !CURRENCY_PATTERN.test(resource.currency)) {
    return { outcome: 'REJECT', reason: 'RESOURCE_SHAPE_INVALID' };
  }
  if (resource.currency !== reference.currency) {
    return { outcome: 'REJECT', reason: 'CURRENCY_MISMATCH' };
  }

  const rawProviderStatus = resource.status;
  if (!isHyperswitchPaymentStatus(rawProviderStatus)) {
    return {
      outcome: 'RECONCILIATION_REQUIRED',
      reason: 'UNKNOWN_PROVIDER_STATUS',
      eventId,
      paymentId: reference.paymentId,
    };
  }
  const providerStatus = rawProviderStatus;

  const providerUpdatedAt = parseHyperswitchRfc3339Timestamp(resource.updated);
  if (resource.updated === undefined || resource.updated === null || resource.updated === '') {
    return {
      outcome: 'RECONCILIATION_REQUIRED',
      reason: 'MISSING_PROVIDER_UPDATED',
      eventId,
      paymentId: reference.paymentId,
    };
  }
  if (providerUpdatedAt === null) {
    return {
      outcome: 'RECONCILIATION_REQUIRED',
      reason: 'INVALID_PROVIDER_UPDATED',
      eventId,
      paymentId: reference.paymentId,
    };
  }

  if (reference.lastProviderUpdatedAt !== null) {
    const storedUpdatedAt = parseHyperswitchRfc3339Timestamp(reference.lastProviderUpdatedAt);
    if (storedUpdatedAt === null) {
      return {
        outcome: 'RECONCILIATION_REQUIRED',
        reason: 'INVALID_STORED_PROVIDER_UPDATED',
        eventId,
        paymentId: reference.paymentId,
      };
    }
    if (providerUpdatedAt <= storedUpdatedAt) {
      return {
        outcome: 'STALE',
        eventId,
        paymentId: reference.paymentId,
        incomingUpdatedAt: resource.updated as string,
        storedUpdatedAt: reference.lastProviderUpdatedAt,
      };
    }
  }

  const expectedStatuses = SUPPORTED_EVENT_STATUSES[eventType];
  if (!expectedStatuses) {
    return {
      outcome: 'RECONCILIATION_REQUIRED',
      reason: 'UNSUPPORTED_EVENT_SEMANTICS',
      eventId,
      paymentId: reference.paymentId,
    };
  }
  if (!expectedStatuses.includes(providerStatus)) {
    return { outcome: 'REJECT', reason: 'EVENT_STATUS_MISMATCH' };
  }

  return {
    outcome: 'VALIDATED',
    eventId,
    paymentId: reference.paymentId,
    eventType,
    providerStatus,
    providerUpdatedAt: resource.updated as string,
  };
}
